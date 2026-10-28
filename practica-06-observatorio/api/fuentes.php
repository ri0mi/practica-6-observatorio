<?php
/**
 * UNA FUNCIÓN POR API EXTERNA.
 *
 * Cada una hace lo mismo: arma la URL, pide, y NORMALIZA. Lo último es lo
 * importante: las cuatro APIs devuelven formas completamente distintas y el
 * frontend no tiene por qué enterarse. Aquí entran cuatro dialectos y sale
 * siempre un objeto plano con nombres en español.
 */

require_once __DIR__ . '/config.php';

// ==========================================================================
//  1. LUGAR — ¿dónde hice clic?
//     País: resuelto AQUÍ, sin API, con los contornos de datos/paises.json.
//     Altitud y zona horaria: Open-Meteo, que las devuelve de regalo.
// ==========================================================================

/** ¿Está el punto dentro del anillo? Algoritmo de cruce de rayos. */
function dentroDelAnillo(float $lon, float $lat, array $anillo): bool
{
    $dentro = false;
    $n = count($anillo);

    for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
        [$xi, $yi] = $anillo[$i];
        [$xj, $yj] = $anillo[$j];

        if (($yi > $lat) !== ($yj > $lat) &&
            $lon < ($xj - $xi) * ($lat - $yi) / ($yj - $yi) + $xi) {
            $dentro = !$dentro;
        }
    }
    return $dentro;
}

/**
 * Geocodificación inversa local.
 *
 * Open-Meteo solo geocodifica hacia adelante (nombre → coordenadas), así que
 * el camino inverso lo resolvemos con los mismos polígonos que dibujan el
 * globo. Sale gratis, es instantáneo y funciona sin internet. El primer
 * anillo de cada polígono es el contorno y los demás son huecos (lagos,
 * enclaves), por eso hay que descartarlos.
 */
function paisDeCoordenada(float $lon, float $lat): ?string
{
    static $paises = null;
    if ($paises === null) {
        $ruta = __DIR__ . '/../datos/paises.json';
        $paises = is_file($ruta) ? json_decode(file_get_contents($ruta), true) : [];
    }

    foreach ($paises as $p) {
        foreach ($p['poligonos'] as $poligono) {
            if (!dentroDelAnillo($lon, $lat, $poligono[0])) continue;

            $enHueco = false;
            for ($h = 1; $h < count($poligono); $h++) {
                if (dentroDelAnillo($lon, $lat, $poligono[$h])) { $enHueco = true; break; }
            }
            if (!$enHueco) return $p['nombre'];
        }
    }
    return null;
}

function fuenteLugar(float $lat, float $lon): array
{
    $pais = paisDeCoordenada($lon, $lat);

    $altitud = null;
    $zona = null;
    $aviso = null;

    try {
        $url = 'https://api.open-meteo.com/v1/forecast'
             . "?latitude=$lat&longitude=$lon&current=temperature_2m&timezone=auto";
        $d = pedirConCache($url, 'lugar');

        $altitud = red($d['elevation'] ?? null, 0);
        $zona    = $d['timezone'] ?? null;
        $ahora   = red($d['current']['temperature_2m'] ?? null, 1);
    } catch (ApiError $e) {
        $ahora = null;
        $aviso = 'Sin datos de Open-Meteo: ' . $e->getMessage();
    }

    return [
        'lat' => $lat,
        'lon' => $lon,
        'pais' => $pais,
        'en_tierra' => $pais !== null,
        'altitud_m' => $altitud,
        'zona_horaria' => $zona,
        'temperatura_ahora' => $ahora ?? null,
        'aviso' => $aviso,
    ];
}

// ==========================================================================
//  2. CLIMA — Open-Meteo Archive (principal) + NASA POWER (contraste)
//
//  Se usan las dos a propósito: Open-Meteo da la serie diaria, con la que
//  calculamos nosotros las normales; NASA POWER da la climatología mensual ya
//  procesada desde 1981. Que dos fuentes independientes coincidan es la mejor
//  señal de que el dato es bueno.
// ==========================================================================

