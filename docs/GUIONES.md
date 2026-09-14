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
const { pistas, pasos } = await grabar(guion, { config, sesiones, salida: config.salida, voz });
const { mp4, vtt } = await montar({ pistas, pasos, voz, video: config.video },
  { salida: config.salida, nombre: 'mi-video.mp4' });
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
cada capítulo individual. Un capítulo sin `.vtt` propio (por ejemplo un video pregrabado con
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
- `grabar(guion, { config, sesiones, salida, voz }) → Promise<{pistas, pasos}>`

### Montaje
- `montar({ pistas, pasos, voz, video }, { salida, nombre }) → Promise<{mp4, vtt, segmentos}>`
- `pegarCapitulos(partes, { salida, nombre, titulo, video }) → Promise<{mp4, md, capitulos, vtt}>`
  - `partes`: array de `{id, titulo, archivo}`
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
  — `config.auditoria`: `{ocr, patron, cada, maximo, validar}`; `sospechosos`: `{segundo, archivo, identificadores}[]`
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
- `moverCursorA(page, selector) → Promise<void>` (mueve con easing)
- `pulsar(page, selector, { alPintar? }) → Promise<void>` (mueve, halo, clic)
- `acercarA(page, selector, { escala? }) → Promise<void>` (zoom sobre elemento, escala defecto: 1.6)
- `alejar(page) → Promise<void>` (vuelve al zoom 1:1)

### Portadas
- `portada(page, { titulo, subtitulo?, capitulo?, marca?, esperaMs? }) → Promise<void>`
- `cierre(page, { mensaje, marca?, esperaMs? }) → Promise<void>` (simétrico a `portada`)

### Explainer (personajes y anotaciones)
Para el estilo onboarding corporativo: presentar a los personajes ficticios que atraviesan
el caso y señalar en pantalla lo que se está explicando.

- `elenco(page, { cast, titulo?, marca?, esperaMs? }) → Promise<void>` (lámina con el elenco)
- `presentar(page, { nombre, rol?, foto, esperaMs? }) → Promise<void>` (ficha del personaje)
- `quitarPresentacion(page) → Promise<void>` (la retira)
- `anotar(page, selector, texto, { esperaMs?, permanecer? }) → Promise<void>` (globo sobre un
  elemento; `permanecer: true` lo deja puesto)

