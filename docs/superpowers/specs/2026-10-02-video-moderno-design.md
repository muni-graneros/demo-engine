# Video moderno: acabado de postproducción (diseño)

Fecha: 2026-10-02 · Estado: aprobado en automode (César pidió «lo más moderno posible» para el
tutorial de seguridad-graneros) · Versión objetivo: 1.18.0

## Punto de partida (mirado en el video real, no supuesto)

Fotogramas de `videos-octubre/seguridad-graneros/final/tutorial-completo.mp4` (39:51, 33 capítulos,
demo-engine 1.16.1/1.17.0):

- **Bien resuelto ya:** lienzo con marco de navegador y de teléfono (mockup), chip de superficie,
  pantalla dividida teléfono + sala con foco (72 %), tarjeta «Estás aquí» con transición 3D, cursor
  sintético con halo, zoom por CDP cuando el guion lo pide (`acercarA`), clic sonoro, voz Kokoro con
  `loudnorm` a −16 LUFS, `.vtt` partido 42×2, cierre con fundido.
- **Lo que hace que se vea «de 2019»:**
  1. La sala completa entra en ~1300 px de ancho: el texto de 14 px queda en ~11 px y **no se
     lee** salvo en los pocos pasos con `acercarA`. Nada guía la mirada hacia donde ocurre el clic.
  2. Los subtítulos solo existen como pista blanda (`mov_text`) y `.vtt`: en la mayoría de los
     reproductores (y en una proyección) **no se ven**. Un tutorial de producto de 2026 los trae
     quemados, cortos y sincronizados con la voz.
  3. El teléfono solo ocupa ~20 % del ancho, con el resto del lienzo vacío.
  4. 25 fps: los movimientos de cámara a 25 fps se ven a saltos.
  5. Silencios largos donde la acción espera sin voz (44 s en c16b, 9 s en c17a).
  6. Nada rotula de qué trata cada escena: el capítulo arranca y hay que adivinar.

## Qué es «moderno» en un tutorial de producto (2026) y qué se elige

Referencia: los videos de producto hechos con Screen Studio / Arcade / Tella. Rasgos comunes y
la decisión para cada uno, ordenados por impacto visual por esfuerzo:

| Rasgo | Decisión |
|---|---|
| Cámara que acerca y sigue la acción (zoom + paneo suave al clic) | **Sí, nuevo** (`acabado.camara`). El mayor salto de legibilidad. |
| Subtítulos quemados, en píldora, sincronizados con la voz | **Sí, nuevo** (`acabado.subtitulos`). Accesibilidad + proyección. El `.vtt` sigue al lado, con los mismos tiempos. |
| Rótulo inferior animado (lower-third) con el título de cada escena | **Sí, nuevo** (`acabado.rotulos`). Entra deslizando, sale con fundido. |
| 60 fps | **Sí, nuevo** (`acabado.fps`). La captura sigue a su ritmo; la cámara y los rótulos se mueven a 60. |
| Sin silencios largos | **Sí, nuevo** (`acabado.silencios`): se recorta lo que pase de 2 s sin voz, protegiendo cada clic. |
| −16 LUFS | Ya estaba en la voz; se **mide** sobre el resultado final y se reporta. |
| Cursor suavizado + resaltado del clic | Ya estaba (curva `cubic-bezier`, halo). Sin cambios. |
| Mockup de dispositivo y teléfono + sala lado a lado | Ya estaba (lienzo, `dividir` con foco). La cámara ahora además acerca el teléfono. |
| Tarjeta de capítulo, intro y outro | Ya estaban (tarjeta «Estás aquí» + transición 3D, cierre con fundido). El consumidor suma un intro breve con la marca. |
| Transiciones sobrias | Se mantienen las 3D entre capítulos; dentro del capítulo, la cámara suaviza los cortes (sale del zoom antes de un corte). |
| Música con ducking | Ya existía la mezcla con `sidechaincompress`; **solo con licencia verificada**. Se agrega una opción de música **generada por el propio motor** (síntesis, sin terceros) para no depender de licencias. |

`prefers-reduced-motion` no aplica a un archivo de video, pero se respeta su espíritu: zoom tope
1,6×, transiciones con curva suave de ≥ 0,6 s, ningún destello (los subtítulos no parpadean entre
cues seguidos: un hueco < 0,35 s se rellena con el cue anterior).

## Diseño

Bloque nuevo, **opt-in**, en `demo.config.mjs`:

```js
video: {
  acabado: {
    fps: 60,
    silencios: { maxSeg: 2, margenSeg: 0.5 },          // null = no recortar
    camara: { zoom: 1.5, zoomTelefono: 1.3 },          // null = sin cámara automática
    subtitulos: { tamano: 34 },                        // null = no quemar
    rotulos: { segundos: 3.2 },                        // null = sin lower-thirds
  },
}
```

Sin `acabado` (defecto `null`), `montar()` y `pegarCapitulos()` no cambian ni un byte: hay más de
diez proyectos usando el motor.