function fuenteClima(float $lat, float $lon): array
{
    $hasta = date('Y-m-d', strtotime('-7 days'));
    $desde = date('Y-m-d', strtotime('-5 years -7 days'));

    $url = 'https://archive-api.open-meteo.com/v1/archive'
         . "?latitude=$lat&longitude=$lon"
         . "&start_date=$desde&end_date=$hasta"
         . '&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,'
         . 'precipitation_sum,shortwave_radiation_sum,et0_fao_evapotranspiration'
         . '&timezone=UTC';

    $d = pedirConCache($url, 'clima');
    $diario = $d['daily'] ?? [];

    if (empty($diario['time'])) {
        throw new ApiError('Open-Meteo no devolvió serie diaria para ese punto', 502);
    }

    $nDias = count($diario['time']);
    $anios = max(1, $nDias / 365.25);

    $tMedia = promedio($diario['temperature_2m_mean'] ?? []);
    $tMax   = promedio($diario['temperature_2m_max'] ?? []);
    $tMin   = promedio($diario['temperature_2m_min'] ?? []);

    // Acumulados anuales: se suma todo y se divide entre los años de serie.
    $lluvia = array_sum(array_filter($diario['precipitation_sum'] ?? [], 'is_numeric')) / $anios;
    $et0    = array_sum(array_filter($diario['et0_fao_evapotranspiration'] ?? [], 'is_numeric')) / $anios;
    $rad    = promedio($diario['shortwave_radiation_sum'] ?? []);

    // Heladas y calor extremo: el promedio esconde los eventos que matan un
    // cultivo, así que se cuentan aparte.
    $heladas = 0; $sofocos = 0;
    foreach (($diario['temperature_2m_min'] ?? []) as $v) if (is_numeric($v) && $v <= 0)  $heladas++;
    foreach (($diario['temperature_2m_max'] ?? []) as $v) if (is_numeric($v) && $v >= 35) $sofocos++;

    // Índice de aridez de la FAO: lluvia entre evapotranspiración potencial.
    // Por debajo de 0.65 la zona es seca; por debajo de 0.2, árida.
    $aridez = ($et0 > 0) ? $lluvia / $et0 : null;

    return [
        'fuente' => 'Open-Meteo Archive (ERA5)',
        'periodo' => "$desde a $hasta",
        'dias_de_serie' => $nDias,
        'temp_media_c' => red($tMedia),
        'temp_max_media_c' => red($tMax),
        'temp_min_media_c' => red($tMin),
        'lluvia_anual_mm' => red($lluvia, 0),
        'et0_anual_mm' => red($et0, 0),
        'indice_aridez' => red($aridez, 2),
        'radiacion_mj_m2_dia' => red($rad, 2),
        'dias_helada_anio' => red($heladas / $anios, 1),
        'dias_sobre_35_anio' => red($sofocos / $anios, 1),
        'desde_cache' => $d['_cache'] ?? false,
    ];
}

/**
 * NASA POWER: climatología mensual ya calculada por la NASA desde 1981.
 * Devuelve cada parámetro como {JAN:…, FEB:…, …, ANN:…}; nos quedamos con el
 * anual y con los doce meses para poder dibujarlos.
 */
