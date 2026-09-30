# Capa de presentación con marco y transiciones 3D

Fecha: 2026-08-31 · Estado: aprobado para planificar

## Contexto

Los videos que produce demo-engine se ven correctos pero planos: la grabación del navegador
ocupa el cuadro entero, sin fondo, sin marco y sin ningún elemento de composición. Lo que
distingue a un demo de producto de una captura de pantalla es justamente esa capa: fondo con
color, la pantalla presentada como una ventana con esquinas redondeadas y sombra, y algo de
movimiento entre secciones.

El disparador fue evaluar [openvid](https://github.com/CristianOlivera1/openvid), un editor de
video en el navegador que hace exactamente eso. Se descartó integrarlo por dos razones:

1. **Licencia.** openvid está bajo PolyForm Noncommercial 1.0.0. Permite el uso por
   instituciones de gobierno (Municipalidad de Graneros), pero prohíbe el uso comercial
   (KraftDo SpA, muni-kit). demo-engine sirve a los tres frentes: copiar código de openvid
   contaminaría el motor entero.
2. **Forma.** openvid es una aplicación GUI interactiva sin API ni modo headless. Encadenarlo
   metería un paso manual en un pipeline que hoy es un solo comando (`demo todo`).

Three.js, en cambio, es MIT y es una librería independiente: usarla no deriva nada de openvid
y es libre en todos los frentes.

**Resultado buscado:** que `demo todo` siga siendo un comando y que el MP4 que sale se vea
como un demo de producto, sin perder legibilidad del texto ni reproducibilidad.

## Objetivos

- Marco de presentación: fondo, padding, esquinas redondeadas, sombra y barra de ventana.
- Transiciones con movimiento de cámara 3D entre capítulos.
- Adopción opt-in: un proyecto que no declare la config nueva produce exactamente el mismo
  video que hoy.

## No-objetivos

- Editor visual ni previsualización interactiva.
- Movimiento de cámara durante el contenido narrado (ver "Decisión 2").
- Reemplazar el zoom por CDP que ya hace `src/camara.mjs` dentro de la página.

## Decisiones

### Decisión 1 — Composición en dos pases, no uno

El marco frontal se resuelve con filtros ffmpeg; solo las transiciones pasan por Three.js.

**Medición que lo sostiene** (ThinkPad E490, 2026-08-31): renderizar frame a frame en el
Chromium de Playwright cuesta **93,6 ms por frame** con un canvas 2D simple —seek + drawImage
+ captura, viewport 1600×1000—. Un video de 3 minutos a 25 fps son 4500 frames: **7 minutos de
render**, y Three.js sobre SwiftShader será más lento. Con transiciones de 900 ms entre
capítulos son ~23 frames cada una: **~40 s por curso**.

### Decisión 2 — La cámara se mueve entre capítulos, no mientras se narra

Una pantalla inclinada en perspectiva degrada el texto pequeño, y estos videos son manuales de
trámites. La cámara entra con perspectiva y movimiento en la transición, y se asienta frontal
(perspectiva 0) durante todo el contenido. Además de proteger la legibilidad, es lo que hace
viable la Decisión 1: los tramos frontales no pasan por el render 3D.

### Decisión 3 — Adopción opt-in

El bloque `video.presentacion` ausente significa comportamiento idéntico al actual. Hay más de
diez proyectos usando el motor; ninguno debe cambiar sin decidirlo.

## Hallazgos técnicos verificados

Comprobados en esta sesión contra el Chromium que baja Playwright y el ffmpeg de
`ffmpeg-static`:

- **H.264 se decodifica.** `loadedmetadata`, seek exacto a 1,5 s y `drawImage` al canvas
  funcionan. El Chromium de Playwright sí trae los códecs necesarios.
- **`file://` está bloqueado.** Cargar el MP4 como `file://` desde una página falla con
  `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`. El pase 3D **debe** servir
  el video por HTTP local.
- **WebGL 2.0 disponible**, vía `ANGLE (SwiftShader)`: render por software, sin GPU. La escena
  debe ser simple.
- **La cadena de filtros del marco corre y produce lo esperado.** Contra ffmpeg 7.0.2-static:
  `gradients` (con `speed=0` para congelar la animación), `geq`, `boxblur`, `overlay`,
  `colorchannelmixer`, `drawbox` y `pad` están disponibles. Una composición de prueba
  —gradiente 1920×1080, video escalado con esquinas redondeadas por `geq` sobre el canal
  alpha, sombra por `boxblur` + `colorchannelmixer=aa` desplazada, dos `overlay`— sale en
  1920×1080 con la duración de entrada preservada.
- **`drawtext` NO está disponible en el ffmpeg estático** (aunque `--enable-libfreetype`
  aparezca en la configuración del build). Sin él, la barra de ventana con la URL no se puede
  rotular con ffmpeg.
- **El alfa del `geq` es binario: el borde redondeado sale con escalón.**

Los dos últimos hallazgos apuntan a la misma solución, y por eso el marco no se dibuja con
filtros (ver Decisión 4).

### Decisión 4 — El marco se renderiza en el navegador como PNG, una vez

En vez de construir el marco con filtros, se dibuja en HTML/CSS y se captura una sola vez
como PNG con canal alfa. El navegador ya está en el pipeline por las transiciones 3D, así que
no agrega dependencias.

Ventajas sobre la cadena de filtros:

- `border-radius` y `box-shadow` reales, con antialias del navegador: desaparece el escalón
  del `geq`.
- La barra con la URL se rotula con texto y fuente de verdad, sin depender de `drawtext`.
- El marco lleva las esquinas opacas, así que tapa el sobrante del video: ya no hace falta
  recortar el video con `geq`.
- El marco es el mismo objeto que usa la escena 3D, así que el look frontal y el de la
  transición coinciden por construcción.

El costo es un render de un frame por proyecto —milisegundos— y se cachea junto a la salida.
ffmpeg queda reducido a lo que hace bien: `overlay` del video sobre el fondo y del marco
encima.

## Arquitectura

Cuatro módulos nuevos. `src/montaje.mjs` ya tiene 130 líneas densas y no debe crecer.

### `src/render-web.mjs`

Helper compartido por el marco y las transiciones: levanta un servidor HTTP efímero
(puerto 0) que sirve archivos locales y `three` desde `node_modules`, abre Chromium con
Playwright, ejecuta una función contra esa página y cierra todo. Existe porque `file://`
está bloqueado y porque las dos piezas que usan navegador necesitan exactamente lo mismo.

### `src/marco.mjs`

Renderiza el PNG del marco (fondo, ventana con esquinas y sombra, barra con la URL) usando
`render-web`. Un solo frame, cacheado junto a la salida.

### `src/presentacion.mjs`

Compone con ffmpeg el video dentro del marco. Expone dos funciones:

- `cadenaDePresentacion(opciones)` → string de `filter_complex`. Función pura, sin efectos:
  es lo que se testea barato y exhaustivo.
- `componer(mp4Entrada, marcoPng, mp4Salida, opciones)` → invoca `ff()` con esa cadena.

**Punto de inserción:** en `montar()`, sobre `mudo.mp4`, entre el concat (`src/montaje.mjs:57`)
y el paso de voz. Ahí la duración se preserva exacta, los tiempos de voz y subtítulos ya
calculados no se enteran, y el `-c:v copy` del mux final sigue siendo válido.

La barra de ventana muestra la URL real del sistema, derivada de `baseURL` de la config: en un
tutorial municipal eso es información útil, no decoración.

### `src/escenario3d.mjs`

Produce los clips de transición. Algoritmo:

1. Pedir a `render-web` una página con el MP4, la escena y `three` servidos por HTTP local.
   Sin CDN: el motor funciona offline.
2. Cargar el video como `VideoTexture` sobre el plano.
3. Para cada frame `n` de la transición: fijar `video.currentTime = n/fps`, esperar `seeked`,
   posicionar la cámara según la curva de easing, renderizar, capturar el canvas a JPEG.
4. Encodear los frames con ffmpeg a fps constante.

Es determinista por construcción: no se graba en tiempo real, así que no hay frames perdidos
ni deriva contra la voz. La escena vive en `plantillas/escenario/`.

**Punto de inserción:** en `pegarCapitulos()` (`src/curso.mjs`), como clips insertados entre
los capítulos ya normalizados.

### Contabilidad de tiempos

La transición se cuenta como parte del capítulo que **entra**: su duración se suma al inicio
de ese capítulo antes de llamar a `capitulosConTiempos()`. Si no se hace, los offsets de
subtítulos de `src/curso.mjs:48` quedan desfasados contra los marcadores de capítulo. El
marcador cae al comienzo de la transición, que es lo natural al navegar el video.

## Configuración

```js
video: {
  ancho: 1600, alto: 1000,

  // Bloque nuevo. Ausente = comportamiento idéntico al actual.
  presentacion: {
    fondo: null,            // null = gradiente derivado de marca.color; string = color fijo
    padding: 80,            // px de aire alrededor de la ventana
    radio: 16,              // radio de las esquinas
    sombra: true,
    barra: true,            // barra de ventana con la URL de baseURL
    salida: { ancho: 1920, alto: 1080 },
    transicion3d: { activa: true, ms: 900, gradosMax: 12 },
  },
}
```

Los defectos van en `DEFECTOS` de `src/configurar.mjs`, con la misma disciplina que el resto:
`presentacion: null` a nivel raíz, y los defectos internos aplicados solo si el bloque existe.

## Testing

TDD estricto, una tarea por pieza:

1. **`cadenaDePresentacion()`** — test de string puro contra configs conocidas: con y sin
   sombra, con y sin barra, fondo fijo vs derivado de marca. Instantáneo.
1b. **`marco.mjs`** — el PNG sale con las dimensiones de `presentacion.salida`, tiene canal
   alfa, el hueco de la ventana es transparente y la URL de `baseURL` aparece en la barra.
2. **Composición real** — componer un MP4 de 1 s generado con `lavfi` y verificar que la
   duración se preserva y que las dimensiones de salida son las de `presentacion.salida`.
3. **Escenario 3D** — renderizar una transición corta y verificar que salen exactamente N
   frames (`ms/1000*fps`) y que el píxel central difiere entre el primero y el último: si no
   difiere, la cámara no se movió.
4. **No-regresión** — sin bloque `presentacion`, `montar()` produce un video con la misma
   duración y las mismas dimensiones que hoy. Es el test que protege a los diez proyectos.
5. **Contabilidad de tiempos** — con transiciones activas, los marcadores de capítulo y los
   cues de subtítulos siguen alineados.

## Riesgos

- **Render por software.** SwiftShader, sin GPU. La escena usa `MeshBasicMaterial` y la sombra
  va como textura; nada de luces ni sombras reales. Si se pide iluminación de verdad, el costo
  por frame se dispara y la Decisión 1 deja de sostenerse.
- **Accesibilidad (Decreto N°1 / 2015 SEGPRES).** Un archivo de video no responde a
  `prefers-reduced-motion`. Mitigación: transiciones cortas (≤900 ms) y suaves, y
  `transicion3d.activa: false` documentado para generar una versión sin movimiento cuando haga
  falta.
- **Peso del paquete.** `three` suma alrededor de 1,5 MB a demo-engine. Aceptable frente a
  Playwright y ffmpeg-static, que ya están.

## Fuera de alcance

Mockups de dispositivo (teléfono, laptop), fondos con imagen o video, y movimiento de cámara
sincronizado con los `acercarA` de los guiones. Nada de eso es necesario para el objetivo y
todo se puede sumar después sobre esta misma estructura.
