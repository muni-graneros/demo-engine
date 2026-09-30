# Capa de presentación con marco y transiciones 3D — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los videos de demo-engine salgan con fondo, ventana con sombra y transiciones 3D entre capítulos, sin perder legibilidad ni reproducibilidad.

**Architecture:** El marco se dibuja UNA vez en el navegador y se guarda como PNG con alfa; ffmpeg solo hace `overlay` del video sobre el fondo y del marco encima. Las transiciones entre capítulos se renderizan frame a frame con Three.js (determinista, sin grabar en tiempo real) y se insertan como clips en `pegarCapitulos()`. Todo es opt-in: sin el bloque `video.presentacion`, el motor produce exactamente el mismo video que hoy.

**Tech Stack:** Node ≥20 ESM puro · ffmpeg 7.0.2 (`ffmpeg-static`) · Playwright/Chromium · Three.js (MIT) · `node:test` + `node:assert/strict`

**Spec:** `docs/superpowers/specs/2026-08-31-presentacion-3d-design.md`

## Global Constraints

- **Rama:** `develop`. Nunca pushear ni tocar `main`.
- **Idioma:** código, nombres de variables y símbolos en inglés-neutro según el estilo YA existente del repo (que usa español: `montar`, `pistas`, `duracion`). **Seguir el estilo del repo: identificadores en español.** Mensajes de commit en español.
- **Sin dependencias nuevas salvo `three`.** Nada de CDN: el motor funciona offline.
- **`drawtext` NO existe** en este ffmpeg. Todo texto se rotula en el navegador.
- **`file://` está bloqueado** para `<video>`: siempre servir por HTTP local.
- **Opt-in:** `video.presentacion` ausente ⇒ salida byte-compatible en dimensiones y duración con la actual.
- **Estilo de tests:** `node --test pruebas/`, un archivo por módulo, helpers locales que fabrican material con `lavfi` (ver `pruebas/montaje.test.mjs:9`).
- Cada tarea termina con `node --test pruebas/` en verde antes del commit.

---

### Task 1: Config `video.presentacion` opt-in

**Files:**
- Modify: `src/configurar.mjs:47` (objeto `DEFECTOS`) y el `return` de `cargarConfig`
- Test: `pruebas/configurar.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: `cfg.video.presentacion` — `null`, o el objeto `{ fondo, padding, radio, sombra, barra, salida: { ancho, alto }, transicion3d: { activa, ms, gradosMax } }` con defectos aplicados. Todas las tareas siguientes leen esta forma.

- [ ] **Step 1: Write the failing test**

Agregar al final de `pruebas/configurar.test.mjs`:

```js
test('presentacion queda en null si el proyecto no la declara', async () => {
    const cfg = await cargarConfig(proyecto(minima));
    assert.equal(cfg.video.presentacion, null);
});

test('presentacion aplica sus defectos cuando el bloque existe', async () => {
    const cfg = await cargarConfig(proyecto({ ...minima, video: { presentacion: { padding: 120 } } }));
    const p = cfg.video.presentacion;
    assert.equal(p.padding, 120);          // lo declarado gana
    assert.equal(p.radio, 16);             // el resto viene del defecto
    assert.equal(p.sombra, true);
    assert.equal(p.barra, true);
    assert.equal(p.fondo, null);           // null = derivar de marca.color
    assert.deepEqual(p.salida, { ancho: 1920, alto: 1080 });
    assert.deepEqual(p.transicion3d, { activa: true, ms: 900, gradosMax: 12 });
    // declarar presentacion no debe pisar ancho/alto de grabación
    assert.equal(cfg.video.ancho, 1600);
    assert.equal(cfg.video.alto, 1000);
});