function fuenteNasa(float $lat, float $lon): array
{
    $url = 'https://power.larc.nasa.gov/api/temporal/climatology/point'
         . '?parameters=T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN'
         . "&community=AG&longitude=$lon&latitude=$lat&format=JSON";

    $d = pedirConCache($url, 'clima');
    $p = $d['properties']['parameter'] ?? [];

    if (!$p) {
        throw new ApiError('NASA POWER no devolvió parámetros', 502);
    }

    $meses = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    $serie = function (string $clave) use ($p, $meses) {
        if (!isset($p[$clave])) return null;
        return array_map(fn($m) => red($p[$clave][$m] ?? null, 2), $meses);
    };

    return [
        'fuente' => 'NASA POWER (climatología 1981–presente)',
        'temp_media_c' => red($p['T2M']['ANN'] ?? null),
        // PRECTOTCORR viene en mm/día; a año son x365.
        'lluvia_anual_mm' => red(($p['PRECTOTCORR']['ANN'] ?? 0) * 365, 0),
        'radiacion_kwh_m2_dia' => red($p['ALLSKY_SFC_SW_DWN']['ANN'] ?? null, 2),
        'temp_por_mes' => $serie('T2M'),
        'lluvia_por_mes' => $serie('PRECTOTCORR'),
        'desde_cache' => $d['_cache'] ?? false,
    ];
}

// ==========================================================================
//  3. SUELO — SoilGrids (ISRIC), 250 m de resolución global
//
//  Ojo con las unidades: SoilGrids guarda enteros multiplicados por un factor
//  para ahorrar espacio. El pH viene como 65 y significa 6.5; la arcilla viene
//  en g/kg y hay que dividir entre 10 para tener el porcentaje. El factor está
//  en la propia respuesta (d_factor) y lo leemos de ahí en vez de escribirlo
//  a mano, que es como se cuelan los errores silenciosos.
// ==========================================================================

function fuenteSuelo(float $lat, float $lon): array
{
    $url = 'https://rest.isric.org/soilgrids/v2.0/properties/query'
         . "?lon=$lon&lat=$lat"
         . '&property=phh2o&property=clay&property=sand&property=silt&property=soc'
         . '&depth=0-5cm&value=mean';

    $d = pedirConCache($url, 'suelo');
    $capas = $d['properties']['layers'] ?? [];

    if (!$capas) {
        throw new ApiError('SoilGrids no tiene datos para ese punto (¿es mar?)', 404);
    }

    $valores = [];
    foreach ($capas as $capa) {
        $nombre = $capa['name'] ?? '';
        $factor = $capa['unit_measure']['d_factor'] ?? 1;
        $crudo  = $capa['depths'][0]['values']['mean'] ?? null;
        $valores[$nombre] = is_numeric($crudo) && $factor ? $crudo / $factor : null;
    }

    $arcilla = $valores['clay'] ?? null;
    $arena   = $valores['sand'] ?? null;
    $limo    = $valores['silt'] ?? null;

    return [
        'fuente' => 'SoilGrids 2.0 (ISRIC) · 0–5 cm',
        'ph' => red($valores['phh2o'] ?? null, 1),
        'arcilla_pct' => red($arcilla),
        'arena_pct' => red($arena),
        'limo_pct' => red($limo),
        'carbono_organico_g_kg' => red($valores['soc'] ?? null),
        'textura' => clasificarTextura($arena, $limo, $arcilla),
        'desde_cache' => $d['_cache'] ?? false,
    ];
}

/**
 * Clasificación simplificada del triángulo textural del USDA.
 * No están las doce clases, solo las cinco que cambian una decisión de riego.
 */
function clasificarTextura(?float $arena, ?float $limo, ?float $arcilla): ?string
{
    if ($arena === null || $arcilla === null) return null;

    if ($arcilla >= 40) return 'arcilloso';
    if ($arena   >= 70) return 'arenoso';
    if ($arcilla >= 27) return 'franco arcilloso';
    if (($limo ?? 0) >= 50) return 'franco limoso';
    return 'franco';
}

// ==========================================================================
//  4. BIODIVERSIDAD — GBIF
//
//  Dos preguntas distintas: cuántos registros hay (un número, barato) y dónde
//  están (una lista de puntos, cara). Se piden por separado para no bajar
//  medio millón de filas cuando solo queremos el conteo.
// ==========================================================================

