# Guiones: estructura

Un **guion** es un ESM que exporta un objeto `default`:

```js
export default {
  id: 'panel',                  // Clave única, sin guiones
  titulo: 'Navegación del panel',  // Título para portadas

  escenas: [
    {
      id: 'tabla',
      titulo: 'Ver tabla de solicitudes',
      pasos: [
        {
          actor: 'funcionario',               // Debe estar en config.actores
          narrar: 'Hacemos clic en solicitudes.',  // Texto para voz (opcional)
          hacer: async (page) => {
            await page.click('nav a[href="/solicitudes"]');
            await page.waitForSelector('table');
          }
        },
        {
          actor: 'funcionario',
          narrar: 'La tabla muestra todos los casos.',
          hacer: async (page) => {
            await page.waitForTimeout(500);
          }
        }
      ]
    }
  ]
};
```

**Notas:**
- `actor` debe existir en `config.actores`.
- `narrar` es opcional; si está vacío, no se sintetiza voz.
- `hacer` recibe un objeto Playwright `Page` listo para navegar, y un segundo argumento
  `contexto` con, como mínimo, `{ config }` — así el guion puede alcanzar `config.marca`
  (nombre, color, escudo) para pintar `portada()`/`cierre()` con la identidad del sistema en
  vez de con el azul por defecto del paquete:
  ```js
  hacer: async (page, { config }) => {
    await portada(page, { titulo: 'Bienvenida', marca: config.marca });
  }
  ```
  Un guion que declara `hacer(page)` a secas sigue funcionando sin cambios: el segundo
  argumento es adicional, no reemplaza al primero.
- El tiempo de cada paso es `max(pausaMinima, duracionVoz)`.
- `variasPersonas: true` declara que ESE paso muestra legítimamente más de una persona (un
  reporte agregado, una cola) y salta el chequeo en vivo. Sin esa declaración, un paso que
  deje dos identificadores a la vista aborta la grabación — ver
  [PRIVACIDAD.md](PRIVACIDAD.md).

## Guion maestro: `curso.mjs`

Para `demo curso`, se requiere un guion maestro que agrupe capítulos:

```js
export default {
  id: 'curso',
  titulo: 'Curso completo: registro y aprobación',

  capitulos: [
    {
      id: 'cap1',
      titulo: 'Capítulo 1: Entrada al sistema',
      guion: 'login'                // Ejecuta guiones/login.mjs
    },
    {
      id: 'cap2',
      titulo: 'Capítulo 2: Panel principal',
      guion: 'panel'                // Ejecuta guiones/panel.mjs
    },
    {
      id: 'cap3',
      titulo: 'Capítulo 3: Revisión de caso',
      fuente: 'video',              // Archivo de video pregrabado
      archivo: './videos/cap3.mp4'  // Ruta relativa al proyecto
    }
  ]
};
```

Cada capítulo es un guion (que se graba en vivo) o un video (que se incrusta tal cual).

## Pantalla dividida: `dividir`

Un paso puede mostrar a **dos** actores a la vez, lado a lado y en el mismo instante. Sirve
para que un traspaso se vea: la vecina envía y la sala ve entrar el incidente.

```js
pasos: [
  // El actor pasivo tiene que tener algo abierto ANTES de dividir; si no, su panel sale en blanco.
  { actor: 'vecina', narrar: 'Marta envía la denuncia.', hacer: async (page) => { await page.goto('/denuncia'); } },
  { actor: 'operador', dividir: ['vecina', 'operador'], narrar: 'Y la sala la ve entrar.',
    hacer: async (page) => { await page.goto('/consola/sala'); } },
  { actor: 'operador', dividir: null, narrar: 'El operador la abre.', hacer: async (page) => { /* … */ } },
]
```

- `dividir` es un par de actores distintos que incluye al actor del paso. El orden del par es
  el orden en pantalla, de izquierda a derecha.
- Queda vigente en los pasos siguientes hasta un paso con `dividir: null`, y nunca pasa a la
  escena siguiente.