### Dónde corre

En `montar()`, después de pegar los tramos (`mudo.mp4`) y antes de mezclar voz y subtítulos:

1. **Recorte de silencios** (`src/acabado/tiempo.mjs`). Las voces se conocen exactas
   (`inicioSeg` + duración del `.wav`). Cada hueco sin voz de más de `maxSeg` pierde su centro y
   conserva `margenSeg` a cada lado. Nunca se corta a menos de 1 s antes ni 1,2 s después de un
   clic (el clic y su efecto se ven siempre) ni dentro de un paso con `sinRecorte: true`. El plan
   produce una función `mapear(t)` que lleva cada tiempo (voces, clics, cues, focos, bordes de
   tramo) al reloj nuevo; el video se corta con `select` + `setpts` en un solo paso de ffmpeg.
2. **Cámara automática** (`src/acabado/camara.mjs`). El grabador anota cada `pulsar()` con su
   punto (`focos`: tiempo, actor, x, y, escala de página). El montaje lleva ese punto al lienzo
   con la misma geometría que usa `componerEnLienzo` (hueco del actor + escala + relleno). Los
   focos cercanos (≤ 2,5 s, mismo tramo) forman una toma: la cámara entra 0,9 s antes del primer
   clic, pasea de clic en clic, sostiene 1,6 s y sale. Nunca cruza un borde de tramo acercada
   (sale antes del corte) ni toca un rótulo plano. Un clic con la página ya acercada por
   `acercarA` no dispara la cámara (no hay doble zoom). La cámara se aplica con el filtro
   `perspective` (interpolación cúbica, `eval=frame`): sub-píxel y sin el temblor de `zoompan`.
   Las expresiones son una suma de rampas *smoothstep* (sin anidar `if`), una por transición.
3. **Subtítulos y rótulos quemados** (`src/acabado/capas.mjs`). Se dibujan en Chromium (como el
   resto del texto del motor: el ffmpeg estático no trae `drawtext`) como PNG del tamaño del
   lienzo con transparencia, uno por estado distinto (cue visible + fase del rótulo), y se pegan
   con el demuxer `concat` como una sola capa encima del video **después** de la cámara (quedan
   fijos). Píldora `rgba(15,23,42,.88)` con texto blanco (contraste > 15:1), 34 px, abajo al
   centro. Los cues son los mismos del `.vtt` (`partirCues`), pero su tramo es el de la **voz**
   (inicio del paso + duración del `.wav`), no el del paso entero: la frase aparece cuando se dice.
   El rótulo inferior (título de la escena, con el título del guion como antetítulo) entra
   deslizando 0,35 s, se queda y sale con fundido; va arriba a la izquierda para no chocar con
   los subtítulos.
4. **60 fps** (`fps`): el video recortado se lleva a 60 fps antes de la cámara; codificación
   final `libx264 -crf 18`.

`pegarCapitulos()` recibe `fps` (defecto 25) para normalizar capítulos, tarjetas y transiciones
a la misma cadencia; el consumidor pasa `config.video.acabado?.fps`.

Se exporta `quemarCapas()` para que un capítulo armado por el consumidor (el mapa de
superficies de seguridad-graneros) lleve los mismos subtítulos quemados.

### Música sin licencia de terceros

`audio.musica: { generada: true, volumen: 0.08 }` hace que el motor sintetice una cama armónica
suave (acordes en seno con envolvente lenta y paso bajo) del largo del video. Al ser síntesis
propia no hay licencia que verificar. Se mezcla con la atenuación de siempre bajo la voz.

### Capacidades

`CAPACIDADES` suma `acabado` (cámara, subtítulos quemados, rótulos, recorte, fps) y
`musica-generada`, para que los consumidores pregunten antes de usarlas.

## Pruebas

- Unitarias puras: plan de recorte (huecos, márgenes, protección de clics, `mapear`), plan de
  cámara (agrupado, entrada/salida, no cruzar tramos, saltar `escala > 1`, límites del lienzo),
  expresiones de `perspective` evaluadas en JS contra el plan, estados de capas (sin parpadeo entre
  cues), geometría hueco → lienzo, validación de `video.acabado`.
- Con ffmpeg real: un video sintético de 8 s con un recuadro de color en un punto conocido; tras
  la cámara el píxel central del cuadro acercado es el del recuadro (verificación por píxel, como
  pide `demo_engine_presentacion_3d`); el recorte deja la duración esperada; la capa de subtítulos
  pinta la píldora en el tramo del cue y nada fuera de él; 60 fps en la salida.
- De punta a punta contra el juguete (`pruebas/juguete`) con `acabado` activo.

## Fuera de alcance

- La deuda BT.601/BT.709 (decisión de César): el acabado no cambia la matriz de color.
- Cortes cruzados dentro de un capítulo: los cortes de actor siguen siendo secos.
- Subtítulos palabra por palabra (karaoke): Kokoro no entrega tiempos por palabra.
