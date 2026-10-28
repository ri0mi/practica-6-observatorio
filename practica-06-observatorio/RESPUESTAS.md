# Práctica 06 — Respuestas y justificación técnica

Ricardo Melgoza y Rebeca Arciga

## 1. ¿Qué hace exactamente el proxy y por qué no llamar a las APIs desde el navegador?

`api/proxy.php` es el único punto del sistema que sale a internet. El
JavaScript solo conoce esa URL.

Cuatro razones, en orden de peso:

1. **Credenciales.** Una clave en el cliente es una clave pública: se lee con
   Ctrl+U o en la pestaña Red del inspector. En esta práctica las cuatro APIs
   son abiertas, pero `config.php` ya tiene el arreglo `CLAVES` preparado para
   la primera que pida una. PHP lo lee; el navegador nunca lo descarga.
2. **CORS.** Varias de estas APIs no mandan `Access-Control-Allow-Origin`, así
   que un `fetch` desde el navegador fallaría aunque la API funcionara. El
   servidor no tiene esa restricción porque CORS es una política del navegador.
3. **Caché.** Veinte alumnos consultando el mismo punto generan una llamada.
   Las APIs públicas tienen límites de uso, y agotarlos para todo el grupo
   porque cada clic dispara una petición es un problema real.
4. **Normalización.** Cuatro APIs devuelven cuatro formas distintas. El
   frontend recibe una sola, con unidades ya resueltas.

## 2. ¿Cómo consumes las APIs desde PHP y cómo manejas los errores?

Toda la salida pasa por `pedirJson()` en `config.php`, que envuelve cURL. Un
solo lugar donde controlar el tiempo de espera, el User-Agent y los fallos.

Lo importante con cURL: **no lanza excepciones por su cuenta**. Hay que revisar
tres cosas por separado, y cada una significa algo distinto:

```php
if ($cuerpo === false)  → fallo de red: no hubo respuesta
if ($codigo >= 400)     → hubo respuesta, pero la API dijo que no
if (!is_array($datos))  → respondió, pero no era JSON (típico de una página de error)
```

Las tres se convierten en un `ApiError` con código HTTP propio, y `proxy.php`
lo traduce a la respuesta final. La distinción entre 404 y 502 importa:
«SoilGrids no tiene datos de este punto» no es lo mismo que «SoilGrids está
caído», y la interfaz debe decir cuál de las dos.

Además, `TIMEOUT` está en 12 segundos: SoilGrids a veces tarda mucho, y una
petición colgada bloquea al usuario más que un error claro.

## 3. Los fallos aislados: por qué `sitio` no es una sola llamada

La ruta que usa el visor pide las cuatro fuentes, pero cada una dentro de su
propio `try`:

```php
$intentar = function ($clave, $fn) use (&$datos) {
    try { $datos[$clave] = $fn(); }
    catch (Throwable $e) { $datos['fallos'][] = ['fuente' => $clave, 'error' => $e->getMessage()]; }
};
```

Si las cuatro estuvieran en el mismo `try`, que SoilGrids no tenga datos de un
islote dejaría al usuario sin el clima, que sí existe. La respuesta trae lo que
llegó y un arreglo `fallos` con lo que no, y el panel pinta cada ausencia en
amarillo con su motivo.

## 4. ¿Cómo normalizas datos de cuatro APIs distintas?

Cada fuente tiene su trampa.

**SoilGrids** guarda enteros multiplicados por un factor para ahorrar espacio:
el pH viene como `65` y significa 6.5; la arcilla viene en g/kg y hay que
dividir entre 10 para tener el porcentaje. El factor está en la propia
respuesta (`d_factor`) y **se lee de ahí**, no se escribe a mano. Escribirlo a
mano es exactamente como se cuela un error silencioso el día que la API cambie
sus unidades.

**NASA POWER** devuelve `{JAN:…, FEB:…, …, ANN:…}` por parámetro, y la
precipitación está en mm/día, así que el acumulado anual es ×365.

**Open-Meteo Archive** no da normales, da la serie diaria cruda: 1.826 días.
Las normales las calculamos aquí, y eso permite sacar cosas que ninguna API
entrega hechas, como los días de helada al año o los días por encima de 35 °C.

