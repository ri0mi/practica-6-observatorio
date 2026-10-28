<?php
/**
 * DIAGNÓSTICO DEL OBSERVATORIO
 *
 * Llama de verdad a las cuatro APIs externas con un punto conocido y enseña
 * qué contestó cada una, cuánto tardó y el dato clave que extrajo el
 * normalizador. Si una se cae, aquí se ve cuál y por qué.
 *
 *     http://TU_SERVIDOR/practica06/api/diagnostico.php
 */

require_once __DIR__ . '/fuentes.php';

header('Content-Type: text/html; charset=utf-8');
set_time_limit(90);

// Ciudad de México: tierra firme, con datos en las cuatro fuentes.
$LAT = 19.43; $LON = -99.13;

$pruebas = [];

function probar(string $nombre, string $detalleOk, callable $fn): void
{
    global $pruebas;
    $t0 = microtime(true);

    try {
        $datos = $fn();
        $pruebas[] = ['nombre' => $nombre, 'ok' => true,
                      'detalle' => $detalleOk, 'datos' => $datos,
                      'ms' => (int) ((microtime(true) - $t0) * 1000)];
    } catch (Throwable $e) {
        $pruebas[] = ['nombre' => $nombre, 'ok' => false,
                      'detalle' => get_class($e) . ': ' . $e->getMessage(),
                      'datos' => null,
                      'ms' => (int) ((microtime(true) - $t0) * 1000)];
    }
}

// ---- Entorno ----
probar('PHP 7.4 o superior', 'Versión ' . PHP_VERSION, function () {
    if (version_compare(PHP_VERSION, '7.4.0', '<')) {
        throw new Exception('Versión demasiado antigua: ' . PHP_VERSION);
    }
    return null;
});

probar('Extensión cURL', 'Cargada: sin ella el proxy no puede salir a internet', function () {
    if (!function_exists('curl_init')) {
        throw new Exception('Falta. Descomenta extension=curl en php.ini y reinicia Apache.');
    }
    return null;
});

probar('Carpeta de caché escribible', 'Las respuestas se guardan en cache/', function () {
    if (!is_dir(CACHE_DIR)) @mkdir(CACHE_DIR, 0775, true);
    if (!is_dir(CACHE_DIR) || !is_writable(CACHE_DIR)) {
        throw new Exception('No se puede escribir en ' . CACHE_DIR);
    }
    $n = count(glob(CACHE_DIR . '/*.json') ?: []);
    return ['archivos en caché' => $n];
});

probar('Contornos de países', 'datos/paises.json cargado', function () {
    $pais = paisDeCoordenada(-99.13, 19.43);
    if ($pais === null) {
        throw new Exception('La geocodificación inversa local no devolvió país. '
                          . '¿Existe datos/paises.json?');
    }
    return ['(-99.13, 19.43) cae en' => $pais];
});

// ---- APIs externas ----
probar('Open-Meteo · lugar y clima actual',
       'Responde altitud y zona horaria', fn() => fuenteLugar($LAT, $LON));

probar('Open-Meteo Archive · normales climáticas',
       'Serie diaria de 5 años, normalizada', fn() => fuenteClima($LAT, $LON));

probar('NASA POWER · climatología',
       'Medias mensuales desde 1981', fn() => fuenteNasa($LAT, $LON));

probar('SoilGrids (ISRIC) · suelo',
       'pH, textura y carbono orgánico', fn() => fuenteSuelo($LAT, $LON));

probar('GBIF · ocurrencias de Zea mays',
       'Clave taxonómica, conteos y puntos', function () use ($LAT, $LON) {
    $d = fuenteBiodiversidad('Zea mays', $LAT, $LON);
    $d['puntos'] = count($d['puntos']) . ' puntos (recortado para esta vista)';
    return $d;
});

probar('Open-Meteo Geocoding · búsqueda por nombre',
       'Nombre de lugar a coordenadas', fn() => fuenteBuscar('Jutiapa'));

$fallos = count(array_filter($pruebas, fn($p) => !$p['ok']));
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Diagnóstico · Observatorio Global de Cultivos</title>
<style>
    body { font-family: system-ui, "Segoe UI", Arial, sans-serif; background:#0d1117;
           color:#c9d1d9; max-width:900px; margin:40px auto; padding:0 20px; font-size:14px; }
    h1 { font-size:18px; color:#e6edf3; }
    .resumen { padding:12px 14px; border-radius:9px; margin:16px 0 22px;
               border-left:3px solid #3fb950; background:#161b22; line-height:1.6; }
    .resumen.mal { border-left-color:#d03b3b; }
    .prueba { background:#161b22; border:1px solid #2a3340; border-radius:9px;
              padding:11px 13px; margin-bottom:9px; }
    .prueba b { color:#e6edf3; font-size:13px; }
    .prueba .ms { float:right; color:#8b98a5; font-size:11px; }
    .prueba small { color:#8b98a5; display:block; margin-top:4px; line-height:1.5; }
    .ok b::before  { content:"✔ "; color:#3fb950; }
    .mal b::before { content:"✘ "; color:#d03b3b; }
    .mal { border-color:#58282c; }
    pre { background:#0b0f14; border:1px solid #2a3340; border-radius:7px;
          padding:9px 11px; margin-top:8px; overflow:auto; max-height:230px;
          font-size:11.5px; color:#9fb4c7; }
    code { background:#1c232c; padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<h1>Diagnóstico · Observatorio Global de Cultivos</h1>

<div class="resumen <?= $fallos ? 'mal' : '' ?>">
    <?php if ($fallos === 0): ?>
        Las <?= count($pruebas) ?> comprobaciones pasaron. El proxy habla con las
        cuatro APIs externas y el visor debería funcionar completo.
    <?php else: ?>
        <?= $fallos ?> comprobación(es) fallida(s) de <?= count($pruebas) ?>.<br>
        Si falla <b>una sola</b> API externa, el visor sigue funcionando con las
        demás: cada fuente se consulta por separado y el panel marca la que falte.
        Si fallan <b>todas</b>, lo normal es que la red de la universidad bloquee
        la salida, o que falte la extensión cURL.
    <?php endif; ?>
</div>

<?php foreach ($pruebas as $p): ?>
    <div class="prueba <?= $p['ok'] ? 'ok' : 'mal' ?>">
        <span class="ms"><?= $p['ms'] ?> ms</span>
        <b><?= htmlspecialchars($p['nombre']) ?></b>
        <small><?= htmlspecialchars($p['detalle']) ?></small>
        <?php if ($p['datos']): ?>
            <pre><?= htmlspecialchars(json_encode($p['datos'],
                JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) ?></pre>
        <?php endif; ?>
    </div>
<?php endforeach; ?>

<p style="color:#8b98a5; margin-top:22px; line-height:1.7;">
    Prueba directa del proxy:
    <code>proxy.php?fuente=sitio&amp;lat=19.43&amp;lon=-99.13&amp;especie=Zea mays</code><br>
    La segunda vez que cargues esta página los tiempos deben bajar mucho: es la
    caché en disco haciendo su trabajo. Para forzar llamadas nuevas, borra los
    archivos de la carpeta <code>cache/</code>.
</p>
</body>
</html>