- El chequeo de privacidad revisa **los dos** paneles, porque los dos se ven en el video.
- **Disposición (`video.dividida`):** por defecto `foco`: la mitad del actor
  que actúa en el paso ocupa el 72 % del ancho y la otra queda como vista de contexto; cuando
  el paso siguiente es del otro actor, se invierten los tamaños (el orden izquierda/derecha no
  cambia). Medido en 1920×1080 con dos salas de 1600 px: un texto de 14 px pasa de 7,6 px
  (columnas iguales) a 11 px en la mitad activa. Un teléfono y una sala ya no comparten alto:
  cada uno llega a su tamaño natural (sala a 0,84×, teléfono a 0,93×). `{ modo: 'igual' }`
  vuelve a la disposición de la 1.14. Ver [CONFIGURACION.md](CONFIGURACION.md#tutorial-multi-superficie).
- **Quién es quién:** con dos mitades de la misma superficie, declará `rotulo` en cada actor
  (`operador: { …, rotulo: 'Camila · operadora' }`): en pantalla dividida el chip de su mitad
  dice «Sala de operaciones · Camila · operadora», a tamaño fijo, legible aunque su mitad esté
  achicada. Un rótulo pintado dentro de la página (p. ej. un `rotularPuesto` propio) sigue
  viéndose, pero en la mitad de contexto queda a ~0,3× de su tamaño.

## Portadas y cierres a pantalla completa

`portada()` y `cierre()` marcan la página como rótulo «plano»: el paso que TERMINA mostrando
una portada o un cierre sale a pantalla completa en el video, sin ventana de navegador, barra
de URL ni chip de superficie, con el color y la identidad de `config.marca`. El sobrante (la
grabación no tiene el aspecto del lienzo) se rellena con el propio color de la tarjeta.

- Un paso puede forzarlo: `marco: false` saca a pantalla completa cualquier paso (una lámina
  propia); `marco: true` deja la portada dentro del marco.
- En toda la config: `video.rotulos: 'marco'` vuelve al aspecto de la 1.14.
- Si el paso navega a otra página después de la portada, deja de contar como plano (la marca
  vive en el DOM y se va con la navegación).

## Capítulos de un curso multi-superficie

Con `superficies` en la config ([CONFIGURACION.md](CONFIGURACION.md#tutorial-multi-superficie)),
el guion maestro admite:

```js
capitulos: [
  // Tarjeta de superficies a pantalla completa, sin resaltar, con su locución y su .vtt.
  // Dura max(ms ?? 6000, voz + 600 ms).
  { id: 'mapa', titulo: 'El mapa', tipo: 'mapa', narrar: 'Estas son las partes del sistema.', ms: 8000 },

  // Antes del capítulo entra la tarjeta «usted está aquí»: `superficie` resaltada y la del
  // capítulo previo que declaró una, atenuada. Dura `presentacion.mapaMs` (2500 ms).
  { id: 'avisa', titulo: 'Marta avisa', guion: 'denuncia', superficie: 'denuncia' },

  // Clip nativo (scrcpy): con superficie se compone en su marco y con su chip. El aspecto se
  // mide del archivo, ya enderezado si trae rotación en la metadata (±90° intercambia ancho y
  // alto), y su audio se conserva.
  { id: 'terreno', titulo: 'En terreno', fuente: 'video', archivo: 'demo/clips/terreno.mp4', superficie: 'apk' },
]
```

La tarjeta pertenece al capítulo que **entra**, igual que la transición 3D. El marcador del
capítulo cae al inicio de la transición y sus subtítulos se corren por la transición más la
tarjeta. Un capítulo con `superficie` en una config sin `superficies` es un error, y el
mensaje nombra el capítulo.

## Variantes para redes: `demo formatos`

```bash
demo formatos demo/salida/curso.mp4                # vertical (1080×1920) y cuadrado (1080×1080)
demo formatos demo/salida/curso.mp4 --vertical     # solo uno
```

Escribe `curso-vertical.mp4` y `curso-cuadrado.mp4` al lado del video. No necesita
`demo.config.mjs`.

## Uso programático (Node)

Importa desde `demo-engine`:

```js
import {
  cargarConfig,
  prepararSesiones,
  grabar,
  montar,
  pegarCapitulos,
  generarManual,
  crearVoz,
  exigirEntornoDeDesarrollo
} from 'demo-engine';

const config = await cargarConfig(process.cwd());
const sesiones = await prepararSesiones(config, { dirSesiones: './.sesiones' });
const voz = crearVoz(config.voz);
const { pistas, pasos, origenes, clics, dimensiones } =
  await grabar(guion, { config, sesiones, salida: config.salida, voz });
const { mp4, vtt } = await montar({
  pistas, pasos, voz, video: config.video,
  // Multi-superficie (opcional): sin superficies ni dividir, el montaje es el de siempre.
  superficies: config.superficies, actores: config.actores, origenes, clics, dimensiones,
  // Sin música ni clic activos (los defectos de cargarConfig), montar() usa la cadena mono
  // de siempre; con alguno de los dos, la mezcla estéreo 48 kHz.
  audio: config.audio,
}, { salida: config.salida, nombre: 'mi-video.mp4' });
```

## Archivos de salida

Después de grabar, en `config.salida`:

- **`[guion].mp4`**: video montado, H.264 + AAC. Sale a `video.ancho`×`video.alto`
  (1600x1000 por defecto) o a `video.presentacion.salida` (1920x1080) si declaraste el marco
- **`[guion].vtt`**: WebVTT con subtítulos
- **`[guion].md`**: (solo con `demo curso`) índice de capítulos
- **`[guion].pdf`**: (con `demo manual`) manual con capturas

`demo curso` (o `pegarCapitulos` a mano) además combina los `.vtt` de cada capítulo en un
único `curso.vtt`, desplazando los tiempos de cada uno por el inicio real de su capítulo, y
lo adjunta al `curso.mp4` como pista `mov_text` en español — igual que hace `montar()` con
cada capítulo individual. El audio del curso sale en estéreo 48 kHz. Un capítulo sin `.vtt` propio (por ejemplo un video pregrabado con
`fuente: 'video'`) simplemente no aporta entradas; si NINGÚN capítulo trae subtítulos,
`curso.vtt` no se genera y `pegarCapitulos` devuelve `vtt: null`.

## API Completa

Todas estas funciones se reexportan desde `demo-engine`:

### Configuración
- `cargarConfig(rutaProyecto: string) → Promise<config>`
- `ErrorConfig` — la clase de error que lanza `cargarConfig` cuando la config es inválida.

### Sesiones
- `prepararSesiones(config, { dirSesiones }) → Promise<Record<actor, rutaSesion>>` — loguea a
  TODOS los actores de `config.actores` (lo que usa el comando `preparar`).
- `prepararSesionesParaGuion(guion, config, { dirSesiones }) → Promise<Record<actor, rutaSesion>>`
  — reutiliza los `storageState` que ya estén en disco y solo loguea a los actores que el
  guion usa (lo que usan `grabar`/`curso`/`manual`). Antes de reutilizar un `storageState`
  comprueba, contra el sistema real, que la sesión SIGA sirviendo (con `sesionSigueViva`); si
  caducó del lado del servidor, relogueá a ese actor de forma transparente en vez de dejar
  que el fallo aparezca a mitad de la grabación siguiente.
- `sesionSigueViva(archivo, config, login) → Promise<boolean>` — comprueba si un
  `storageState` guardado en disco todavía sirve para entrar, navegando a `login.url` con esa
  sesión: con `login.comprobar`, que exista ese selector; sin él, que queden cookies y que no
  se esté en la URL de login (mismo criterio que usa `prepararSesiones` para validar un login
  recién hecho).
- `actoresDeGuion(guion) → string[]` — actores que un guion usa, recorriendo sus escenas y pasos.
- `totp(secreto: string, segundos?: number) → código6Digitos`

### Grabación
- `grabar(guion, { config, sesiones, salida, voz }) → Promise<{pistas, pasos, origenes, clics, dimensiones}>`
  - `pistas`: `{actor: rutaMp4}`, una pista por actor
  - `pasos`: los pasos con sus tiempos (`tLocal`, `tGlobal`, `duracionMs`), locución y `dividir`
  - `origenes`: `{actor: ms}`, en qué instante del reloj global arrancó la pista de cada actor
  - `clics`: ms del reloj global en que hubo un clic (para el sonido de clic)
  - `dimensiones`: `{actor: {ancho, alto}}`, el tamaño real de la pista de cada actor

### Montaje
- `montar({ pistas, pasos, voz, video, presentacion?, marca?, baseURL?, superficies?, actores?, origenes?, clics?, dimensiones?, audio? }, { salida, nombre }) → Promise<{mp4, vtt, segmentos}>`
  - Sin `superficies` y sin pasos con `dividir`, el montaje es el de siempre (mismo video).
  - `superficies`/`actores`: `config.superficies` y `config.actores`; cada tramo se compone
    en el marco (teléfono o ventana) de la superficie de su actor, con su chip.
  - `origenes`, `clics`, `dimensiones`: tal como los devuelve `grabar()`; `origenes` es
    obligatorio para un tramo con `dividir`.
  - `audio`: `config.audio`. Solo con `musica` o `clic.activo` se usa la mezcla estéreo
    48 kHz; con los defectos (o `null`), la cadena mono de siempre.
- `pegarCapitulos(partes, { salida, nombre, titulo, video, presentacion?, marca? }) → Promise<{mp4, md, capitulos, vtt}>`
  - `partes`: array de `{id, titulo, archivo, tarjeta?}`; `tarjeta` es un mp4 mudo (la
    tarjeta de superficies, «usted está aquí») que entra después de la transición 3D y
    antes del clip de ese capítulo
  - `vtt`: ruta al `.vtt` combinado del curso, o `null` si ningún capítulo traía subtítulos

### Salida
- `generarManual({ guion, pasos, marca }, { salida }) → Promise<{pdf}>`
- `capturarContexto({ config, sesiones, salida }) → Promise<{salida, ok, fail, manifest}>` —
  el pack de contexto: un PNG por pantalla de `config.contexto.pantallas` más el manifiesto
  `pantallas.json`. Una pantalla que falla NO tumba el pack: queda anotada con su error.
  Exige el entorno declarado igual que `grabar` (si no, fotografía el sistema real).

### Voz
- `crearVoz(config: {motor?, voz?, respaldo?, venv?, voces?}) → vozEngine`
  - `.disponible() → bool`
  - `.sintetizar(texto) → rutaWav | null`
  - `venv`/`voces` son opcionales; sin ellos, resuelve por `DEMO_VENV`/`DEMO_VOCES`, después
    por el directorio del propio paquete y después por `~/.cache/demo-engine`
    (el orden completo está en [CONFIGURACION.md](CONFIGURACION.md))
  - si `motor !== 'ninguno'` y no encuentra ningún motor disponible, escribe un aviso por
    `stderr` (no lanza excepción: sigue degradando a subtítulos-sin-locución)

### Privacidad
- `exigirEntornoDeDesarrollo(baseURL, env?) → void` (falla si el entorno no está DECLARADO
  como dev en `DEMO_ENTORNO`/`APP_ENV`, o si el host es público; sin declaración no graba)
- `cubrir(page) → Promise<void>` (cubre toda la pantalla con panel opaco)
- `descubrir(page) → Promise<void>` (destapa la pantalla)
- `abrirFiltrado(page, url, { filtro, valor, selectorFilas, alPintar?, esperaMs? }) → Promise<void>`
- `abrirVerificado(page, url, comprobar, { alPintar?, preparar?, esperaMs?, estabilidadRequerida?, mensajeError? }?) → Promise<void>`
  — genérico: usa esto para pantallas sin buscador; `abrirFiltrado` se construye encima.
- `identificadoresEnPantalla(page, { patron?, validar? }?) → Promise<string[]>` — lee el DOM
  ya pintado (sin OCR) y devuelve los identificadores distintos que hay a la vista.
- `exigirUnaSolaPersona(page, auditoria) → Promise<void>` — el chequeo en vivo: cubre la
  pantalla y lanza si hay más de un identificador. Lo llama `grabar()` al cerrar cada paso;
  `auditoria.chequeoEnVivo: false` lo desactiva.

### Auditoría
- `auditarVideo(video, config, { dirFrames?, ocr? }?) → Promise<{total, sospechosos}>`
  — `config.auditoria`: `{ocr, token, patron, cada, maximo, validar}` (`token` va en el header
    `X-Service-Token`; `maximo: null` = sin tope, cubre todo el video); `sospechosos`: `{segundo, archivo, identificadores}[]`
  — `ocr` es inyectable (para pruebas); sin él usa el endpoint real de `config.auditoria.ocr`
- `auditarCapturas(dirCapturas, config, { ocr? }?) → Promise<{total, sospechosos}>`
  — audita las capturas del manual (`config.salida/capturas`), mismo criterio que `auditarVideo`
    pero sin muestreo (una imagen por paso, se auditan todas); `sospechosos`: `{archivo, identificadores}[]`
  — sin la carpeta de capturas en disco, devuelve `{total: 0, sospechosos: []}` sin fallar
- `muestrearFrames(video, { cada, maximo, dirSalida }) → {segundo, archivo}[]` (usa ffmpeg, no ffprobe)
- `contarIdentificadores(texto, patron, validar?) → string[]` (identificadores DISTINTOS que
  matchean el patrón; `validar?: (id: string) => boolean` opcional descarta coincidencias que
  no aprueban — ver "Validación de identificadores" más arriba; sin él, cuenta todo lo que
  matchea, como siempre)
- `exigirAuditoriaConfigurada(auditoria) → void` (falla con mensaje claro si falta `auditoria.ocr`)

### Cámara (visual)
- `configurarCamara({ msCursor }) → void` (fija cuánto tarda el puntero en viajar; lo llama
  `grabar()` con `config.video.msCursor`)
- `instalarCursor(page) → Promise<void>` (dibuja cursor SVG, idempotente)
- `configurarCursor(page, { tactil }) → void` (1.15: `tactil: true` dibuja un indicador de toque
  en vez de la flecha; el grabador lo fija por actor con `tactil`/`dispositivo`)
- `conCursorOculto(page, fn) → Promise` (1.15: corre `fn` —p. ej. una captura— sin cursor ni halo)
- `moverCursorA(page, selector) → Promise<void>` (mueve con easing)
- `pulsar(page, selector, { alPintar? }) → Promise<void>` (mueve, halo, clic)
- `acercarA(page, selector, { escala?, ajustar?, margen? }) → Promise<void>` (zoom sobre elemento, escala defecto: 1.6)
  — desde 1.15 `escala` es un MÁXIMO: si a esa escala el objetivo no cabe entero, se baja lo
    justo para que ocupe a lo más `margen` (0,92) del cuadro, nunca por debajo de 1
    (`escalaQueCabe`). Un botón fijo abajo o una franja de ancho completo ya no salen
    cortados, así que los topes de escala escritos a mano en los guiones sobran (no molestan:
    el motor nunca sube una escala). `ajustar: false` vuelve a la escala exacta.
  — deja el elemento centrado en pantalla también en paneles con barras fijas y contenido que
    se desplaza dentro de un contenedor propio (Filament 5 SPA) y en layouts de alto fijo (una
    sala React): primero lo centra dentro de sus contenedores con scroll (sin restaurarlos al
    `alejar`) y después desplaza el viewport visual. Si la raíz tiene overflow hidden/clip, el
    documento no se mueve (sin franja vacía); un elemento pegado al borde queda lo más cerca
    posible del centro sin mostrar nada fuera de la página. Desde v1.14.1 ya no hacen falta
    ayudantes propios tipo `enfocar`/`soltar` para esto.
- `alejar(page) → Promise<void>` (vuelve al zoom 1:1)

### Portadas
- `portada(page, { titulo, subtitulo?, capitulo?, marca?, esperaMs? }) → Promise<void>`
- `cierre(page, { mensaje, marca?, esperaMs? }) → Promise<void>` (simétrico a `portada`)
- `esPlano(page) → Promise<'portada'|'cierre'|null>` (lo usa el grabador; ver «Portadas y cierres a pantalla completa»)

### Explainer (personajes y anotaciones)
Para el estilo onboarding corporativo: presentar a los personajes ficticios que atraviesan
el caso y señalar en pantalla lo que se está explicando.

- `elenco(page, { cast, titulo?, marca?, esperaMs? }) → Promise<void>` (lámina con el elenco)
- `presentar(page, { nombre, rol?, foto, esperaMs? }) → Promise<void>` (ficha del personaje)
- `quitarPresentacion(page) → Promise<void>` (la retira)
- `anotar(page, selector, texto, { esperaMs?, permanecer? }) → Promise<void>` (globo sobre un
  elemento; `permanecer: true` lo deja puesto)