**GBIF** necesita dos pasos: primero el nombre científico a `usageKey`, y con
esa clave los conteos y los puntos. Conteo y puntos se piden por separado
(`limit=0` para el conteo) porque bajar medio millón de filas para contarlas
sería absurdo.

## 5. ¿Qué calculas tú que ninguna API te da?

- **Índice de aridez de la FAO** = lluvia anual / evapotranspiración potencial.
  Por debajo de 0.65 la zona es seca; por debajo de 0.2, árida. Es un número
  mucho más útil que los milímetros de lluvia a secas: 600 mm en Noruega y
  600 mm en Sonora no significan lo mismo.
- **Días de helada y días sobre 35 °C al año.** El promedio esconde justo los
  eventos que matan un cultivo. Una media anual de 18 °C puede corresponder a
  un clima templado o a uno con heladas y olas de calor.
- **El país de una coordenada**, sin API (ver la pregunta 7).
- **El índice de idoneidad**, que es el producto final.

## 6. ¿Cómo visualizas datos georreferenciados sobre el globo?

La pieza central es la proyección esférica, en `globo.js`:

```js
phi   = (90 - lat) · π/180        // desde el polo norte
theta = (lon + 180) · π/180       // vuelta al ecuador
x = -r·sin(phi)·cos(theta)
y =  r·cos(phi)
z =  r·sin(phi)·sin(theta)
```

El signo negativo en X es lo que deja el meridiano cero de frente y el este a
la derecha, como en un mapa. `aCoordenada()` hace el camino inverso con
`atan2`, y es lo que convierte el punto 3D que devuelve el raycaster en la
latitud y longitud que se mandan al proxy. Comprobado: la ida y vuelta de seis
coordenadas distintas da error 0.

Tres decisiones de rendimiento:

- **Los 177 países son un único `LineSegments`** con 20.600 vértices. Un objeto,
  una llamada de dibujo por frame. Si cada país fuera su propio objeto serían
  177 llamadas.
- **Las ocurrencias de GBIF son un único `THREE.Points`** con un
  `BufferGeometry`. Crear una esfera por registro tumbaría el navegador con 300
  puntos, y GBIF puede devolver millones.
- **Nada de texturas de imagen.** La geografía sale de los mismos polígonos que
  usa el servidor, así que el proyecto no depende de ningún archivo externo.

El arco de la comparación A/B es una curva de Bézier cuadrática cuyo punto de
control se empuja hacia fuera en proporción a la distancia entre los extremos.
Una recta entre dos coordenadas atravesaría el planeta por dentro.

## 7. Geocodificación inversa sin API

El enunciado sugiere Open-Meteo para coordenadas → nombre del lugar, pero
**Open-Meteo Geocoding solo funciona hacia adelante**: busca por nombre y
devuelve coordenadas. No tiene endpoint inverso.

En vez de meter una quinta API, el camino inverso se resuelve en el servidor
con los mismos polígonos que dibujan el globo, mediante el algoritmo de cruce
de rayos: se traza un rayo horizontal desde el punto y se cuentan los cruces
con el contorno; impar significa dentro.

```php
if (($yi > $lat) !== ($yj > $lat) &&
    $lon < ($xj - $xi) * ($lat - $yi) / ($yj - $yi) + $xi) { $dentro = !$dentro; }
```

El detalle que hay que cuidar: el primer anillo de cada polígono es el
contorno y los demás son **huecos** (lagos, enclaves). Si no se descartan, un
punto en el lago Victoria saldría como tierra firme.

Sale gratis, es instantáneo, no consume cuota y funciona sin internet.
Comprobado con Ciudad de México, Jutiapa, Córdoba, Brasilia y Tokio, y
devolviendo `null` en mitad del Atlántico.

## 8. ¿Cómo conectas datos reales con el simulador de la Práctica 05?

El motor habla en porcentajes de luz, agua y nutrientes; las APIs hablan en
MJ/m²/día y milímetros. La traducción está en `Idoneidad.aParametros()`:

