# Cambios

Formato: una entrada por versión publicada, de la más nueva a la más vieja. Cada punto dice
qué cambia para quien graba y por qué; los ids (C1, G8-01…) remiten a la revisión del
videotutorial de seguridad-graneros donde apareció el defecto. Las versiones anteriores a la
1.15.0 están descritas en los commits `Versión x.y.z` de `git log`.

## 1.15.0 — 2026-09-30

Todo lo nuevo es compatible con los guiones y configs de la 1.14: lo que cambia de aspecto por
defecto trae su opción para volver al de antes. Los consumidores pueden preguntar por cada
novedad con `CAPACIDADES` en vez de comparar versiones.

### Nuevo

- **`CAPACIDADES`**: lista congelada de lo que sabe hacer el motor instalado
  (`motor.CAPACIDADES?.includes('cursor-tactil')`). Trae `acercar-ajustado`, `cursor-tactil`,
  `subtitulos-partidos`, `navegador-args`, `planos-pantalla-completa`, `dividida-con-foco`,
  `ficha-sin-tapar`, `anotar-al-lado` y `sin-destellos`. Sólo se declara lo implementado:
  `sembrar-funcion` y `vivo`, que seguridad-graneros ya consulta, no están todavía.
- **Portadas y cierres a pantalla completa** (C4, G8-06). `portada()`/`cierre()` marcan la
  página como rótulo plano (`esPlano`), el grabador anota en cada paso si terminó en uno y el
  montaje saca ese tramo del marco: sin ventana, barra de URL ni chip, rellenando con el propio
  color de la tarjeta. Antes parecían una página más del sistema, con el dominio encima.
  `video.rotulos: 'marco'` conserva el aspecto anterior; `paso.marco` lo fuerza por paso.
- **Pantalla dividida con foco** (C5, G4-01, G3-12, G8-11). La mitad del actor que actúa se
  lleva el 72 % del ancho (el texto de 14 px pasa de 7,6 a 11 px en 1920×1080) y la otra queda
  de contexto; los tamaños se invierten al cambiar de actor sin mover el orden, y teléfono y
  sala ya no comparten alto. `video.dividida: { modo: 'foco', foco: 0.72 }` (foco entre 0,5 y
  0,85); `{ modo: 'igual' }` vuelve a la disposición de la 1.14. `actores.<id>.rotulo` suma
  quién es al chip de su mitad.
- **La ficha de `presentar` ya no tapa lo importante** (C3). `posicion: 'auto'` (defecto) elige
  la esquina con menos controles y contenido debajo; antes iba fija abajo a la izquierda y
  tapaba PÁNICO en el APK, tarjetas de la sala y el pie del menú. Mientras está en pantalla se
  corre si el objetivo del paso cae debajo (anillo de `anotar`, `#demo-resalte`,
  `[data-demo-objetivo]`, `evitar` o el cursor del motor). Acepta posición fija por llamada,
  por página con `configurarPresentacion(opciones, page)` o por superficie con
  `superficies.<id>.presentar: { posicion, evitar, margen }`, que el grabador aplica a la página
  de cada actor. `POSICIONES_FICHA` lista las válidas; `abajo-izquierda` es la de siempre.
- **El globo de `anotar` va al lado del objetivo** (C8, G7-02). Iba a 44 px fijos por encima y
  con dos líneas caía sobre el objetivo. Ahora se mide ya renderizado, se prueba en los cuatro
  lados, gana el que cabe, no cruza la ficha y tapa menos contenido, y lleva flecha. `lado`
  (`arriba`, `abajo`, `izquierda`, `derecha`) lo fuerza mientras quepa.
- **«Estás aquí»** en el mapa de superficies (C6, G8-15). El rótulo de la activa decía
  «Usted está aquí» y desentonaba con los sistemas, que tutean. Se cambia por superficie
  (`superficies.<id>.aqui`) o para todo el curso (`video.presentacion.textoAqui`);
  `TEXTO_AQUI` es el defecto.
- **Cursor de toque en superficies táctiles** (C9, G2-38). En el APK y las webs móviles se veía la
  flecha del ratón, que no significa nada en un teléfono y tapaba texto. El grabador elige por
  actor: indicador de toque si el actor o su superficie declaran `tactil: true`, o si su
  `dispositivo` de Playwright es táctil; `tactil: false` lo apaga. `configurarCursor(page,
  { tactil })` y `conCursorOculto(page, fn)` quedan exportados. `video.cursorEnCapturas: false`
  deja las capturas del manual sin cursor ni halo (por defecto siguen con él).
- **`navegador.args`** (D96). El motor lanzaba Chromium sin argumentos y el consumidor no podía
  pasar `--host-resolver-rules` para que el APK y «Enlace generado» muestren el dominio público
  grabando en local. Llega a `grabar`, `preparar` y al pack de contexto. Las reglas de
  resolución sólo pueden mapear a loopback (`127.x`, `localhost`, `[::1]`): mapear a otra
  máquina saltaría el guardián de entorno, que decide por el host de `baseURL`.
- **Subtítulos partidos** (C2, G8-02). `generarVtt` escribía un cue por paso con la locución entera
  (hasta 269 caracteres en una línea, 213 de 262 cues sobre 84 en el curso de
  seguridad-graneros). Ahora cada cue se parte por frases y cada frase en bloques de a lo más
  2 líneas de 42, repartiendo el tiempo según el largo; `generarSrt` parte igual. Partir dos
  veces no cambia nada. `subtitulos: { partir, ancho, lineas }` en la config;
  `partir: false` vuelve al cue por paso. `partirCue`, `partirCues` y `configurarSubtitulos`
  quedan exportados.

### Corregido

- **Un cuadro negro al empezar un tramo** (C1, G8-01). Cada tramo se corta en el ms donde
  empezó su paso, casi nunca en el borde de un cuadro de 40 ms, y el primer cuadro dejaba ver
  el fondo negro: 61 destellos en el tutorial de seguridad-graneros, casi todos al cambiar de
  actor o de página. `fps=25:start_time=0` repite el primer cuadro real del tramo, en el lienzo
  y en los rótulos planos. La duración de los tramos no cambia.
- **`acercarA` corta el objetivo** (C7, G8-08/09, G3-09). Con elementos anchos o fijos al borde (PÁNICO, «Estado
  de la patrulla», el folio de la denuncia) la escala pedida dejaba el objetivo más grande que
  el cuadro. `escala` pasa a ser un máximo: se baja lo justo para que el objetivo quepa con un
  8 % de aire, nunca por debajo de 1 (`escalaQueCabe`). Los topes escritos a mano en los guiones
  sobran; `ajustar: false` vuelve a la escala exacta. El marcador de centrado ya no se pasa
  medio píxel contra un borde (a escala 2 cortaba 2 px del objetivo).
- **El globo de `anotar` se salía de la pantalla en un teléfono**: en 412 px medía 424 porque
  el ancho máximo no descontaba el relleno.