test('presentacion respeta un sub-bloque parcial de transicion3d', async () => {
    const cfg = await cargarConfig(proyecto({
        ...minima, video: { presentacion: { transicion3d: { activa: false } } },
    }));
    assert.equal(cfg.video.presentacion.transicion3d.activa, false);
    assert.equal(cfg.video.presentacion.transicion3d.ms, 900);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pruebas/configurar.test.mjs`
Expected: FAIL — `cfg.video.presentacion` es `undefined`, no `null`.

- [ ] **Step 3: Write minimal implementation**

En `src/configurar.mjs`, junto a `DEFECTOS`:

```js
// `presentacion` queda en null a propósito: es OPT-IN. Hay más de diez proyectos usando el
// motor y ninguno debe cambiar de aspecto sin declararlo. Los defectos de adentro viven
// aparte porque solo se aplican si el bloque existe; fusionarlos siempre convertiría la
// ausencia del bloque en "presentación con todo por defecto", que es justo lo contrario.
const DEFECTOS_PRESENTACION = {
    fondo: null,        // null = gradiente derivado de marca.color
    padding: 80,
    radio: 16,
    sombra: true,
    barra: true,
    salida: { ancho: 1920, alto: 1080 },
    transicion3d: { activa: true, ms: 900, gradosMax: 12 },
};
```

Agregar `presentacion: null` a `DEFECTOS.video`, y en el `return` de `cargarConfig` reemplazar la línea de `video` por:

```js
video: fusionarVideo(DEFECTOS.video, cruda.video),
```

Y la función auxiliar, arriba de `cargarConfig`:

```js
/** Fusiona `video`, tratando `presentacion` (y su `salida`/`transicion3d`) como sub-bloques
 *  opt-in: ausentes se quedan en null, presentes reciben sus defectos. */
function fusionarVideo(defectos, cruda = {}) {
    const video = { ...defectos, ...cruda };
    if (!cruda.presentacion) {
        video.presentacion = null;
        return video;
    }
    video.presentacion = {
        ...DEFECTOS_PRESENTACION,
        ...cruda.presentacion,
        salida: { ...DEFECTOS_PRESENTACION.salida, ...cruda.presentacion.salida },
        transicion3d: { ...DEFECTOS_PRESENTACION.transicion3d, ...cruda.presentacion.transicion3d },
    };
    return video;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pruebas/configurar.test.mjs`
Expected: PASS, incluidos los tests que ya existían.

- [ ] **Step 5: Commit**

```bash
git add src/configurar.mjs pruebas/configurar.test.mjs
git commit -m "Agregar config opt-in video.presentacion

Los defectos del bloque viven aparte y solo se aplican si el proyecto lo
declara: sin eso, la ausencia del bloque equivaldría a activar la
presentación con todo por defecto y cambiaría el video de los diez
proyectos que ya usan el motor."
```

---

### Task 2: Instalar `three` y el helper `render-web`

**Files:**
- Modify: `package.json` (dependencia `three`)
- Create: `src/render-web.mjs`
- Test: `pruebas/render-web.test.mjs`

**Interfaces:**
- Consumes: nada.
- Produces: `conPagina(archivos, tarea)` — `archivos` es un objeto `{ '/ruta': rutaEnDisco }`; monta un server HTTP efímero que sirve esos archivos más `/three.module.js` desde `node_modules/three`, abre una página de Chromium en `/` (con un `<html>` vacío), llama `await tarea(page, baseUrl)` y cierra todo. Devuelve lo que devuelva `tarea`. Las tareas 3 y 6 lo usan.

- [ ] **Step 1: Write the failing test**

Crear `pruebas/render-web.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conPagina } from '../src/render-web.mjs';

test('sirve un archivo local y lo deja leer desde la página', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-web-'));
    const txt = join(dir, 'dato.txt');
    writeFileSync(txt, 'hola');

    const leido = await conPagina({ '/dato.txt': txt }, async (page) => {
        return page.evaluate(async () => (await fetch('/dato.txt')).text());
    });
    assert.equal(leido, 'hola');
});

test('sirve three desde node_modules, sin CDN', async () => {
    const ok = await conPagina({}, async (page) => {
        return page.evaluate(async () => {
            const m = await import('/three.module.js');
            return typeof m.Scene === 'function' && typeof m.VideoTexture === 'function';
        });
    });
    assert.equal(ok, true);
});

test('cierra el servidor al terminar', async () => {
    let base = null;
    await conPagina({}, async (_page, baseUrl) => { base = baseUrl; });
    await assert.rejects(fetch(base + '/'), /fetch failed|ECONNREFUSED/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pruebas/render-web.test.mjs`
Expected: FAIL — `Cannot find module '../src/render-web.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```bash
npm install three
```

Crear `src/render-web.mjs`:

```js
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { extname, dirname, join } from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);

const TIPOS = {
    '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html',
};

/**
 * Abre una página de Chromium con `archivos` servidos por HTTP local y ejecuta `tarea`.
 *
 * El servidor no es un lujo: Chromium rechaza cargar un `<video src="file://...">` con
 * `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`, así que el MP4 tiene que
 * viajar por HTTP sí o sí. Y `three` se sirve desde `node_modules` en vez de un CDN porque
 * el motor tiene que funcionar sin red.
 *
 * @param {Record<string,string>} archivos mapa `/ruta-en-la-web` → ruta en disco
 * @param {(page: import('playwright').Page, baseUrl: string) => Promise<any>} tarea
 */
export async function conPagina(archivos, tarea) {
    const three = require.resolve('three');
    const rutaThree = join(dirname(three), '..', 'build', 'three.module.js');
    const mapa = { ...archivos, '/three.module.js': rutaThree };

    const servidor = createServer((req, res) => {
        const ruta = req.url.split('?')[0];
        if (ruta === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end('<!doctype html><html><body style="margin:0"></body></html>');
        }
        const archivo = mapa[ruta];
        if (!archivo) { res.writeHead(404); return res.end(); }
        const cuerpo = readFileSync(archivo);
        res.writeHead(200, {
            'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream',
            'Content-Length': cuerpo.length,
            'Accept-Ranges': 'bytes',
        });
        res.end(cuerpo);
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    const baseUrl = `http://127.0.0.1:${servidor.address().port}`;

    const navegador = await chromium.launch();
    try {
        const page = await navegador.newPage();
        await page.goto(baseUrl + '/');
        return await tarea(page, baseUrl);
    } finally {
        await navegador.close();
        await new Promise((ok) => servidor.close(ok));
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pruebas/render-web.test.mjs`
Expected: PASS los tres.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/render-web.mjs pruebas/render-web.test.mjs
git commit -m "Agregar helper de render en navegador con three servido local

Chromium rechaza cargar un video por file:// (URL safety check), así que el
MP4 tiene que ir por HTTP. El marco y las transiciones necesitan lo mismo:
un server efímero, una página y three sin CDN, porque el motor debe correr
sin red."
```

---

### Task 3: `marco.mjs` — el PNG del marco

**Files:**
- Create: `src/marco.mjs`
- Create: `plantillas/escenario/marco.html`
- Test: `pruebas/marco.test.mjs`

**Interfaces:**
- Consumes: `conPagina` de `src/render-web.mjs`.
- Produces: `renderizarMarco({ salida, presentacion, marca, baseURL })` → `Promise<string>` con la ruta del PNG. El PNG mide `presentacion.salida.ancho × alto`, tiene el hueco de la ventana transparente y el resto opaco. La tarea 4 lo consume.

- [ ] **Step 1: Write the failing test**

Crear `pruebas/marco.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { renderizarMarco } from '../src/marco.mjs';

const presentacion = {
    fondo: null, padding: 80, radio: 16, sombra: true, barra: true,
    salida: { ancho: 960, alto: 540 },
    transicion3d: { activa: true, ms: 900, gradosMax: 12 },
};

/** Devuelve el pixel RGBA en (x,y) del PNG, leyendo por ffmpeg a rawvideo. */
function pixel(png, x, y) {
    const r = spawnSync(RUTA_FFMPEG, ['-i', png, '-vf', `crop=1:1:${x}:${y}`,
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1e6 });
    return [...r.stdout.subarray(0, 4)];
}

test('el marco sale con las dimensiones de salida y el centro transparente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-marco-'));
    const png = await renderizarMarco({
        salida: dir, presentacion, marca: { color: '#1e3a8a' }, baseURL: 'http://localhost:8000',
    });
    assert.ok(existsSync(png));

    // el centro es el hueco donde va el video: alfa 0
    assert.equal(pixel(png, 480, 300)[3], 0);
    // la esquina es fondo opaco
    assert.equal(pixel(png, 4, 4)[3], 255);
});

test('la barra muestra la URL del sistema', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-marco-'));
    const texto = await renderizarMarco({
        salida: dir, presentacion, marca: { color: '#1e3a8a' },
        baseURL: 'http://localhost:8000', devolverTexto: true,
    });
    assert.match(texto, /localhost:8000/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pruebas/marco.test.mjs`
Expected: FAIL — `Cannot find module '../src/marco.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Crear `plantillas/escenario/marco.html` — una página que dibuja fondo, ventana y barra, con el hueco recortado:

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body { margin:0; background:transparent; }
  #fondo { position:fixed; inset:0; }
  #ventana { position:fixed; border-radius:var(--radio); overflow:hidden;
             box-shadow:0 30px 60px rgba(0,0,0,.45), 0 8px 20px rgba(0,0,0,.3); }
  #barra { height:38px; display:flex; align-items:center; gap:8px; padding:0 12px;
           background:#1f2937; font:13px/1 system-ui,sans-serif; color:#cbd5e1; }
  .luz { width:11px; height:11px; border-radius:50%; }
  #url { flex:1; text-align:center; background:#111827; border-radius:6px;
         padding:5px 10px; color:#e5e7eb; }
  /* El hueco: transparente de verdad, para que el video se vea por debajo del PNG. */
  #hueco { background:transparent; }
</style></head>
<body>
  <div id="fondo"></div>
  <div id="ventana">
    <div id="barra">
      <span class="luz" style="background:#ef4444"></span>
      <span class="luz" style="background:#f59e0b"></span>
      <span class="luz" style="background:#22c55e"></span>
      <span id="url"></span>
    </div>
    <div id="hueco"></div>
  </div>
</body></html>
```

Crear `src/marco.mjs`:

```js
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conPagina } from './render-web.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLANTILLA = join(AQUI, '..', 'plantillas', 'escenario', 'marco.html');

/** Alto de la barra de ventana, en px. Debe coincidir con el CSS de marco.html. */
export const ALTO_BARRA = 38;

/**
 * Calcula dónde queda el hueco del video dentro del marco. Es la geometría que después
 * necesita ffmpeg para pegar el video en el lugar exacto, así que vive acá —una sola
 * fuente de verdad— en vez de recalcularse en presentacion.mjs.
 */
export function geometria({ salida, padding, barra }) {
    const alturaBarra = barra ? ALTO_BARRA : 0;
    const ancho = salida.ancho - padding * 2;
    const alto = salida.alto - padding * 2 - alturaBarra;
    return { x: padding, y: padding + alturaBarra, ancho, alto, alturaBarra };
}

/**
 * Renderiza el PNG del marco una sola vez.
 *
 * El marco NO se dibuja con filtros de ffmpeg por dos razones medidas: `drawtext` no está
 * compilado en el ffmpeg estático (así que la URL de la barra no se puede rotular), y el
 * alfa de `geq` es binario, con lo que las esquinas redondeadas salen con escalón. El
 * navegador da border-radius y box-shadow con antialias real, y ya está en el pipeline.
 */
export async function renderizarMarco({ salida, presentacion, marca, baseURL, devolverTexto = false }) {
    const { ancho, alto } = presentacion.salida;
    const g = geometria(presentacion);
    const fondo = presentacion.fondo
        ?? `linear-gradient(135deg, ${marca.color} 0%, #0f172a 100%)`;
    const png = join(salida, 'marco.png');

    return conPagina({ '/marco.html': PLANTILLA }, async (page, baseUrl) => {
        await page.setViewportSize({ width: ancho, height: alto });
        await page.goto(baseUrl + '/marco.html');
        const texto = await page.evaluate(({ g, fondo, url, radio }) => {
            document.getElementById('fondo').style.background = fondo;
            const v = document.getElementById('ventana');
            v.style.setProperty('--radio', radio + 'px');
            v.style.left = g.x + 'px';
            v.style.top = (g.y - g.alturaBarra) + 'px';
            v.style.width = g.ancho + 'px';
            v.style.height = (g.alto + g.alturaBarra) + 'px';
            document.getElementById('hueco').style.height = g.alto + 'px';
            document.getElementById('url').textContent = url;
            return document.getElementById('url').textContent;
        }, { g, fondo, url: baseURL, radio: presentacion.radio });

        if (devolverTexto) return texto;
        await page.screenshot({ path: png, omitBackground: true, type: 'png' });
        return png;
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pruebas/marco.test.mjs`
Expected: PASS los dos.

- [ ] **Step 5: Commit**

```bash
git add src/marco.mjs plantillas/escenario/marco.html pruebas/marco.test.mjs
git commit -m "Renderizar el marco de presentación como PNG en el navegador

Con filtros no se podía: drawtext no está compilado en el ffmpeg estático,
así que la URL de la barra no se puede rotular, y el alfa de geq es binario
y deja las esquinas con escalón. El navegador ya está en el pipeline y da
border-radius y box-shadow con antialias real."
```

---

### Task 4: `presentacion.mjs` — componer video + marco con ffmpeg

**Files:**
- Create: `src/presentacion.mjs`
- Test: `pruebas/presentacion.test.mjs`

**Interfaces:**
- Consumes: `geometria` de `src/marco.mjs`; `ff` y `duracion` de `src/ffmpeg.mjs`.
- Produces:
  - `cadenaDePresentacion(presentacion)` → string de `filter_complex`.
  - `componer(mp4Entrada, marcoPng, mp4Salida, presentacion)` → `string` con la ruta de salida.

  La tarea 5 consume `componer`.

- [ ] **Step 1: Write the failing test**

Crear `pruebas/presentacion.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff, duracion } from '../src/ffmpeg.mjs';
import { cadenaDePresentacion, componer } from '../src/presentacion.mjs';

const presentacion = {
    fondo: null, padding: 80, radio: 16, sombra: true, barra: true,
    salida: { ancho: 960, alto: 540 },
    transicion3d: { activa: true, ms: 900, gradosMax: 12 },
};

test('la cadena escala el video al hueco y superpone el marco encima', () => {
    const c = cadenaDePresentacion(presentacion);
    // hueco = 960-160 de ancho, 540-160-38 de alto
    assert.match(c, /scale=800:342/);
    // el video va primero y el marco después: el marco tapa el sobrante de las esquinas
    assert.ok(c.indexOf('[video]') < c.indexOf('[marco]'), 'el marco debe superponerse último');
    assert.match(c, /overlay=80:118/);   // x=padding, y=padding+altoBarra
});

test('sin barra, el hueco ocupa todo el alto disponible', () => {
    const c = cadenaDePresentacion({ ...presentacion, barra: false });
    assert.match(c, /scale=800:380/);
    assert.match(c, /overlay=80:80/);
});

test('compone preservando la duración y con las dimensiones de salida', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-pres-'));
    const entrada = join(dir, 'crudo.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x400:rate=25', '-t', '2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', entrada]);
    const marco = join(dir, 'marco.png');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=960x540,format=rgba', '-frames:v', '1', marco]);

    const salida = componer(entrada, marco, join(dir, 'listo.mp4'), presentacion);
    assert.ok(existsSync(salida));
    assert.ok(Math.abs(duracion(salida) - 2) < 0.2, `duración ${duracion(salida)}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pruebas/presentacion.test.mjs`
Expected: FAIL — `Cannot find module '../src/presentacion.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Crear `src/presentacion.mjs`:

```js
import { ff } from './ffmpeg.mjs';
import { geometria } from './marco.mjs';

/**
 * Construye la cadena de `filter_complex` que mete el video dentro del marco.
 *
 * El orden importa y no es negociable: primero el video sobre el fondo, y el marco ENCIMA.
 * El PNG del marco lleva las esquinas opacas, así que al ir último tapa el sobrante
 * rectangular del video. Si se invirtiera el orden habría que recortar el video con `geq`,
 * que es justo lo que estamos evitando (su alfa es binario y deja escalón).
 *
 * Entradas esperadas por `componer`: [0] el video, [1] el PNG del marco.
 */
export function cadenaDePresentacion(presentacion) {
    const { ancho, alto } = presentacion.salida;
    const g = geometria(presentacion);
    return [
        `color=c=black:s=${ancho}x${alto}[fondo]`,
        `[0:v]scale=${g.ancho}:${g.alto}[video]`,
        `[fondo][video]overlay=${g.x}:${g.y}[conVideo]`,
        `[1:v]scale=${ancho}:${alto}[marco]`,
        `[conVideo][marco]overlay=0:0,format=yuv420p[salida]`,
    ].join(';');
}

/**
 * Compone `mp4Entrada` dentro de `marcoPng` y escribe `mp4Salida`.
 *
 * `-shortest` fija la duración a la del video: el marco es una imagen fija y, sin eso, el
 * `color` del fondo (que es infinito) haría un archivo sin final.
 */
export function componer(mp4Entrada, marcoPng, mp4Salida, presentacion) {
    ff(['-y', '-i', mp4Entrada, '-i', marcoPng,
        '-filter_complex', cadenaDePresentacion(presentacion),
        '-map', '[salida]', '-shortest',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', mp4Salida]);
    return mp4Salida;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pruebas/presentacion.test.mjs`
Expected: PASS los tres.

- [ ] **Step 5: Commit**

```bash
git add src/presentacion.mjs pruebas/presentacion.test.mjs
git commit -m "Componer el video dentro del marco con ffmpeg

El marco va superpuesto ÚLTIMO: sus esquinas opacas tapan el sobrante
rectangular del video, y así no hace falta recortarlo con geq."
```

---

### Task 5: Integrar la presentación en `montar()`

**Files:**
- Modify: `src/montaje.mjs:57` (después del concat, antes del paso de voz)
- Test: `pruebas/montaje.test.mjs`

**Interfaces:**
- Consumes: `componer` de `src/presentacion.mjs`, `renderizarMarco` de `src/marco.mjs`.
- Produces: `montar()` acepta `presentacion`, `marca` y `baseURL` dentro de su primer argumento; sin `presentacion`, el comportamiento es idéntico al actual.

- [ ] **Step 1: Write the failing test**

Agregar a `pruebas/montaje.test.mjs`:

```js
test('sin presentacion, el video conserva las dimensiones de grabación', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 4, 'blue') };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 3000 }];

    const { mp4 } = await montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'sin.mp4' });

    const r = spawnSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8' });
    assert.match(r.stderr, /640x400/);
});

test('con presentacion, el video sale en las dimensiones de salida y dura lo mismo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 6, 'blue') };
    const pasos = [
        { escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 3000 },
        { escena: 'b', actor: 'uno', tLocal: 3000, tGlobal: 3000, duracionMs: 2000 },
    ];
    const presentacion = {
        fondo: null, padding: 40, radio: 16, sombra: true, barra: true,
        salida: { ancho: 960, alto: 540 },
        transicion3d: { activa: false, ms: 900, gradosMax: 12 },
    };

    const { mp4, segmentos } = await montar({
        pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 },
        presentacion, marca: { color: '#1e3a8a' }, baseURL: 'http://localhost:8000',
    }, { salida: dir, nombre: 'con.mp4' });

    const r = spawnSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8' });
    assert.match(r.stderr, /960x540/);
    // la presentación NO puede mover el reloj: los tiempos de los segmentos son los mismos
    assert.deepEqual(segmentos.map((s) => s.inicioSeg), [0, 3]);
    assert.ok(Math.abs(duracion(mp4) - 5) < 0.5, `duración ${duracion(mp4)}`);
});
```

Agregar al principio del archivo los imports que falten:

```js
import { spawnSync } from 'node:child_process';
import { RUTA_FFMPEG } from '../src/ffmpeg.mjs';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pruebas/montaje.test.mjs`
Expected: FAIL en el segundo test — sale `640x400`, no `960x540`.

- [ ] **Step 3: Write minimal implementation**

En `src/montaje.mjs`, agregar los imports:

```js
import { componer } from './presentacion.mjs';
import { renderizarMarco } from './marco.mjs';
```

Cambiar la firma para aceptar los campos nuevos:

```js
export async function montar({ pistas, pasos, voz, video, presentacion = null, marca = null, baseURL = null }, { salida, nombre = 'demo.mp4' }) {
```

E insertar justo después del concat del paso 2 (`ff(['-y', '-f', 'concat', ... , mudo]);`):

```js
    // 2b. Presentación: el marco va ANTES de la voz y los subtítulos, a propósito. Componer
    //     reencodea el video, así que hacerlo acá deja intacto el `-c:v copy` del mux final
    //     y —lo que de verdad importa— no toca la duración, que es de donde salen los
    //     tiempos de las locuciones y de los cues.
    let baseVideo = mudo;
    if (presentacion) {
        const marcoPng = await renderizarMarco({ salida: temporal, presentacion, marca, baseURL });
        baseVideo = componer(mudo, marcoPng, join(temporal, 'presentado.mp4'), presentacion);
    }
```

Y reemplazar los usos posteriores de `mudo` por `baseVideo`: la línea de `const total = duracion(mudo);` y la de `entradas` (`'-i', mudo`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pruebas/montaje.test.mjs`
Expected: PASS todos, incluidos los que ya existían.

- [ ] **Step 5: Commit**

```bash
git add src/montaje.mjs pruebas/montaje.test.mjs
git commit -m "Aplicar la presentación en montar(), antes de la voz

Componer reencodea, así que va antes del mux de voz y subtítulos para no
romper el -c:v copy final. Sobre todo, no toca la duración: los tiempos de
las locuciones y de los cues ya están calculados contra ese reloj."
```

---

### Task 6: `escenario3d.mjs` — render determinista de una transición

**Files:**
- Create: `src/escenario3d.mjs`
- Create: `plantillas/escenario/escena.html`
- Test: `pruebas/escenario3d.test.mjs`

**Interfaces:**
- Consumes: `conPagina` de `src/render-web.mjs`; `ff` de `src/ffmpeg.mjs`.
- Produces: `renderizarTransicion({ mp4, desdeSeg, salida, presentacion, fps })` → `Promise<string>` con la ruta del MP4 de la transición. Dura `presentacion.transicion3d.ms`. La tarea 7 lo consume.

- [ ] **Step 1: Write the failing test**

Crear `pruebas/escenario3d.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { renderizarTransicion } from '../src/escenario3d.mjs';

const presentacion = {
    fondo: '#0f172a', padding: 40, radio: 16, sombra: true, barra: false,
    salida: { ancho: 480, alto: 270 },
    transicion3d: { activa: true, ms: 400, gradosMax: 12 },
};

function pixelCentro(mp4, seg) {
    const r = spawnSync(RUTA_FFMPEG, ['-ss', String(seg), '-i', mp4, '-frames:v', '1',
        '-vf', 'crop=1:1:240:135', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { maxBuffer: 1e6 });
    return [...r.stdout.subarray(0, 3)];
}

test('produce un clip con la duración de la transición', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-3d-'));
    const mp4 = join(dir, 'cap.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x400:rate=25', '-t', '3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);

    const clip = await renderizarTransicion({ mp4, desdeSeg: 0, salida: dir, presentacion, fps: 25 });
    assert.ok(existsSync(clip));
    // 400 ms a 25 fps son 10 frames
    assert.ok(Math.abs(duracion(clip) - 0.4) < 0.12, `duración ${duracion(clip)}`);
});

test('la cámara efectivamente se mueve: el primer frame difiere del último', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-3d-'));
    const mp4 = join(dir, 'cap.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=white:s=640x400', '-t', '3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);

    const clip = await renderizarTransicion({ mp4, desdeSeg: 0, salida: dir, presentacion, fps: 25 });
    const primero = pixelCentro(clip, 0);
    const ultimo = pixelCentro(clip, 0.35);
    assert.notDeepEqual(primero, ultimo, 'si no cambia, la cámara no se movió');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pruebas/escenario3d.test.mjs`
Expected: FAIL — `Cannot find module '../src/escenario3d.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Crear `plantillas/escenario/escena.html`:

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}</style></head>
<body>
<script type="module">
import * as THREE from '/three.module.js';

// La escena es deliberadamente pobre: MeshBasicMaterial, sin luces ni sombras reales. El
// Chromium headless renderiza por software (SwiftShader, sin GPU) y cada luz se paga en
// milisegundos por frame, multiplicados por todos los frames de la transición.
const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
const render = new THREE.WebGLRenderer({ antialias: true });
escena.background = new THREE.Color('#0f172a');

const video = document.createElement('video');
video.muted = true;
const textura = new THREE.VideoTexture(video);
const plano = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.0),
    new THREE.MeshBasicMaterial({ map: textura }),
);
escena.add(plano);

window.__preparar = async ({ ancho, alto, src, fondo }) => {
    render.setSize(ancho, alto, false);
    document.body.appendChild(render.domElement);
    camara.aspect = ancho / alto;
    camara.updateProjectionMatrix();
    escena.background = new THREE.Color(fondo);
    video.src = src;
    await new Promise((ok) => { video.onloadedmetadata = ok; });
};

/** Coloca el video en `t` segundos y la cámara en el avance `p` (0 → 1) de la transición. */
window.__frame = async ({ t, p, gradosMax }) => {
    video.currentTime = t;
    await new Promise((ok) => { video.onseeked = ok; });
    // easing suave: entra inclinada y termina frontal, que es lo que protege la legibilidad
    const suave = 1 - Math.pow(1 - p, 3);
    const grados = gradosMax * (1 - suave);
    plano.rotation.y = (grados * Math.PI) / 180;
    camara.position.set(0, 0, 2.6 - 0.25 * suave);
    camara.lookAt(0, 0, 0);
    textura.needsUpdate = true;
    render.render(escena, camara);
};
</script>
</body></html>
```

Crear `src/escenario3d.mjs`:

```js
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conPagina } from './render-web.mjs';
import { ff } from './ffmpeg.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLANTILLA = join(AQUI, '..', 'plantillas', 'escenario', 'escena.html');

/**
 * Renderiza la transición 3D de entrada a un capítulo, frame a frame.
 *
 * NO se graba el canvas en tiempo real, y esa es la decisión central: el screencast por CDP
 * emite a ritmo variable (ver src/pantalla.mjs), así que grabar una animación en vivo pierde
 * frames y desacopla la narración, que ya está montada contra el reloj del video. Fijando
 * `currentTime` y capturando de a un frame, la cantidad de frames es exacta por construcción.
 *
 * Medido en el equipo de referencia: ~94 ms por frame. Por eso solo pasan por acá las
 * transiciones y no el video completo.
 */
export async function renderizarTransicion({ mp4, desdeSeg, salida, presentacion, fps = 25 }) {
    const { ancho, alto } = presentacion.salida;
    const { ms, gradosMax } = presentacion.transicion3d;
    const total = Math.max(1, Math.round((ms / 1000) * fps));
    const dirFrames = mkdtempSync(join(tmpdir(), 'demo-3d-frames-'));

    await conPagina({ '/escena.html': PLANTILLA, '/cap.mp4': mp4 }, async (page, baseUrl) => {
        await page.setViewportSize({ width: ancho, height: alto });
        await page.goto(baseUrl + '/escena.html');
        await page.waitForFunction(() => typeof window.__preparar === 'function');
        await page.evaluate((args) => window.__preparar(args),
            { ancho, alto, src: '/cap.mp4', fondo: presentacion.fondo ?? '#0f172a' });

        for (let i = 0; i < total; i++) {
            await page.evaluate((args) => window.__frame(args), {
                t: desdeSeg + i / fps,
                p: total === 1 ? 1 : i / (total - 1),
                gradosMax,
            });
            await page.locator('canvas').screenshot({
                path: join(dirFrames, `f-${String(i).padStart(5, '0')}.jpg`),
                type: 'jpeg', quality: 92,
            });
        }
    });

    const clip = join(salida, `transicion-${Math.round(desdeSeg * 1000)}.mp4`);
    ff(['-y', '-framerate', String(fps), '-i', join(dirFrames, 'f-%05d.jpg'),
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(fps), clip]);
    rmSync(dirFrames, { recursive: true, force: true });
    return clip;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pruebas/escenario3d.test.mjs`
Expected: PASS los dos.

- [ ] **Step 5: Commit**

```bash
git add src/escenario3d.mjs plantillas/escenario/escena.html pruebas/escenario3d.test.mjs
git commit -m "Renderizar las transiciones 3D frame a frame, no en vivo

El screencast por CDP emite a ritmo variable, así que grabar la animación en
tiempo real perdería frames y desacoplaría la narración ya montada. Fijando
currentTime y capturando de a un frame, la cantidad es exacta. La escena usa
MeshBasicMaterial porque el render es por software, sin GPU."
```

---

### Task 7: Insertar las transiciones en `pegarCapitulos()` y ajustar los tiempos

**Files:**
- Modify: `src/curso.mjs:33-40` (normalización, duraciones y `capitulosConTiempos`)
- Test: `pruebas/curso.test.mjs`

**Interfaces:**
- Consumes: `renderizarTransicion` de `src/escenario3d.mjs`.
- Produces: `pegarCapitulos()` acepta `presentacion` en su segundo argumento. Sin él, o con `transicion3d.activa: false`, se comporta como hoy.

- [ ] **Step 1: Write the failing test**

Agregar a `pruebas/curso.test.mjs`:

```js
test('con transiciones, los marcadores de capítulo incluyen su transición', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-curso-'));
    const partes = [
        { id: 'uno', titulo: 'Primero', archivo: clip(dir, 'a.mp4', 2, 'blue') },
        { id: 'dos', titulo: 'Segundo', archivo: clip(dir, 'b.mp4', 2, 'red') },
    ];
    const presentacion = {
        fondo: '#0f172a', padding: 20, radio: 16, sombra: true, barra: false,
        salida: { ancho: 480, alto: 270 },
        transicion3d: { activa: true, ms: 400, gradosMax: 12 },
    };

    const { capitulos } = await pegarCapitulos(partes, {
        salida: dir, nombre: 'curso.mp4', titulo: 'Curso', video: { ancho: 480, alto: 270 },
        presentacion,
    });

    // el primer capítulo no lleva transición de entrada: arranca en 0
    assert.equal(capitulos[0].inicioSeg, 0);
    // el segundo empieza donde termina el primero, y su transición cuenta como suya:
    // el marcador cae al comienzo del movimiento, no después
    assert.ok(Math.abs(capitulos[1].inicioSeg - 2) < 0.3,
        `el capítulo 2 debe empezar en ~2 s (con su transición adentro), midió ${capitulos[1].inicioSeg}`);
    assert.ok(Math.abs((capitulos[1].finSeg - capitulos[1].inicioSeg) - 2.4) < 0.3,
        'el capítulo 2 dura su clip más su transición');
});

test('sin presentacion, los capítulos quedan como siempre', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-curso-'));
    const partes = [
        { id: 'uno', titulo: 'Primero', archivo: clip(dir, 'a.mp4', 2, 'blue') },
        { id: 'dos', titulo: 'Segundo', archivo: clip(dir, 'b.mp4', 2, 'red') },
    ];
    const { capitulos } = await pegarCapitulos(partes, {
        salida: dir, nombre: 'curso.mp4', titulo: 'Curso', video: { ancho: 480, alto: 270 },
    });
    assert.equal(capitulos[0].inicioSeg, 0);
    assert.ok(Math.abs(capitulos[1].inicioSeg - 2) < 0.3);
});
```

Si `pruebas/curso.test.mjs` no tiene un helper `clip`, agregarlo:

```js
/** Fabrica un clip de color sólido con audio, como sustituto de un capítulo montado. */
function clip(dir, nombre, segundos, color) {
    const archivo = join(dir, nombre);
    ff(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=480x270:d=${segundos}`,
        '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${segundos}`,
        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', archivo]);
    return archivo;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pruebas/curso.test.mjs`
Expected: FAIL en el primer test — el capítulo 2 dura 2 s, no 2,4.

- [ ] **Step 3: Write minimal implementation**

En `src/curso.mjs`, agregar el import:

```js
import { renderizarTransicion } from './escenario3d.mjs';
```

Cambiar la firma:

```js
export async function pegarCapitulos(partes, { salida, nombre = 'curso.mp4', titulo, video, presentacion = null }) {
```

Después de construir `normalizados` y antes de `const duraciones = ...`, insertar:

```js
    // Transición 3D de ENTRADA a cada capítulo, salvo el primero: el video no puede empezar
    // con un movimiento de cámara sobre nada.
    //
    // La transición se contabiliza como parte del capítulo que ENTRA, y eso no es un detalle
    // estético: `capitulosConTiempos` recibe una duración por parte, y los cues de subtítulos
    // se desplazan por `capitulos[i].inicioSeg`. Si la transición se contara aparte, cada
    // capítulo a partir del segundo quedaría corrido contra sus propios subtítulos. Con el
    // marcador al comienzo del movimiento, además, saltar a un capítulo muestra su entrada.
    const conTransiciones = [];
    const duraciones = [];
    for (const [i, archivo] of normalizados.entries()) {
        let duraCap = duracion(archivo);
        if (i > 0 && presentacion?.transicion3d?.activa) {
            const transicion = await renderizarTransicion({
                mp4: archivo, desdeSeg: 0, salida: temporal, presentacion, fps: 25,
            });
            const normalizada = join(temporal, `trans-${String(i).padStart(2, '0')}.mp4`);
            ff(['-y', '-i', transicion,
                '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
                '-shortest',
                '-vf', `scale=${video.ancho}:${video.alto}:force_original_aspect_ratio=decrease,` +
                       `pad=${video.ancho}:${video.alto}:(ow-iw)/2:(oh-ih)/2:color=#0f172a,setsar=1,fps=25`,
                '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-ar', '44100', '-ac', '2', normalizada]);
            conTransiciones.push(normalizada);
            duraCap += duracion(normalizada);
        }
        conTransiciones.push(archivo);
        duraciones.push(duraCap);
    }
```

Reemplazar la línea `const duraciones = normalizados.map((a) => duracion(a));` (ya la calcula el bucle) y usar `conTransiciones` donde antes iba `normalizados`, al escribir la lista de concat:

```js
    writeFileSync(lista, conTransiciones.map((a) => `file '${a}'`).join('\n'));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pruebas/curso.test.mjs`
Expected: PASS los dos nuevos y los que ya existían.

- [ ] **Step 5: Commit**

```bash
git add src/curso.mjs pruebas/curso.test.mjs
git commit -m "Insertar las transiciones 3D entre capítulos del curso

La transición cuenta como parte del capítulo que entra. No es estético: los
cues de subtítulos se desplazan por el inicio del capítulo, así que contarla
aparte correría cada capítulo contra sus propios subtítulos."
```

---

### Task 8: Cablear la config al pipeline y documentar

**Files:**
- Modify: `cli.mjs` (las llamadas a `montar` y `pegarCapitulos`)
- Modify: `plantillas/demo.config.mjs`
- Modify: `README.md`
- Test: `pruebas/cli.test.mjs`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `demo grabar` y `demo curso` aplican la presentación cuando el proyecto la declara.

- [ ] **Step 1: Write the failing test**

Agregar a `pruebas/cli.test.mjs`, usando los helpers que ya existen ahí (`iniciarJuguete`, `proyectoDeJuguete(juguete, extra)`, `escribirGuionPanel`, `correrCli`):

```js
test('demo grabar aplica la presentación declarada en la config', async () => {
    // Este test protege el CABLEADO, que es donde se pierden las opciones: montar() ya está
    // probado aparte, pero nada garantizaba que cli.mjs le pasara `presentacion`, `marca` y
    // `baseURL`. Se verifica por la resolución del MP4: si la presentación no llegó, el video
    // sale en 640x480 (la resolución de grabación) en vez de 960x540.
    const juguete = await iniciarJuguete();
    try {
        const proyecto = proyectoDeJuguete(juguete, `
            video: { ancho: 640, alto: 480, pausaMinima: 150, presentacion: {
                padding: 40, salida: { ancho: 960, alto: 540 },
                transicion3d: { activa: false, ms: 900, gradosMax: 12 },
            } },
        `);
        escribirGuionPanel(proyecto, 'panel', '/panel');

        const r = await correrCli(proyecto, ['grabar', 'panel']);
        assert.equal(r.status, 0, r.stderr);

        const mp4 = join(proyecto, 'salida', 'panel.mp4');
        assert.ok(existsSync(mp4), 'no se generó el mp4');
        const info = spawnSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8' });
        assert.match(info.stderr, /960x540/);
    } finally {
        await juguete.cerrar();
    }
});
```

Nota: `proyectoDeJuguete` escribe una línea `video: { ancho: 640, alto: 480, pausaMinima: 150 },` fija en la plantilla. Como este test necesita reemplazarla y no agregarle otra, hay que darle al helper la posibilidad de pisar ese bloque: cambiar esa línea de la plantilla por `${video ?? "video: { ancho: 640, alto: 480, pausaMinima: 150 },"}` y aceptar un tercer parámetro `video` en el helper. Los llamados existentes no pasan ese parámetro y siguen funcionando igual.

Agregar al principio del archivo los imports que falten:

```js
import { spawnSync } from 'node:child_process';
import { RUTA_FFMPEG } from '../src/ffmpeg.mjs';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test pruebas/cli.test.mjs`
Expected: FAIL si el helper no existe todavía o si el cableado no pasa la config.

- [ ] **Step 3: Write minimal implementation**

En `cli.mjs`, en la llamada a `montar`, agregar los tres campos:

```js
presentacion: cfg.video.presentacion,
marca: cfg.marca,
baseURL: cfg.baseURL,
```

Y en la llamada a `pegarCapitulos`, agregar `presentacion: cfg.video.presentacion`.

En `plantillas/demo.config.mjs`, debajo de la línea `video: { ancho: 1600, alto: 1000 },`:

```js
    // Presentación (opcional): fondo, ventana con sombra y transiciones 3D entre capítulos.
    // Quita el bloque y el video sale como la grabación cruda, a pantalla completa.
    // presentacion: {
    //     fondo: null,          // null = gradiente derivado de marca.color
    //     padding: 80, radio: 16, sombra: true, barra: true,
    //     salida: { ancho: 1920, alto: 1080 },
    //     // Las transiciones se renderizan frame a frame (~94 ms por frame): 900 ms entre
    //     // capítulos cuestan ~1 s de render cada una. `activa: false` las apaga y deja
    //     // solo el marco, que es lo indicado si necesitas una versión sin movimiento.
    //     transicion3d: { activa: true, ms: 900, gradosMax: 12 },
    // },
```

En `README.md`, agregar una sección "Presentación" después de la de configuración, explicando: el bloque es opt-in, qué hace cada campo, el costo de render de las transiciones, y que `transicion3d.activa: false` genera la versión sin movimiento para material que lo requiera.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test pruebas/`
Expected: PASS toda la suite.

- [ ] **Step 5: Commit**

```bash
git add cli.mjs plantillas/demo.config.mjs README.md pruebas/cli.test.mjs
git commit -m "Cablear la presentación al CLI y documentarla

El bloque va comentado en la plantilla: quien lo quiera lo descomenta, y un
proyecto que no lo toque sigue produciendo exactamente el mismo video."
```

---

## Verificación final

Después de la tarea 8, antes de dar la rama por terminada:

- [ ] `node --test pruebas/` en verde, suite completa.
- [ ] Generar un video real de un sistema con presentación activada y mirarlo: el texto tiene que leerse durante todo el contenido narrado, y la transición no debe durar más de lo que dice la config.
- [ ] Comparar contra un video generado SIN el bloque: debe ser idéntico al que producía el motor antes.
- [ ] Medir cuánto tardó el curso completo con transiciones y anotarlo en el README, para que nadie se sorprenda.