| Parámetro | Fuente | Criterio |
|---|---|---|
| Temperatura | Media anual de Open-Meteo | Directa |
| Agua % | Índice de aridez | Aridez 1.0 → 75 % de humedad, el riego óptimo típico |
| Luz % | Radiación solar | 28 MJ/m²/día se considera saturación fotosintética |
| Nutrientes % | Carbono orgánico del suelo | 30 g/kg se considera plenamente fértil |
| CO₂ | — | 420 ppm, media atmosférica actual |

Cada conversión devuelve además un texto `origen` que la interfaz **muestra al
lado del número**. Sin eso, el usuario ve un 45.8 % de agua y no tiene forma de
saber si es un dato medido o una suposición. Esa tabla es, probablemente, la
parte más importante de la práctica: es donde se ve que el resultado no es
magia.

## 9. El índice de idoneidad

```
total = 0.55 · clima + 0.30 · suelo + 0.15 · evidencia
```

- **Clima** = 100 − estrés, con el motor de estrés de la Práctica 05 alimentado
  por datos reales. El clima pesa más porque es lo que más varía entre dos
  puntos del planeta.
- **Suelo** = 60 % distancia del pH al óptimo de la especie + 40 % si la
  textura está entre las que tolera.
- **Evidencia** = registros de GBIF en 550 km, en escala logarítmica, porque la
  diferencia entre 0 y 100 registros significa muchísimo más que entre 10.000 y
  10.100.

Sobre el total se aplica otra vez la **ley del mínimo de Liebig**: no puede
superar en más de un 25 % al peor de clima y suelo. Un sitio con clima perfecto
y suelo imposible no es un sitio medianamente bueno.

La evidencia **no entra** en ese techo, a propósito: es un indicio, no un
factor limitante. Que nadie haya registrado maíz en un valle no impide que el
maíz crezca ahí.

## 10. El error que encontré probando, y que cambia las conclusiones

La primera versión puntuaba **100/100** cualquier punto donde fallaran las APIs.

La cadena es la siguiente: cuando falta el clima, `aParametros()` rellena con
los óptimos de la especie; con los óptimos, el estrés sale 0; con estrés 0, el
componente climático sale 100. Resultado: un punto del que no sabíamos
absolutamente nada ganaba todas las comparaciones A/B.

Es el tipo de error más peligroso que puede tener una herramienta así, porque
no se parece a un error: se parece a una recomendación. La corrección fue
separar dos cosas que estaban mezcladas:

- **Para simular**, rellenar con los óptimos está bien: la curva sirve de
  referencia de lo que daría la especie en condiciones ideales. Pero la
  interfaz ahora lo avisa en amarillo, encima de los KPIs: *«esta curva no es
  una predicción para este lugar»*.
- **Para puntuar**, no. Sin clima no hay nota: el resultado es `sin datos`, y
  la comparación A/B se declara **no concluyente** si a cualquiera de los dos
  lados le falta.

## 11. ¿Cómo evitaste problemas de seguridad?

- **Las credenciales viven en `config.php`**, que PHP ejecuta y el navegador
  nunca descarga. Es el motivo de ser del proxy.
- **Validación de entrada**: `num()` comprueba que latitud y longitud sean
  numéricas y estén en rango antes de construir ninguna URL. Sin eso,
  `lat=abc` o `lat=<script>` acabaría concatenado en la llamada saliente.
- **Escapado al construir URLs**: `rawurlencode()` en todo lo que viene del
  usuario, como el nombre de la especie. Es el equivalente a las sentencias
  preparadas, pero para URLs: evita que un parámetro se convierta en otro.
- **Escapado al pintar**: `htmlspecialchars()` en el diagnóstico, que es donde
  se vuelcan respuestas ajenas.
- **No hay SQL**, así que no hay inyección SQL. El vector equivalente aquí es
  la inyección de parámetros en la URL saliente, y es contra eso que se
  defiende la validación.
- **La caché nombra sus archivos con `sha1()` de la URL**, no con el texto que
  escribió el usuario. Si el nombre saliera del parámetro, un `../` permitiría
  escribir fuera de la carpeta.

Lo que **no** tiene, y conviene decirlo: no hay autenticación ni límite de
peticiones por usuario. El `Access-Control-Allow-Origin: *` es cómodo para
desarrollo y sería lo primero que habría que cerrar antes de exponerlo.