function fuenteBiodiversidad(string $nombreCientifico, ?float $lat, ?float $lon): array
{
    // Paso 1: el nombre científico a la clave taxonómica de GBIF.
    $match = pedirConCache(
        'https://api.gbif.org/v1/species/match?name=' . rawurlencode($nombreCientifico),
        'biodiversidad'
    );

    $clave = $match['usageKey'] ?? null;
    if (!$clave) {
        throw new ApiError("GBIF no reconoce la especie «$nombreCientifico»", 404);
    }

    // Paso 2: cuántos registros con coordenada hay en el mundo.
    $global = pedirConCache(
        "https://api.gbif.org/v1/occurrence/search?taxonKey=$clave&hasCoordinate=true&limit=0",
        'biodiversidad'
    );

    $salida = [
        'fuente' => 'GBIF Occurrence API',
        'consultado' => $nombreCientifico,
        'aceptado' => $match['scientificName'] ?? $nombreCientifico,
        'rango' => $match['rank'] ?? null,
        'clave_gbif' => $clave,
        'registros_mundo' => $global['count'] ?? 0,
        'registros_region' => null,
        'puntos' => [],
        'desde_cache' => $global['_cache'] ?? false,
    ];

    // Paso 3: si nos dieron un punto, acotamos a una ventana de ±5° alrededor
    // (unos 550 km) y bajamos las ocurrencias para pintarlas en el globo.
    if ($lat !== null && $lon !== null) {
        $latMin = max(-90, $lat - 5); $latMax = min(90, $lat + 5);
        $lonMin = max(-180, $lon - 5); $lonMax = min(180, $lon + 5);

        $base = "https://api.gbif.org/v1/occurrence/search?taxonKey=$clave&hasCoordinate=true"
              . "&decimalLatitude=$latMin,$latMax&decimalLongitude=$lonMin,$lonMax";

        $region = pedirConCache("$base&limit=0", 'biodiversidad');
        $salida['registros_region'] = $region['count'] ?? 0;
    }

    // Paso 4: los puntos para pintar en el globo.
    //
    // Esta es la llamada cara de las cuatro: cientos de registros completos.
    // Va en su propio try porque es la única prescindible: si GBIF tarda
    // demasiado, los conteos de los pasos anteriores siguen sirviendo para
    // calcular la idoneidad, que es lo que de verdad importa. Perder la nube
    // de puntos del globo es un lujo; perder el conteo no.
    try {
        $lista = pedirConCache(
            "https://api.gbif.org/v1/occurrence/search?taxonKey=$clave&hasCoordinate=true"
            . '&limit=' . MAX_OCURRENCIAS,
            'biodiversidad'
        );

        foreach (($lista['results'] ?? []) as $r) {
            if (!isset($r['decimalLatitude'], $r['decimalLongitude'])) continue;
            $salida['puntos'][] = [
                'lat' => red($r['decimalLatitude'], 3),
                'lon' => red($r['decimalLongitude'], 3),
                'pais' => $r['country'] ?? null,
                'anio' => $r['year'] ?? null,
            ];
        }
    } catch (ApiError $e) {
        $salida['aviso_puntos'] = 'No se pudieron bajar las ocurrencias para el globo: '
                                . $e->getMessage();
    }

    return $salida;
}

// ==========================================================================
//  5. BÚSQUEDA DE LUGARES — Open-Meteo Geocoding (nombre → coordenadas)
// ==========================================================================

function fuenteBuscar(string $texto): array
{
    $url = 'https://geocoding-api.open-meteo.com/v1/search'
         . '?name=' . rawurlencode($texto) . '&count=8&language=es&format=json';

    $d = pedirConCache($url, 'buscar');

    $lugares = [];
    foreach (($d['results'] ?? []) as $r) {
        $lugares[] = [
            'nombre' => $r['name'] ?? '',
            'pais' => $r['country'] ?? null,
            'region' => $r['admin1'] ?? null,
            'lat' => red($r['latitude'], 4),
            'lon' => red($r['longitude'], 4),
            'altitud_m' => red($r['elevation'] ?? null, 0),
        ];
    }

    return ['fuente' => 'Open-Meteo Geocoding', 'lugares' => $lugares];
}
