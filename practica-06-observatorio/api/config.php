<?php
/**
 * PRÁCTICA 06 — OBSERVATORIO GLOBAL DE CULTIVOS
 * Configuración del proxy de APIs externas.
 *
 * Este archivo es el único lugar donde viven credenciales y ajustes. El
 * navegador nunca lo ve: solo habla con proxy.php, que es quien sale a
 * internet. Ese es el punto de tener un proxy.
 */

// --------------------------------------------------------------------------
// CREDENCIALES
//
// Las cuatro APIs que usamos son abiertas y no piden clave. Se deja el arreglo
// preparado porque el día que se añada una que sí la pida (Mapbox, OpenWeather,
// Copernicus) la clave va AQUÍ y no en el JavaScript. Si estuviera en el
// cliente, cualquiera la lee con Ctrl+U y la gasta a tu nombre.
//
// En producción esto se leería de una variable de entorno:
//     define('CLAVE_MAPBOX', getenv('MAPBOX_TOKEN'));
// --------------------------------------------------------------------------
const CLAVES = [
    'mapbox'  => '',   // no se usa: el globo es Three.js puro
    'nasa'    => '',   // NASA POWER es abierta
    'gbif'    => '',   // GBIF es abierta
    'isric'   => '',   // SoilGrids es abierta
];

// --------------------------------------------------------------------------
// CACHÉ EN DISCO
//
// Las APIs públicas tienen límites de uso y, sobre todo, son lentas: SoilGrids
// puede tardar varios segundos. Guardamos cada respuesta en un archivo con el
// hash de la petición como nombre. Una práctica de laboratorio con veinte
// alumnos pegándole al mismo punto no debe generar veinte llamadas.
//
// Se eligió disco y no MySQL a propósito: no hay nada relacional que consultar
// aquí, solo pares petición → respuesta con fecha de caducidad.
// --------------------------------------------------------------------------
const CACHE_DIR = __DIR__ . '/../cache';

/** Segundos de vida de cada fuente, según cada cuánto cambia el dato. */
const CACHE_TTL = [
    'lugar'         => 2592000,   // 30 días · los países no se mueven
    'clima'         => 604800,    // 7 días  · son normales de varios años
    'suelo'         => 2592000,   // 30 días · el suelo cambia en décadas
    'biodiversidad' => 86400,     // 1 día   · GBIF sí crece a diario
    'buscar'        => 604800,    // 7 días
];

/**
 * Segundos máximos que esperamos a una API antes de rendirnos.
 *
 * 12 se quedaba corto: GBIF encadena cuatro consultas y la última baja
 * cientos de registros con coordenadas. SoilGrids también suele tardar.
 * Es preferible esperar a quedarse sin el dato.
 */
const TIMEOUT = 30;

/**
 * Cuántos puntos de ocurrencia pedimos a GBIF como máximo.
 * Cada registro trae decenas de campos, así que 150 ya son varios cientos de
 * KB. Para una nube de puntos sobre el globo es de sobra.
 */
const MAX_OCURRENCIAS = 150;

// --------------------------------------------------------------------------
// UTILIDADES
// --------------------------------------------------------------------------

/** Error con código HTTP propio, para distinguir "no hay datos" de "truené". */
class ApiError extends Exception
{
    public int $http;
    public function __construct(string $mensaje, int $http = 500)
    {
        parent::__construct($mensaje);
        $this->http = $http;
    }
}

/**
 * Llama a una API externa y devuelve el JSON ya decodificado.
 *
 * Toda salida a internet pasa por aquí: un solo lugar donde controlar el
 * tiempo de espera, el User-Agent y los errores. cURL no lanza excepciones
 * por su cuenta, así que hay que revisar el código de retorno a mano.
 */
function pedirJson(string $url, ?int $segundos = null): array
{
    $ch = curl_init($url);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => $segundos ?? TIMEOUT,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
        // Identificarse es buena educación con una API pública y, en varias,
        // requisito para no acabar bloqueado.
        CURLOPT_USERAGENT      => 'Practica06-Observatorio/1.0 (proyecto academico)',
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
    ]);

    $cuerpo = curl_exec($ch);
    $codigo = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $fallo  = curl_error($ch);
    curl_close($ch);

    if ($cuerpo === false) {
        throw new ApiError("Fallo de red: $fallo", 502);
    }
    if ($codigo >= 400) {
        throw new ApiError("La API respondió $codigo", 502);
    }

    $datos = json_decode($cuerpo, true);
    if (!is_array($datos)) {
        throw new ApiError('La API no devolvió JSON válido', 502);
    }

    return $datos;
}

/**
 * Igual que pedirJson pero guardando el resultado en disco.
 * La clave incluye la URL completa, así que dos coordenadas distintas no se
 * pisan entre sí.
 */
function pedirConCache(string $url, string $fuente, ?int $segundos = null): array
{
    $ttl = CACHE_TTL[$fuente] ?? 3600;

    if (!is_dir(CACHE_DIR)) {
        @mkdir(CACHE_DIR, 0775, true);
    }

    $archivo = CACHE_DIR . '/' . $fuente . '-' . sha1($url) . '.json';

    if (is_file($archivo) && (time() - filemtime($archivo)) < $ttl) {
        $guardado = json_decode(file_get_contents($archivo), true);
        if (is_array($guardado)) {
            $guardado['_cache'] = true;
            return $guardado;
        }
    }

    $datos = pedirJson($url, $segundos);
    @file_put_contents($archivo, json_encode($datos));
    $datos['_cache'] = false;

    return $datos;
}

/** Lee un parámetro numérico obligatorio y lo valida. */
function num(string $clave, float $min, float $max): float
{
    if (!isset($_GET[$clave]) || !is_numeric($_GET[$clave])) {
        throw new ApiError("Falta el parámetro $clave", 422);
    }
    $v = (float) $_GET[$clave];
    if ($v < $min || $v > $max) {
        throw new ApiError("$clave fuera de rango ($min a $max)", 422);
    }
    return $v;
}

/** Redondeo seguro: deja pasar null en vez de convertirlo en 0. */
function red($valor, int $dec = 1)
{
    return is_numeric($valor) ? round((float) $valor, $dec) : null;
}

/** Promedio de un arreglo ignorando nulos. */
function promedio(array $valores)
{
    $limpios = array_values(array_filter($valores, 'is_numeric'));
    return $limpios ? array_sum($limpios) / count($limpios) : null;
}