## 12. ¿Por qué no hay base de datos esta vez?

En la Práctica 05 MySQL se justificaba: había simulaciones, mediciones y
decisiones relacionadas entre sí, y consultas que cruzaban corridas de
distintas sesiones con `AVG` y `GROUP BY`.

Aquí lo que hay que guardar es: un catálogo de seis especies que no cambia, los
contornos de 177 países que tampoco, y una caché de pares petición → respuesta
con fecha de caducidad. Nada de eso es relacional. Un `sha1(url)` como nombre
de archivo hace el mismo trabajo que una tabla de caché, sin pedirle al que
instale el proyecto que cree una base, un usuario y corra dos scripts.

Dicho esto, el día que hubiera que guardar el histórico de análisis por usuario
—quién consultó qué punto, con qué especie y qué recomendación se emitió— ahí sí
volvería una tabla, porque aparecen relaciones y consultas de conjunto.

## 13. ¿Cómo verificaste que funciona, si las APIs no se pueden probar sin internet?

Esta fue la parte incómoda, y conviene ser transparente: el código se escribió
y se probó en un entorno **sin acceso a las APIs externas**. Así que la
verificación se hizo en dos niveles distintos.

**Los normalizadores, con la caché sembrada.** Como la caché guarda la
respuesta cruda indexada por `sha1(url)`, se pueden escribir ahí respuestas
construidas a mano con la forma que documenta cada API, y entonces
`fuentes.php` las procesa sin distinguir que no vinieron de internet. Con eso
se comprobaron 25 cosas: que el `d_factor` 10 de SoilGrids convierte 65 en pH
6.5, que 310 g/kg de arcilla dan 31 %, que la precipitación de NASA POWER en
mm/día pasa a mm/año, que el índice de aridez sale de dividir los acumulados,
que GBIF encadena bien los dos pasos, y que la geocodificación inversa acierta
en cinco países y devuelve `null` en el océano.

**El frontend completo**, contra ese mismo proxy con la caché sembrada: globo
con 177 países, proyección con error 0 en la ida y vuelta, consulta de un punto,
ranking, decisiones, nube de ocurrencias, comparación A/B con arco, y la
degradación cuando las fuentes fallan.

**Lo que esto NO prueba:** que las APIs reales devuelvan hoy exactamente la
forma que supuse. Si alguna cambió un nombre de campo, el normalizador lo verá
como un dato ausente. Para eso está `api/diagnostico.php`, que llama a las
cuatro **de verdad**, enseña el JSON normalizado y el tiempo de cada una. Es el
primer sitio al que hay que ir si algo sale vacío, y es la comprobación que yo
no pude hacer.

## 14. ¿Qué decisiones reales soporta?

- **Dónde sembrar.** La comparación A/B responde literalmente la pregunta del
  enunciado: dónde crece mejor esta especie, aquí o allá, con datos de clima y
  suelo de los dos sitios y un veredicto que dice cuál es el factor limitante
  del perdedor.
- **Qué sembrar.** El ranking ordena las seis especies del catálogo para un
  mismo punto. Es la pregunta inversa y, en la práctica, la más útil: ya tengo
  la parcela, ¿qué le pongo?
- **Qué corregir primero.** Las reglas geo-agronómicas identifican el factor
  limitante y proponen una acción concreta con su magnitud: cuántos milímetros
  de riego suplementario hacen falta al año, encalar o acidificar según el
  signo de la desviación del pH, prever drenaje si llueve por encima del máximo
  de la especie.
- **Qué riesgo hay.** Días de helada y días sobre 35 °C al año no son promedios
  sino conteos de eventos, y son los que deciden si el ciclo del cultivo cabe
  en la ventana libre de heladas.

**Las limitaciones que hay que declarar al usar los resultados:** el modelo usa
medias anuales y no la estacionalidad, cuando en la realidad lo que importa es
si la lluvia cae durante el ciclo del cultivo; la idoneidad no considera
pendiente, salinidad, acceso al agua ni nada socioeconómico; y GBIF mide
esfuerzo de muestreo tanto como presencia real de la especie.
