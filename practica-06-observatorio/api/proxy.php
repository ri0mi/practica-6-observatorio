<?php
/**
 * PROXY DE APIS EXTERNAS — el único punto por donde el navegador sale a internet.
 *
 *     proxy.php?fuente=lugar&lat=19.43&lon=-99.13
 *     proxy.php?fuente=clima&lat=19.43&lon=-99.13
 *     proxy.php?fuente=suelo&lat=19.43&lon=-99.13
 *     proxy.php?fuente=biodiversidad&especie=Zea+mays&lat=19.43&lon=-99.13
 *     proxy.php?fuente=sitio&especie=Zea+mays&lat=19.43&lon=-99.13   (todo junto)
 *     proxy.php?fuente=buscar&q=Jutiapa
 *
 * Por qué un proxy y no llamar a las APIs desde JavaScript:
 *
 *   1. CREDENCIALES. Una clave en el cliente es una clave pública. Aquí viven
 *      en config.php, que el navegador nunca descarga.
 *   2. CORS. Varias de estas APIs no mandan Access-Control-Allow-Origin, así
 *      que un fetch desde el navegador fallaría. Desde PHP no hay CORS.
 *   3. CACHÉ. Veinte alumnos pulsando el mismo punto generan una llamada, no
 *      veinte. Las APIs públicas tienen límites de uso y hay que respetarlos.
 *   4. NORMALIZACIÓN. Cuatro APIs, cuatro formatos. El frontend recibe uno.
 *
 * Sin framework a propósito: un archivo, un switch y ninguna dependencia que
 * instalar. Se puede leer entero de una sentada.
 */

require_once __DIR__ . '/fuentes.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

try {
    $fuente = $_GET['fuente'] ?? '';

    switch ($fuente) {

        case 'lugar':
            $datos = fuenteLugar(num('lat', -90, 90), num('lon', -180, 180));
            break;

        case 'clima':
            $datos = fuenteClima(num('lat', -90, 90), num('lon', -180, 180));
            break;

        case 'nasa':
            $datos = fuenteNasa(num('lat', -90, 90), num('lon', -180, 180));
            break;

        case 'suelo':
            $datos = fuenteSuelo(num('lat', -90, 90), num('lon', -180, 180));
            break;

        case 'biodiversidad':
            $especie = trim($_GET['especie'] ?? '');
            if ($especie === '') throw new ApiError('Falta el parámetro especie', 422);
            $datos = fuenteBiodiversidad($especie, num('lat', -90, 90), num('lon', -180, 180));
            break;

        case 'buscar':
            $q = trim($_GET['q'] ?? '');
            if (mb_strlen($q) < 2) throw new ApiError('Escribe al menos dos letras', 422);
            $datos = fuenteBuscar($q);
            break;

        /**
         * SITIO: las cuatro fuentes de un punto en una sola petición.
         *
         * Es la ruta que usa el visor al hacer clic en el globo. Cada fuente
         * se pide por separado y se captura su error: que SoilGrids no tenga
         * datos de un islote no debe impedir ver el clima. El frontend recibe
         * lo que sí llegó y la lista de lo que falló.
         */
        case 'sitio':
            $lat = num('lat', -90, 90);
            $lon = num('lon', -180, 180);
            $especie = trim($_GET['especie'] ?? '');

            $datos = ['lugar' => null, 'clima' => null, 'suelo' => null,
                      'biodiversidad' => null, 'fallos' => []];

            $intentar = function (string $clave, callable $fn) use (&$datos) {
                try {
                    $datos[$clave] = $fn();
                } catch (Throwable $e) {
                    $datos['fallos'][] = ['fuente' => $clave, 'error' => $e->getMessage()];
                }
            };

            $intentar('lugar', fn() => fuenteLugar($lat, $lon));
            $intentar('clima', fn() => fuenteClima($lat, $lon));
            $intentar('suelo', fn() => fuenteSuelo($lat, $lon));

            if ($especie !== '') {
                $intentar('biodiversidad', fn() => fuenteBiodiversidad($especie, $lat, $lon));
            }
            break;

        default:
            throw new ApiError(
                'Fuente desconocida. Usa: lugar, clima, nasa, suelo, biodiversidad, sitio, buscar',
                404
            );
    }

    echo json_encode(['ok' => true, 'datos' => $datos], JSON_UNESCAPED_UNICODE);

} catch (ApiError $e) {
    http_response_code($e->http);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);

} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'Error interno: ' . $e->getMessage()],
                     JSON_UNESCAPED_UNICODE);
}
