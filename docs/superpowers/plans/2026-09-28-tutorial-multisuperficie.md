# Tutoriales multi-superficie — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que demo-engine grabe tutoriales que cruzan superficies (escritorio, teléfono, APK) con marco por dispositivo, pantalla dividida en los traspasos, tarjeta "usted está aquí", audio (música con atenuación, clic) y dos motores de voz nuevos, sin cambiar el video de quien no declare nada nuevo.

**Architecture:** La config declara `superficies` y cada actor dice en cuál vive y con qué dispositivo. El grabador abre cada contexto con su dispositivo y anota el origen de reloj de cada pista, los clics y los tramos `dividir`. El montaje, si hay superficies o `dividir`, compone cada trozo sobre un **lienzo** (PNG renderizado en Chromium con huecos transparentes) en vez del escalado plano de hoy. Todo lo visual se rotula en el navegador (no hay `drawtext`).

**Tech Stack:** Node 20 ESM, `node --test`, Playwright (Chromium + `devices`), ffmpeg-static 7, Python opcional para voces.

**Spec:** `docs/superpowers/specs/2026-09-28-tutorial-multisuperficie-design.md`

## Global Constraints

- Sin dependencias npm nuevas. Solo `ffmpeg-static`, `playwright`, `three`.
- Compatibilidad estricta: una config sin `superficies`, `audio` ni `dividir` produce el mismo video que v1.13.0 (mismas dimensiones, duración ±0,05 s, audio igual).
- Todo texto que se vea en el video se rotula en Chromium (PNG). `drawtext` no existe en ffmpeg-static.
- Comentarios y mensajes en español, en el estilo del repo: el comentario explica el PORQUÉ.
- Los errores de config van por `exigir(...)` con el prefijo `demo.config.mjs:`.
- Commits en español, sin `Co-Authored-By` ni `noreply@anthropic.com` (el hook `commit-msg` los rechaza). Siempre `git commit --only -- <rutas>`, porque el índice es compartido.
- `npm test` (`node --test --test-concurrency=1 pruebas/`) tiene que quedar en verde al cerrar cada tarea.
- Chip y tarjeta: texto con contraste ≥ 4.5:1 sobre su fondo; el color nunca es el único portador (ícono + texto).
- Voz: el `.wav` destino va siempre como ÚLTIMO argumento y el texto entra por stdin.

## Review Focus

1. Actor con `sesion:false` usado en un guion antes que nadie. Debe grabar sin `storageState` y sin pedir login.
2. `dividir` que nombra a un actor que todavía no navegó a ninguna página. Su panel no puede quedar negro por un error silencioso: se abre el contexto y se muestra `about:blank`, con un aviso por stderr.
3. Teléfono con un aspecto distinto al del hueco del marco. No se puede deformar: se verifica por píxel que un cuadrado siga cuadrado.
4. `audio.musica.archivo` inexistente. Debe fallar con un error de config claro, no con un ffmpeg críptico a mitad del montaje.
5. `demo formatos` sobre un curso con capítulos y subtítulos. El vertical tiene que conservar las dos cosas.

Cada uno de estos puntos tiene su test dentro de la tarea dueña (buscar «Review Focus #n»).

---

## Mapa de archivos

| Archivo | Tarea | Responsabilidad |
|---|---|---|
| `src/configurar.mjs` | T1 | superficies, flujo, actores con dispositivo, audio, `superficieDe()` |
| `src/sesiones.mjs` | T1 | saltar actores `sesion:false` |
| `src/voz/proceso.mjs`, `src/voz/pocket.mjs`, `src/voz/chatterbox.mjs`, `src/voz/index.mjs`, `herramientas/instalar-voces.sh` | T2 | motores nuevos + hook `despues` |
| `src/lienzo.mjs`, `src/escenario/lienzo.html` | T3 | PNG del lienzo (1 o 2 paneles, ventana o teléfono, chip) + huecos |
| `src/mapa-superficies.mjs`, `src/escenario/superficies.html` | T4 | clip de la tarjeta de superficies |
| `src/formatos.mjs` | T4 | variantes 9:16 y 1:1 |
| `src/mezcla.mjs` | T5 | cadena de audio: voz + música atenuada + clics, estéreo 48 kHz |
| `src/grabador.mjs`, `src/camara.mjs`, `src/linea-tiempo.mjs` | T6 | dispositivo por actor, orígenes, clics, `dividir` |
| `src/composicion.mjs`, `src/montaje.mjs` | T7 | componer trozos en el lienzo, tramos divididos, cableado de la mezcla |
| `src/curso.mjs`, `cli.mjs`, `plantillas/`, `docs/` | T8 | tarjetas en el curso, capítulo `mapa`, video con superficie, `demo formatos`, documentación, E2E |

**Olas.** Ola 1: T1, T2, T3, T4 y T5 en paralelo, con archivos disjuntos. Ola 2: T6, que depende de T1. Ola 3: T7, que depende de T3, T5 y T6. Ola 4: T8, que depende de todo.

---

### Task 1: Config de superficies, actores con dispositivo y audio

**Files:**
- Modify: `src/configurar.mjs` (DEFECTOS, `cargarConfig`, nueva `superficieDe`)
- Modify: `src/sesiones.mjs` (`prepararSesiones`, `prepararSesionesParaGuion`)
- Test: `pruebas/configurar.test.mjs`, `pruebas/sesiones.test.mjs`

**Interfaces:**
- Produces:
  - `config.superficies: Record<string,{nombre:string,tipo:'escritorio'|'telefono',icono:'monitor'|'phone',color:string}> | null` (null si no se declaró)
  - `config.flujo: Array<[string,string]>` (defecto `[]`)
  - `config.actores[x]: {email?,password?,sesion:boolean(defecto true),superficie?:string,dispositivo?:string,baseURL?:string,permisos?:string[],geolocalizacion?:{latitude,longitude}}`
  - `config.audio: {musica: null | {archivo:string(absoluta), volumen:number(0.12), atenuar:boolean(true)}, clic:{activo:boolean(false), volumen:number(0.5)}}`
  - `config.video.presentacion.mapaMs` (defecto 2500, solo si hay presentación)
  - `export function superficieDe(config, actor): null | {id, nombre, tipo, icono, color}`

- [ ] **Step 1: Tests que fallan** (agregar a `pruebas/configurar.test.mjs`; usar el helper existente del archivo que escribe un `demo.config.mjs` temporal. Si no existe, crear `escribirConfig(texto)` con `mkdtempSync` + `mkdirSync(join(dir,'demo/guiones'),{recursive:true})`).

```js
test('sin superficies ni audio, la config queda como en 1.13 (compatibilidad)', async () => {
    const c = await cargarConfig(escribirConfig(`export default { baseURL:'http://localhost:8000',
        marca:{nombre:'M'}, actores:{ a:{email:'a@x', password:'password'} } }`));
    assert.equal(c.superficies, null);
    assert.deepEqual(c.flujo, []);
    assert.deepEqual(c.audio, { musica: null, clic: { activo: false, volumen: 0.5 } });
    assert.equal(c.actores.a.sesion, true);
    assert.equal(superficieDe(c, 'a'), null);
});

test('actor sesion:false no exige email ni password', async () => {
    const c = await cargarConfig(escribirConfig(`export default { baseURL:'http://localhost:8000',
        marca:{nombre:'M'}, actores:{ vecina:{ sesion:false } } }`));
    assert.equal(c.actores.vecina.sesion, false);
});

test('superficie desconocida, dispositivo inexistente y baseURL inválida fallan con mensaje claro', async () => {
    const base = (actor) => `export default { baseURL:'http://localhost:8000', marca:{nombre:'M'},
        superficies:{ sala:{ nombre:'Sala', tipo:'escritorio' } }, actores:{ x:${actor} } }`;
    await assert.rejects(cargarConfig(escribirConfig(base(`{sesion:false, superficie:'nada'}`))), /superficie "nada"/);
    await assert.rejects(cargarConfig(escribirConfig(base(`{sesion:false, dispositivo:'Nokia 3310'}`))), /dispositivo "Nokia 3310"/);
    await assert.rejects(cargarConfig(escribirConfig(base(`{sesion:false, baseURL:'ftp://x'}`))), /baseURL del actor "x"/);
});

test('superficies reciben defectos de ícono y color, y superficieDe las resuelve por actor', async () => {
    const c = await cargarConfig(escribirConfig(`export default { baseURL:'http://localhost:8000', marca:{nombre:'M', color:'#123456'},
        superficies:{ apk:{ nombre:'App del patrullero · Android', tipo:'telefono' } },
        flujo:[['apk','apk']], actores:{ p:{ sesion:false, superficie:'apk', dispositivo:'Pixel 7' } } }`));
    assert.deepEqual(superficieDe(c, 'p'), { id:'apk', nombre:'App del patrullero · Android', tipo:'telefono', icono:'phone', color:'#123456' });
});

test('flujo con una superficie inexistente falla', async () => {
    await assert.rejects(cargarConfig(escribirConfig(`export default { baseURL:'http://localhost:8000', marca:{nombre:'M'},
        superficies:{ a:{nombre:'A', tipo:'escritorio'} }, flujo:[['a','b']], actores:{ x:{sesion:false} } }`)), /flujo.*"b"/);
});

test('Review Focus #4: audio.musica.archivo inexistente es error de config', async () => {
    await assert.rejects(cargarConfig(escribirConfig(`export default { baseURL:'http://localhost:8000', marca:{nombre:'M'},
        actores:{ x:{sesion:false} }, audio:{ musica:{ archivo:'./no-existe.mp3' } } }`)), /audio\.musica\.archivo/);
});

test('presentacion recibe mapaMs por defecto', async () => {
    const c = await cargarConfig(escribirConfig(`export default { baseURL:'http://localhost:8000', marca:{nombre:'M'},
        actores:{ x:{sesion:false} }, video:{ presentacion:{} } }`));
    assert.equal(c.video.presentacion.mapaMs, 2500);
});
```

En `pruebas/sesiones.test.mjs`:

```js
test('prepararSesionesParaGuion no intenta loguear a un actor sesion:false', async () => {
    const guion = { escenas: [{ pasos: [{ actor: 'vecina' }] }] };
    const config = { baseURL: 'http://127.0.0.1:1', actores: { vecina: { sesion: false } }, login: {} };
    const sesiones = await prepararSesionesParaGuion(guion, config, { dirSesiones: mkdtempSync(join(tmpdir(), 's-')) });
    assert.equal(sesiones.vecina, null);
});
```

- [ ] **Step 2: Correr y ver que fallan**

Run: `node --test pruebas/configurar.test.mjs pruebas/sesiones.test.mjs`
Expected: FAIL (`superficieDe` no exportada, `c.superficies` undefined, etc.)

- [ ] **Step 3: Implementación**

En `DEFECTOS` agregar `audio: { musica: null, clic: { activo: false, volumen: 0.5 } }` y, en `DEFECTOS_PRESENTACION`, `mapaMs: 2500`. En `cargarConfig`, reemplazar el bucle de actores:

```js
import { devices } from 'playwright';

const TIPOS_SUPERFICIE = ['escritorio', 'telefono'];
const ICONO_POR_TIPO = { escritorio: 'monitor', telefono: 'phone' };

// Un actor `sesion:false` es el vecino anónimo, o la app que se loguea DENTRO del guion
// (el APK pide su propio token). Exigirle email/password obligaba a inventar credenciales
// que nadie usa, y `preparar` intentaba loguearlo contra /login y fallaba.
const actores = {};
for (const [nombre, datos] of Object.entries(cruda.actores ?? {})) {
    const actor = { sesion: true, ...datos };
    if (actor.sesion) {
        exigir(actor.email, `el actor "${nombre}" no trae email`);
        exigir(actor.password, `el actor "${nombre}" no trae password`);
    }
    if (actor.dispositivo) exigir(devices[actor.dispositivo], `el actor "${nombre}" pide el dispositivo "${actor.dispositivo}", que Playwright no conoce`);
    if (actor.baseURL) exigir(/^https?:\/\//.test(actor.baseURL), `la baseURL del actor "${nombre}" debe ser http(s) (recibí "${actor.baseURL}")`);
    actores[nombre] = actor;
}
exigir(Object.keys(actores).length > 0, 'actores no puede estar vacío: sin actores no hay a quién grabar');

let superficies = null;
if (cruda.superficies) {
    superficies = {};
    for (const [id, s] of Object.entries(cruda.superficies)) {
        exigir(s?.nombre, `la superficie "${id}" no trae nombre (sale rotulado en el video)`);
        exigir(TIPOS_SUPERFICIE.includes(s.tipo), `la superficie "${id}" tiene tipo "${s.tipo}"; debe ser escritorio o telefono`);
        superficies[id] = { icono: ICONO_POR_TIPO[s.tipo], color: marca.color, ...s };
    }
}
for (const [nombre, a] of Object.entries(actores)) {
    if (a.superficie) exigir(superficies?.[a.superficie], `el actor "${nombre}" usa la superficie "${a.superficie}", que no está en superficies`);
}
const flujo = cruda.flujo ?? [];
for (const [desde, hasta] of flujo) {
    for (const s of [desde, hasta]) exigir(superficies?.[s], `flujo menciona la superficie "${s}", que no está en superficies`);
}

const audio = { ...DEFECTOS.audio, ...cruda.audio, clic: { ...DEFECTOS.audio.clic, ...cruda.audio?.clic } };
if (audio.musica) {
    audio.musica = { volumen: 0.12, atenuar: true, ...audio.musica, archivo: absoluta(audio.musica.archivo ?? '') };
    exigir(existsSync(audio.musica.archivo), `audio.musica.archivo no existe: ${audio.musica.archivo}`);
}
```

La variable `marca` ya existe más abajo: mover su cálculo arriba del bloque de superficies. En el `return`, agregar `superficies, flujo, audio` y reemplazar `actores`. Agregar además:

```js
/** La superficie en la que vive `actor`, con su id, o null si la config no declara superficies. */
export function superficieDe(config, actor) {
    const id = config.actores?.[actor]?.superficie;
    if (!id || !config.superficies?.[id]) return null;
    return { id, ...config.superficies[id] };
}
```

En `src/sesiones.mjs`: `prepararSesiones` salta a los actores con `datos.sesion === false` (`continue`, y en el mapa resultante `[actor]: null`). `prepararSesionesParaGuion` pone `null` para los actores `sesion:false` y los saca de `faltantes` antes de loguear.

- [ ] **Step 4: Correr y ver que pasan**

Run: `node --test pruebas/configurar.test.mjs pruebas/sesiones.test.mjs && npm test`
Expected: PASS, suite completa en verde.

- [ ] **Step 5: Commit**

```bash
git add src/configurar.mjs src/sesiones.mjs pruebas/configurar.test.mjs pruebas/sesiones.test.mjs
git commit --only -m "Config de superficies, actores con dispositivo y audio

Un tutorial de seguridad-graneros cruza siete superficies y actores sin cuenta
(vecino) o que se loguean dentro de la app (APK); la config tiene que poder
decir en qué superficie y en qué dispositivo vive cada actor." -- src/configurar.mjs src/sesiones.mjs pruebas/configurar.test.mjs pruebas/sesiones.test.mjs
```

---

### Task 2: Motores de voz Pocket TTS y Chatterbox

**Files:**
- Modify: `src/voz/proceso.mjs` (opción `despues`)
- Create: `src/voz/pocket.mjs`, `src/voz/chatterbox.mjs`
- Modify: `src/voz/index.mjs` (`MOTORES`)
- Modify: `herramientas/instalar-voces.sh` (flags `--pocket`, `--chatterbox`)
- Test: `pruebas/voz-nuevos.test.mjs`

**Interfaces:**
- Consumes: `crearMotorProceso` (proceso.mjs:35), `resolverVenvYVoces` (resolver.mjs:60), `ff` (ffmpeg.mjs).
- Produces: `crear({voz, venv, voces, velocidad, ejecutarProceso})` en los dos módulos. `crearMotorProceso({..., despues?: (destino) => void})`: si `despues` tira un error, esa síntesis cuenta como fallida.
- Venvs: pocket usa `<cache>/demo-engine/venv-pocket`, chatterbox usa `<cache>/demo-engine/venv-chatterbox`. Se resuelven con `resolverVenvYVoces({ venv: venv ?? rutaCache('venv-pocket'), voces })`, donde `RUTA_CACHE` ya se exporta.

- [ ] **Step 1: Tests que fallan**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crear as crearPocket } from '../src/voz/pocket.mjs';
import { crear as crearChatterbox } from '../src/voz/chatterbox.mjs';
import { crearVoz } from '../src/voz/index.mjs';
import { crearMotorProceso } from '../src/voz/proceso.mjs';
import { ff, duracion } from '../src/ffmpeg.mjs';

function venvFalso() {
    const dir = mkdtempSync(join(tmpdir(), 'venv-'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'python'), '');
    return dir;
}
// Ejecutor que escribe un .wav real de 2 s en el ÚLTIMO argumento y guarda la llamada.
function ejecutorQueEscribe(llamadas) {
    return (PY, args, opciones) => {
        llamadas.push({ PY, args, opciones });
        ff(['-y', '-f', 'lavfi', '-t', '2', '-i', 'anullsrc=r=24000:cl=mono', args.at(-1)]);
        return { status: 0, stderr: '' };
    };
}

test('pocket: texto por stdin, idioma y voz como argumentos, .wav al final', () => {
    const llamadas = [];
    const m = crearPocket({ venv: venvFalso(), voces: tmpdir(), voz: 'spanish_24l:alba', velocidad: 1, ejecutarProceso: ejecutorQueEscribe(llamadas) });
    assert.equal(m.disponible(), true);
    const wav = m.sintetizar('Hola vecina');
    assert.ok(existsSync(wav));
    const ultima = llamadas.at(-1);
    assert.equal(ultima.opciones.input, 'Hola vecina');
    assert.ok(ultima.args.includes('spanish_24l'));
    assert.ok(ultima.args.includes('alba'));
    assert.equal(ultima.args.at(-1).endsWith('.wav'), true);
});

test('pocket: la velocidad se aplica con atempo después de sintetizar', () => {
    const m = crearPocket({ venv: venvFalso(), voces: tmpdir(), voz: 'spanish:alba', velocidad: 1.25, ejecutarProceso: ejecutorQueEscribe([]) });
    const wav = m.sintetizar('Hola');
    assert.ok(Math.abs(duracion(wav) - 2 / 1.25) < 0.1);
});

test('chatterbox sin voz de referencia no está disponible y lo dice', () => {
    const m = crearChatterbox({ venv: venvFalso(), voces: tmpdir(), ejecutarProceso: ejecutorQueEscribe([]) });
    assert.equal(m.disponible(), false);
    assert.match(m.error(), /voz de referencia/);
    assert.equal(m.motivo(), 'no-instalado');
});

test('chatterbox con voz de referencia pasa language_id es y la ruta de la voz', () => {
    const ref = join(mkdtempSync(join(tmpdir(), 'ref-')), 'ref.wav');
    ff(['-y', '-f', 'lavfi', '-t', '1', '-i', 'anullsrc=r=24000:cl=mono', ref]);
    const llamadas = [];
    const m = crearChatterbox({ venv: venvFalso(), voces: tmpdir(), voz: ref, ejecutarProceso: ejecutorQueEscribe(llamadas) });
    assert.ok(m.sintetizar('Hola'));
    assert.ok(llamadas.at(-1).args.includes(ref));
});

test('despues que falla convierte la síntesis en fallida (y avisa)', () => {
    const m = crearMotorProceso({ motor: 'x', archivosListos: () => null,
        comando: (d) => ({ PY: 'py', args: [d] }), ejecutarProceso: ejecutorQueEscribe([]),
        despues: () => { throw new Error('atempo roto'); } });
    assert.equal(m.sintetizar('hola'), null);
});

test('crearVoz conoce los motores pocket y chatterbox', () => {
    const v = crearVoz({ motor: 'pocket', respaldo: 'ninguno', venv: venvFalso() });
    assert.equal(v.motor, 'pocket');
});
```

Si `crearVoz` con motor no disponible devuelve el stub o un respaldo, ajustar la última aserción a `assert.doesNotThrow(() => crearVoz({ motor: 'pocket', respaldo: 'ninguno' }))`. El objetivo es comprobar que el motor está registrado. Otra forma: `import { MOTORES }`, si se exporta.

- [ ] **Step 2: Correr y ver que fallan**

Run: `node --test pruebas/voz-nuevos.test.mjs`
Expected: FAIL (`Cannot find module ../src/voz/pocket.mjs`)

- [ ] **Step 3: Implementación**

`src/voz/proceso.mjs`, dentro de `ejecutar()`, después de comprobar `existsSync(destino)`:

```js
if (despues) {
    try { despues(destino); } catch (e) { return { ok: false, error: `${motor}: ${e.message}` }; }
}
```

(Hay que agregar `despues` a los parámetros desestructurados y documentarlo: "post-proceso del .wav ya escrito, p. ej. velocidad para motores que no la traen".)

`src/voz/pocket.mjs`:

```js
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { resolverVenvYVoces, RUTA_CACHE } from './resolver.mjs';
import { crearMotorProceso } from './proceso.mjs';
import { ff } from '../ffmpeg.mjs';

// Pocket TTS (Kyutai): código MIT, pesos CC-BY-4.0 → exige atribución en los créditos del
// video. Corre en CPU con 2 núcleos. `voz` es "<idioma>:<voz>": el idioma elige el modelo
// (spanish | spanish_24l, el de 24 capas suena mejor y tarda más) y la voz es un nombre
// predefinido o la ruta a un .wav (clonar exige consentimiento escrito: Ley 21.719).
const GUION = `
import sys, scipy.io.wavfile
from pocket_tts import TTSModel
m = TTSModel.load_model(language=sys.argv[1])
estado = m.get_state_for_audio_prompt(sys.argv[2])
audio = m.generate_audio(estado, sys.stdin.read())
scipy.io.wavfile.write(sys.argv[3], m.sample_rate, audio.numpy())
`;

export function crear({ voz = 'spanish:alba', venv, voces, velocidad = 1, ejecutarProceso } = {}) {
    const { venv: VENV } = resolverVenvYVoces({ venv: venv ?? join(RUTA_CACHE, 'venv-pocket'), voces });
    const PY = join(VENV, 'bin', 'python');
    const [idioma, nombreVoz] = voz.includes(':') ? voz.split(/:(.*)/s) : ['spanish', voz];
    return crearMotorProceso({
        motor: 'pocket',
        archivosListos: () => (existsSync(PY) ? null : `no se encontró el intérprete de Python de Pocket TTS en ${PY} (instalar-voces.sh --pocket)`),
        comando: (destino) => ({ PY, args: ['-c', GUION, idioma, nombreVoz, destino] }),
        // Pocket no trae control de velocidad: se aplica `atempo` sobre el .wav ya escrito.
        despues: velocidad === 1 ? undefined : (destino) => {
            const tmp = destino.replace(/\.wav$/, '.rapido.wav');
            ff(['-y', '-i', destino, '-filter:a', `atempo=${velocidad}`, tmp]);
            renameSync(tmp, destino);
        },
        ...(ejecutarProceso ? { ejecutarProceso } : {}),
    });
}
```

`RUTA_CACHE` es la raíz `…/demo-engine`. Verificar en `resolver.mjs:67-68` qué exporta exactamente y usar esa ruta. Si `RUTA_CACHE` apunta a `…/demo-engine/venv`, usar `join(dirname(RUTA_CACHE), 'venv-pocket')`.

`src/voz/chatterbox.mjs`: la misma forma, con este guion:

```py
import sys, torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
m = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
wav = m.generate(sys.stdin.read(), language_id="es", audio_prompt_path=sys.argv[1])
ta.save(sys.argv[2], wav, m.sr)
```

`archivosListos` devuelve `'chatterbox necesita una voz de referencia (voz: ruta a un .wav con consentimiento escrito de la persona)'` si `!voz`, o `no se encontró la voz de referencia en <ruta>` si el archivo no existe. Primero va el control de Python, igual que en pocket. La velocidad se aplica con el mismo `despues` de `atempo`. Comentario de cabecera: "MIT; el audio lleva la marca de agua Perth de Resemble (transparenta que es voz sintética)."

`src/voz/index.mjs`: `import * as pocket from './pocket.mjs'; import * as chatterbox from './chatterbox.mjs';` y `const MOTORES = { piper, kokoro, pocket, chatterbox };`.

`herramientas/instalar-voces.sh`: leer los flags. Con `--pocket`: `python3 -m venv "$RAIZ/venv-pocket" && "$RAIZ/venv-pocket/bin/pip" install --index-url https://download.pytorch.org/whl/cpu torch && "$RAIZ/venv-pocket/bin/pip" install pocket-tts scipy`. Con `--chatterbox`: el mismo patrón con `chatterbox-tts torchaudio`. Sin flags, el script se comporta como hoy. Hay que imprimir el aviso de atribución CC-BY-4.0 de Pocket y el de consentimiento para clonar.

- [ ] **Step 4: Correr y ver que pasan**

Run: `node --test pruebas/voz-nuevos.test.mjs && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit --only -m "Motores de voz Pocket TTS y Chatterbox para un español menos robótico

Kokoro y Piper solo traen acento de España; Pocket (CPU, 2 núcleos) y Chatterbox
(con voz de referencia consentida) permiten comparar a ciegas antes de elegir." -- src/voz/ herramientas/instalar-voces.sh pruebas/voz-nuevos.test.mjs
```

---

### Task 3: Lienzo con paneles (ventana o teléfono) y chip de superficie

**Files:**
- Create: `src/lienzo.mjs`, `src/escenario/lienzo.html`
- Test: `pruebas/lienzo.test.mjs`

**Interfaces:**
- Consumes: `conPagina` (render-web.mjs), `fondoDelMarco` (marco.mjs).
- Produces:
  - `export function geometriaLienzo({ lienzo:{ancho,alto}, paneles:Array<Panel>, padding=64 }): Array<{x,y,ancho,alto}>` es PURA y devuelve el hueco (la "pantalla") de cada panel en px enteros pares.
  - `Panel = { tipo:'ventana'|'telefono', aspecto:number /* ancho/alto del contenido */, chip?:{nombre,icono,color}|null, url?:string|null }`
  - `export async function renderizarLienzo({ lienzo, paneles, marca, salida, nombre='lienzo.png' }): Promise<{ png:string, huecos:Array<{x,y,ancho,alto}> }>` devuelve un PNG del tamaño del lienzo: fondo de marca, cada panel con su bisel o ventana, y el hueco TRANSPARENTE.

Reglas de geometría:
- **1 panel:** se centra en el lienzo. El hueco es el mayor rectángulo del `aspecto` dado que cabe en `lienzo - 2*padding`, descontando la barra de 38 px si es `ventana` y el bisel (18 px por lado, 56 arriba y abajo) si es `telefono`.
- **2 paneles:** el lienzo se parte en dos columnas iguales con separación `padding/2` y en cada columna se aplica la regla de 1 panel.
- El chip va sobre el panel, alineado a su borde izquierdo, 44 px de alto, a 12 px del borde superior del panel. Por eso el panel reserva 56 px arriba cuando lleva chip.

- [ ] **Step 1: Tests que fallan**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geometriaLienzo, renderizarLienzo } from '../src/lienzo.mjs';
import { ff } from '../src/ffmpeg.mjs';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const L = { ancho: 1920, alto: 1080 };
const pixel = (png, x, y) => {   // RGBA de un píxel, leído con ffmpeg (sin dependencias)
    const r = spawnSync(ffmpegPath, ['-v', 'error', '-i', png, '-vf', `crop=1:1:${x}:${y}:exact=1`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
    return [...r.stdout];
};

test('un teléfono conserva el aspecto del dispositivo y queda centrado', () => {
    const [h] = geometriaLienzo({ lienzo: L, paneles: [{ tipo: 'telefono', aspecto: 412 / 839 }] });
    assert.ok(Math.abs(h.ancho / h.alto - 412 / 839) < 0.01);
    assert.ok(Math.abs((h.x + h.ancho / 2) - L.ancho / 2) <= 1);
    assert.equal(h.ancho % 2, 0); assert.equal(h.alto % 2, 0);
});

test('dos paneles caen en columnas distintas sin solaparse', () => {
    const [a, b] = geometriaLienzo({ lienzo: L, paneles: [{ tipo: 'telefono', aspecto: 0.49 }, { tipo: 'ventana', aspecto: 1.6 }] });
    assert.ok(a.x + a.ancho <= L.ancho / 2);
    assert.ok(b.x >= L.ancho / 2);
});

test('el PNG deja el hueco transparente y pinta el fondo fuera', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lienzo-'));
    const { png, huecos: [h] } = await renderizarLienzo({ lienzo: L,
        paneles: [{ tipo: 'telefono', aspecto: 412 / 839, chip: { nombre: 'App del patrullero · Android', icono: 'phone', color: '#166534' } }],
        marca: { color: '#1e3a8a' }, salida: dir });
    assert.equal(pixel(png, h.x + h.ancho / 2, h.y + h.alto / 2)[3], 0);   // hueco transparente
    assert.equal(pixel(png, 5, 5)[3], 255);                                  // fondo opaco
});

test('chip: el texto contrasta al menos 4.5:1 con su fondo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lienzo-'));
    const r = await renderizarLienzo({ lienzo: L, paneles: [{ tipo: 'ventana', aspecto: 1.6, chip: { nombre: 'Sala de operaciones', icono: 'monitor', color: '#fde047' } }],
        marca: { color: '#1e3a8a' }, salida: dir, devolverContraste: true });
    assert.ok(r.contraste >= 4.5, `contraste ${r.contraste}`);
});
```

Para el test de contraste, `renderizarLienzo` acepta `devolverContraste`: en el navegador calcula la luminancia relativa WCAG del color del texto contra el fondo del chip y devuelve el ratio. La regla: el texto del chip es `#fff` o `#0f172a`, el que dé mayor contraste con `chip.color`. Un amarillo claro lleva texto oscuro.

- [ ] **Step 2: Correr y ver que fallan**

Run: `node --test pruebas/lienzo.test.mjs`
Expected: FAIL (módulo inexistente)

- [ ] **Step 3: Implementación**

`geometriaLienzo`, pura:

```js
export const ALTO_BARRA = 38;
const BISEL = { lado: 18, arriba: 56, abajo: 56 };
const ALTO_CHIP = 56;   // 44 del chip + 12 de aire
const par = (n) => Math.floor(n / 2) * 2;

function huecoEnCaja(caja, panel) {
    const extraAncho = panel.tipo === 'telefono' ? BISEL.lado * 2 : 0;
    const extraAlto = (panel.tipo === 'telefono' ? BISEL.arriba + BISEL.abajo : ALTO_BARRA) + (panel.chip ? ALTO_CHIP : 0);
    const maxAncho = caja.ancho - extraAncho;
    const maxAlto = caja.alto - extraAlto;
    let ancho = maxAncho, alto = ancho / panel.aspecto;
    if (alto > maxAlto) { alto = maxAlto; ancho = alto * panel.aspecto; }
    ancho = par(ancho); alto = par(alto);
    const altoTotal = alto + extraAlto;
    const x = par(caja.x + (caja.ancho - ancho) / 2);
    const arribaPanel = caja.y + (caja.alto - altoTotal) / 2 + (panel.chip ? ALTO_CHIP : 0);
    const y = par(arribaPanel + (panel.tipo === 'telefono' ? BISEL.arriba : ALTO_BARRA));
    return { x, y, ancho, alto };
}

export function geometriaLienzo({ lienzo, paneles, padding = 64 }) {
    const util = { x: padding, y: padding, ancho: lienzo.ancho - padding * 2, alto: lienzo.alto - padding * 2 };
    if (paneles.length === 1) return [huecoEnCaja(util, paneles[0])];
    const sep = padding / 2;
    const col = (util.ancho - sep) / 2;
    return paneles.map((p, i) => huecoEnCaja({ x: util.x + i * (col + sep), y: util.y, ancho: col, alto: util.alto }, p));
}
```

`renderizarLienzo`: copia el patrón de `renderizarMarco`. Usa `conPagina({'/lienzo.html': PLANTILLA})`, `setViewportSize(lienzo)` y un `page.evaluate` que dibuja los elementos de la tabla de abajo. Después `page.screenshot({ omitBackground: true })`.

| Elemento | Cómo se dibuja |
|---|---|
| Fondo | Cuatro rectángulos por panel alrededor del hueco. Es la técnica de `marco.mjs:78-108`: el fondo se pinta en todo el lienzo menos en los huecos. Con 2 paneles, hay que generalizarla con **una máscara SVG** (un `<svg>` a pantalla completa con `<rect fill=fondo mask>` y un `<rect fill=black>` por hueco, redondeado con `rx`). Es más simple que los rectángulos y deja antialias en las esquinas. |
| Teléfono | Un `div` negro `#0b0b0f` con `border-radius: 44px`, que cubre el hueco más el bisel. Encima va una "isla" de cámara de 90×24 px, centrada y 16 px por debajo del borde. El hueco del bisel queda transparente con la misma máscara. Sin marcas comerciales. |
| Ventana | La barra de 38 px con los 3 puntos y la URL `panel.url` (misma estética que `marco.html`). |
| Chip | Una píldora `border-radius: 22px` de color `chip.color` y 44 px de alto. Lleva un ícono SVG inline de 20 px (`monitor`: rectángulo + pie; `phone`: rectángulo alto redondeado) y el texto `chip.nombre` en 20 px, peso 600, color `#fff` o `#0f172a` según el mayor contraste. |

`src/escenario/lienzo.html`: `<!doctype html>` con `body{margin:0;background:transparent;font-family:system-ui, sans-serif}` y un `<div id="raiz">`. Todo lo arma el JS del `evaluate`.

- [ ] **Step 4: Correr y ver que pasan**

Run: `node --test pruebas/lienzo.test.mjs && npm test`
Expected: PASS

Verificación visual (obligatoria, como en la presentación 3D): renderizar el PNG de 1 teléfono y el de 2 paneles, abrirlos con Read y confirmar a ojo que no hay deformación, que las esquinas son limpias y que el chip se lee. Describirlo en el informe.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "Lienzo con ventana o teléfono y chip de superficie

Para que el espectador sepa siempre en qué superficie está: el teléfono se ve
como teléfono y cada panel lleva su rótulo, con contraste AA y no solo color." -- src/lienzo.mjs src/escenario/lienzo.html pruebas/lienzo.test.mjs
```

---

### Task 4: Tarjeta de superficies y variantes de formato

**Files:**
- Create: `src/mapa-superficies.mjs`, `src/escenario/superficies.html`, `src/formatos.mjs`
- Test: `pruebas/mapa-superficies.test.mjs`, `pruebas/formatos.test.mjs`

**Interfaces:**
- Consumes: `conPagina`, `ff`, `duracion`.
- Produces:
  - `export async function renderizarMapa({ superficies, flujo, activa=null, anterior=null, lienzo, marca, ms, salida, nombre }): Promise<string /* mp4 */>` devuelve un mp4 de `ms` milisegundos, 25 fps, h264 yuv420p, del tamaño del lienzo y **sin audio**.
  - `export function variante(mp4, { formato:'vertical'|'cuadrado', salida }): string` devuelve la ruta del mp4 nuevo (`<nombre>-vertical.mp4` / `-cuadrado.mp4`).

Tarjeta: un nodo por superficie, en el orden de `Object.keys(superficies)`, en una fila (o en dos si son más de 4). Cada nodo lleva:
- ícono de 48 px;
- el nombre;
- debajo, en texto pequeño, quién la usa (`s.quien`, opcional).

Las flechas SVG siguen `flujo`. Estados:
- `activa`: borde de 4 px del color de la superficie, escala 1.08 y la etiqueta "Usted está aquí" (el estado no depende solo del color).
- `anterior`: opacidad 0.55, con su flecha hacia `activa` resaltada.
- El resto: opacidad 0.35 si hay `activa`, 1 si no.

- [ ] **Step 1: Tests que fallan**

```js
test('el clip de la tarjeta dura ms, tiene el tamaño del lienzo y no trae audio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mapa-'));
    const mp4 = await renderizarMapa({
        superficies: { vecino: { nombre: 'App del vecino', tipo: 'telefono', icono: 'phone', color: '#9a3412' },
                       sala: { nombre: 'Sala de operaciones', tipo: 'escritorio', icono: 'monitor', color: '#1e3a8a' } },
        flujo: [['vecino', 'sala']], activa: 'sala', anterior: 'vecino',
        lienzo: { ancho: 1920, alto: 1080 }, marca: { color: '#1e3a8a' }, ms: 2500, salida: dir, nombre: 'mapa.mp4' });
    assert.ok(Math.abs(duracion(mp4) - 2.5) < 0.1);
    const info = spawnSync(ffmpegPath, ['-i', mp4]).stderr.toString();
    assert.match(info, /1920x1080/);
    assert.doesNotMatch(info, /Audio:/);
});

test('la tarjeta rotula "Usted está aquí" solo en la activa', async () => {
    // renderizarMapa acepta devolverTexto:true (como renderizarMarco) y devuelve el innerText.
    const texto = await renderizarMapa({ /* mismos datos */ devolverTexto: true });
    assert.equal(texto.match(/Usted está aquí/g).length, 1);
});
```

`pruebas/formatos.test.mjs`:

```js
test('Review Focus #5: el vertical conserva audio, subtítulos y capítulos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fmt-'));
    const base = join(dir, 'curso.mp4');
    const srt = join(dir, 's.srt');
    const meta = join(dir, 'm.txt');
    writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nHola\n');
    writeFileSync(meta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Uno\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Dos\n');
    ff(['-y', '-f', 'lavfi', '-i', 'testsrc=s=1920x1080:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-i', srt, '-i', meta,
        '-map', '0:v', '-map', '1:a', '-map', '2:s', '-map_metadata', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text', base]);
    const vertical = variante(base, { formato: 'vertical', salida: dir });
    const info = spawnSync(ffmpegPath, ['-i', vertical]).stderr.toString();
    assert.match(info, /1080x1920/);
    assert.match(info, /Audio:/);
    assert.match(info, /Subtitle: mov_text/);
    assert.match(info, /Chapter #0:1/);
});

test('cuadrado: 1080x1080 y el fondo NO es negro liso (es el video desenfocado)', () => {
    // mismo base; leer el píxel (5,5) del primer frame con crop=1:1:5:5:exact=1 y comprobar que no es [0,0,0]
});
```

- [ ] **Step 2: Correr y ver que fallan** — `node --test pruebas/mapa-superficies.test.mjs pruebas/formatos.test.mjs` → FAIL.

- [ ] **Step 3: Implementación**

`formatos.mjs`:

```js
import { basename, join } from 'node:path';
import { ff } from './ffmpeg.mjs';

const DIMENSIONES = { vertical: { ancho: 1080, alto: 1920 }, cuadrado: { ancho: 1080, alto: 1080 } };

/**
 * Variante para redes: el mismo video centrado sobre una copia suya agrandada y desenfocada.
 * Recortar a 9:16 dejaba ~560 px de un panel de 1600: ilegible. Con fondo desenfocado se ve
 * todo el contenido y el formato no tiene franjas negras. Audio, subtítulos y capítulos se
 * copian sin tocar (`-map 0`, `-c:a copy`, `-c:s copy`).
 */
export function variante(mp4, { formato, salida }) {
    const d = DIMENSIONES[formato];
    if (!d) throw new Error(`formato "${formato}" desconocido: vertical o cuadrado`);
    const destino = join(salida, basename(mp4).replace(/\.mp4$/, `-${formato}.mp4`));
    const filtro = `[0:v]split[a][b];` +
        `[a]scale=${d.ancho}:${d.alto}:force_original_aspect_ratio=increase,crop=${d.ancho}:${d.alto},boxblur=30:3,eq=brightness=-0.15[fondo];` +
        `[b]scale=${d.ancho}:${d.alto}:force_original_aspect_ratio=decrease[frente];` +
        `[fondo][frente]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`;
    ff(['-y', '-i', mp4, '-filter_complex', filtro, '-map', '[v]', '-map', '0:a?', '-map', '0:s?',
        '-map_chapters', '0', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'copy', '-c:s', 'copy',
        '-movflags', '+faststart', destino]);
    return destino;
}
```

`mapa-superficies.mjs`: `conPagina` con `superficies.html`. Se renderiza un PNG del estado final y el clip se arma con `ff(['-y','-loop','1','-i',png,'-t',String(ms/1000),'-r','25','-vf',`scale=${ancho}:${alto},format=yuv420p`,'-c:v','libx264','-preset','veryfast',mp4])`. La entrada animada queda **fuera de alcance**: con una tarjeta estática de 2,5 s alcanza, y el curso ya pone su transición 3D alrededor. Con `devolverTexto:true` se devuelve `document.body.innerText`.

- [ ] **Step 4: Correr y ver que pasan** — ambos archivos más `npm test`. Verificación visual: abrir con Read el PNG de la tarjeta con `activa`/`anterior` y describir lo que se ve.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "Tarjeta de superficies y variantes vertical y cuadrada

La tarjeta es el «usted está aquí» entre capítulos; las variantes permiten
publicar el mismo tutorial en redes municipales sin volver a grabar." -- src/mapa-superficies.mjs src/escenario/superficies.html src/formatos.mjs pruebas/mapa-superficies.test.mjs pruebas/formatos.test.mjs
```

---

### Task 5: Mezcla de audio (voz, música atenuada, clics)

**Files:**
- Create: `src/mezcla.mjs`
- Test: `pruebas/mezcla.test.mjs`

**Interfaces:**
- Produces: `export function cadenaDeMezcla({ total, locuciones:Array<{wav,inicioSeg}>, musica:null|{archivo,volumen,atenuar}, clics:Array<number /* seg */>, clic:{activo,volumen} }): { entradas:string[], filtro:string, salida:'[a]' }`
  - `entradas` son los argumentos `-i` / `-f lavfi -i` en orden. La entrada 0 es SIEMPRE el video, así que la primera entrada de audio queda con índice 1: el que llama pone `-i video` primero y después `...entradas`.
  - La salida es estéreo 48 kHz y va normalizada con `loudnorm=I=-16:TP=-1.5:LRA=11` solo si hay voz o música, como hoy. Sin nada, sale silencio estéreo 48 kHz de `total` segundos.

- [ ] **Step 1: Tests que fallan**

```js
import { cadenaDeMezcla } from '../src/mezcla.mjs';

const correr = (total, opciones) => {           // aplica la cadena de verdad sobre un video mudo
    const dir = mkdtempSync(join(tmpdir(), 'mez-'));
    const video = join(dir, 'v.mp4');
    ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=320x240:d=${total}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const { entradas, filtro } = cadenaDeMezcla({ total, ...opciones });
    const out = join(dir, 'o.mp4');
    ff(['-y', '-i', video, ...entradas, '-filter_complex', filtro, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', out]);
    return out;
};
const wavDe = (seg) => { const w = join(mkdtempSync(join(tmpdir(), 'w-')), 'v.wav'); ff(['-y', '-f', 'lavfi', '-i', `sine=f=440:d=${seg}`, w]); return w; };

test('sin voz, música ni clics: silencio estéreo 48 kHz del largo exacto', () => {
    const out = correr(3, { locuciones: [], musica: null, clics: [], clic: { activo: false } });
    const info = spawnSync(ffmpegPath, ['-i', out]).stderr.toString();
    assert.match(info, /48000 Hz, stereo/);
    assert.ok(Math.abs(duracion(out) - 3) < 0.1);
});

test('voz retrasada a su marca y música en bucle más corta que el video', () => {
    const out = correr(6, { locuciones: [{ wav: wavDe(1), inicioSeg: 2 }], musica: { archivo: wavDe(1.5), volumen: 0.12, atenuar: true }, clics: [], clic: { activo: false } });
    assert.ok(Math.abs(duracion(out) - 6) < 0.15);
});

test('clics activos agregan una entrada lavfi por clic y ninguna si están apagados', () => {
    const con = cadenaDeMezcla({ total: 5, locuciones: [], musica: null, clics: [1, 2.5], clic: { activo: true, volumen: 0.5 } });
    const sin = cadenaDeMezcla({ total: 5, locuciones: [], musica: null, clics: [1, 2.5], clic: { activo: false, volumen: 0.5 } });
    assert.equal(con.entradas.filter((e) => String(e).startsWith('aevalsrc')).length, 2);
    assert.equal(sin.entradas.filter((e) => String(e).startsWith('aevalsrc')).length, 0);
});

test('con atenuar, la cadena usa la voz como llave de sidechaincompress', () => {
    const { filtro } = cadenaDeMezcla({ total: 5, locuciones: [{ wav: '/x.wav', inicioSeg: 0 }], musica: { archivo: '/m.mp3', volumen: 0.12, atenuar: true }, clics: [], clic: { activo: false } });
    assert.match(filtro, /sidechaincompress/);
});
```

- [ ] **Step 2: Correr y ver que fallan** — `node --test pruebas/mezcla.test.mjs` → FAIL.

- [ ] **Step 3: Implementación**

```js
/**
 * Arma la mezcla de audio del video: silencio base + locuciones en su marca + (opcional)
 * música en bucle atenuada bajo la voz + (opcional) un clic corto por pulsación.
 *
 * Estéreo 48 kHz: el curso ya re-encodeaba a estéreo, y una música mono suena pobre.
 * El clic se sintetiza con `aevalsrc` (ruido con decaimiento exponencial de 40 ms), sin
 * archivo: el motor no puede traer audio de terceros por licencia.
 */
export function cadenaDeMezcla({ total, locuciones, musica, clics, clic }) {
    const entradas = ['-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=stereo'];
    let idx = 1;                                   // 0 es el video del que llama
    const base = `[${idx++}:a]`;
    const filtros = [];
    const voces = [];
    for (const { wav, inicioSeg } of locuciones) {
        entradas.push('-i', wav);
        const ms = Math.round(inicioSeg * 1000);
        filtros.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${idx}]`);
        voces.push(`[v${idx}]`);
        idx++;
    }
    const efectos = [];
    if (clic?.activo) {
        for (const t of clics) {
            entradas.push('-f', 'lavfi', '-t', '0.06', '-i', `aevalsrc=(random(0)*2-1)*exp(-t*90):s=48000:c=stereo`);
            const ms = Math.round(t * 1000);
            filtros.push(`[${idx}:a]volume=${clic.volumen},adelay=${ms}|${ms}[c${idx}]`);
            efectos.push(`[c${idx}]`);
            idx++;
        }
    }
    let vozMezclada = null;
    if (voces.length) {
        filtros.push(`${voces.join('')}amix=inputs=${voces.length}:normalize=0,asplit=2[voz][llave]`);
        vozMezclada = '[voz]';
    }
    let musicaFinal = null;
    if (musica) {
        entradas.push('-stream_loop', '-1', '-i', musica.archivo);
        filtros.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total},volume=${musica.volumen}[mus]`);
        idx++;
        if (musica.atenuar && vozMezclada) {
            filtros.push(`[mus][llave]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[musAt]`);
            musicaFinal = '[musAt]';
        } else {
            musicaFinal = '[mus]';
            if (vozMezclada) filtros.push('[llave]anullsink');
        }
    } else if (vozMezclada) {
        filtros.push('[llave]anullsink');
    }
    const partes = [base, ...(vozMezclada ? [vozMezclada] : []), ...(musicaFinal ? [musicaFinal] : []), ...efectos];
    const normalizar = vozMezclada || musicaFinal ? ',loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000' : '';
    filtros.push(`${partes.join('')}amix=inputs=${partes.length}:normalize=0:duration=first${normalizar}[a]`);
    return { entradas, filtro: filtros.join(';'), salida: '[a]' };
}
```

(`-stream_loop` va ANTES de su `-i`: está bien porque es una opción de entrada. `duration=first` corta todo al largo del silencio base, que es `total`.)

- [ ] **Step 4: Correr y ver que pasan** — `node --test pruebas/mezcla.test.mjs && npm test`.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "Mezcla de audio con música atenuada bajo la voz y clic sonoro

Un tutorial sin ambiente se siente vacío y sin clic cuesta ver cuándo se pulsa;
la música la pone cada proyecto (el motor no trae audio de terceros)." -- src/mezcla.mjs pruebas/mezcla.test.mjs
```

---

### Task 6: Grabador con dispositivo por actor, orígenes, clics y `dividir`

**Files:**
- Modify: `src/grabador.mjs` (`actorDe`, bucle de pasos, retorno)
- Modify: `src/camara.mjs` (`pulsar` avisa del clic)
- Modify: `src/linea-tiempo.mjs` (propaga `dividir`)
- Test: `pruebas/grabador.test.mjs`, `pruebas/camara.test.mjs`, `pruebas/linea-tiempo.test.mjs`

**Interfaces:**
- Consumes: `config.actores[x].{sesion,dispositivo,baseURL,permisos,geolocalizacion}` (T1).
- Produces: `grabar()` devuelve `{ pistas, pasos, origenes: Record<actor, ms>, clics: number[] /* ms globales */, dimensiones: Record<actor,{ancho,alto}> }`.
  - Cada paso lleva `dividir: string[] | null`. Queda vigente desde el paso que lo declara hasta uno con `dividir: null`, y solo dentro de la misma escena.
  - `construirLineaDeTiempo` propaga `dividir` y `tGlobal` a cada segmento.
- `camara.mjs`: `export function alClicar(page, fn)` registra un callback en un WeakMap. `pulsar` lo llama con `Date.now()` justo antes del `.click()`.

Reglas:
- **Viewport:** con `dispositivo`, se usa `{...devices[d]}` (viewport, userAgent, isMobile, hasTouch, deviceScaleFactor). La pista se graba a `viewport × min(dsf, 2)`, redondeado a par, así que para Pixel 7 queda en 824×1678. `dimensiones[actor]` guarda ese tamaño de pista.
- **Sesión:** `sesion:false` abre el contexto sin `storageState`. Hoy `actorDe` tira un error si falta `sesiones[nombre]`: ahora solo lo hace si el actor tiene sesión.
- **baseURL:** vale `actor.baseURL ?? config.baseURL`. `exigirEntornoDeDesarrollo` se aplica también a cada baseURL de actor.
- **Permisos:** `permisos` y `geolocalizacion` pasan a `newContext({ permissions, geolocation })`.
- **Orígenes:** `origenes[actor] = datos.t0 - t0Global`.
- **`dividir`:** antes de ejecutar un paso con `dividir`, `await actorDe(x)` para cada actor nombrado. Si al actor no se le navegó nunca, su pista muestra `about:blank`, y se avisa por stderr: `[demo-engine] dividir: el actor "x" no tiene nada abierto todavía; su panel saldrá en blanco` (Review Focus #2).
- **Validación de `dividir`:** debe ser un array de exactamente 2 actores distintos que incluya al actor del paso. Si no, error con escena y paso, igual que los errores existentes.

- [ ] **Step 1: Tests que fallan** (en `pruebas/grabador.test.mjs`, reutilizando `iniciarJuguete`, `vozDe` y el patrón del archivo):

```js
test('actor con dispositivo graba a su tamaño y actor sin sesión no pide storageState', async () => {
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    try {
        const config = { baseURL: url, video: { ancho: 800, alto: 500, pausaMinima: 100, calidad: 80, fps: 25, msCursor: 50 },
            auditoria: { patron: 'x^', chequeoEnVivo: false }, actores: { vecina: { sesion: false, dispositivo: 'Pixel 7' } } };
        const guion = { id: 'm', escenas: [{ id: 'e', titulo: 'E', pasos: [
            { actor: 'vecina', hacer: async (page) => { await page.goto(`${url}/panel`); } }] }] };
        const r = await grabar(guion, { config, sesiones: {}, salida: dir, voz: { disponible: () => false } });
        assert.deepEqual(r.dimensiones.vecina, { ancho: 824, alto: 1678 });
        assert.equal(r.origenes.vecina >= 0, true);
        const info = spawnSync(ffmpegPath, ['-i', r.pistas.vecina]).stderr.toString();
        assert.match(info, /824x1678/);
    } finally { await cerrar(); rmSync(dir, { recursive: true, force: true }); }
});

test('dividir abre el contexto del otro actor antes del paso y viaja en el paso', async () => {
    // dos actores sesion:false (a escritorio, b Pixel 7); paso 1 b navega; paso 2 a con dividir:['b','a']
    // aserciones: r.pasos[1].dividir deepEqual ['b','a']; r.pistas.b existe; r.origenes.b <= r.pasos[1].tGlobal
});

test('Review Focus #2: dividir con un actor que no navegó avisa por stderr', async () => {
    // capturar console.warn; paso único de a con dividir:['a','b'] donde b nunca se usó → warn con /dividir: el actor "b"/
});

test('dividir inválido (un solo actor, o sin el actor del paso) falla con escena y paso', async () => {
    // dividir:['a'] → rejects /dividir/ y /escena "e"/
});

test('los clics hechos con pulsar() quedan en clics con tiempo global', async () => {
    // paso que hace page.goto(panel) y pulsar(page, 'a') sobre un link del juguete; r.clics.length === 1 y r.clics[0] > 0
});
```

`pruebas/linea-tiempo.test.mjs`:

```js
test('los segmentos llevan dividir y tGlobal', () => {
    const l = construirLineaDeTiempo([{ escena: 'e', actor: 'a', tLocal: 0, tGlobal: 0, duracionMs: 1000, dividir: ['a', 'b'] }]);
    assert.deepEqual(l[0].dividir, ['a', 'b']);
    assert.equal(l[0].tGlobal, 0);
});
```

Los tests marcados con comentarios (`// …`) tienen que quedar escritos en código completo, con el mismo andamiaje del primer test. Las aserciones exactas están en el comentario de cada uno.

- [ ] **Step 2: Correr y ver que fallan** — `node --test pruebas/grabador.test.mjs pruebas/linea-tiempo.test.mjs pruebas/camara.test.mjs` → FAIL.

- [ ] **Step 3: Implementación**

`actorDe`:

```js
import { chromium, devices } from 'playwright';

async function actorDe(nombre) {
    if (contextos.has(nombre)) return contextos.get(nombre);
    const datosActor = config.actores?.[nombre] ?? {};
    const conSesion = datosActor.sesion !== false;
    if (conSesion && !sesiones[nombre]) throw new Error(`el guion usa el actor "${nombre}", que no está en la config`);
    const baseURL = datosActor.baseURL ?? config.baseURL;
    exigirEntornoDeDesarrollo(baseURL);
    const disp = datosActor.dispositivo ? { ...devices[datosActor.dispositivo] } : null;
    delete disp?.defaultBrowserType;
    const ctx = await navegador.newContext({
        baseURL,
        ...(conSesion ? { storageState: sesiones[nombre] } : {}),
        ...(disp ?? { viewport: { width: ancho, height: alto } }),
        ...(datosActor.permisos ? { permissions: datosActor.permisos } : {}),
        ...(datosActor.geolocalizacion ? { geolocation: datosActor.geolocalizacion } : {}),
        locale: 'es-CL',
    });
    const page = await ctx.newPage();
    await instalarCursor(page);
    alClicar(page, (t) => clics.push(t - t0Global));
    // Un teléfono se graba a su tamaño lógico × densidad (tope 2): a 412 px de ancho, el
    // texto de la app se deshace al escalarlo dentro del marco del teléfono en 1080p.
    const escala = disp ? Math.min(disp.deviceScaleFactor ?? 1, 2) : 1;
    const par = (n) => Math.round(n / 2) * 2;
    const dim = disp ? { ancho: par(disp.viewport.width * escala), alto: par(disp.viewport.height * escala) } : { ancho, alto };
    const archivoPista = join(salida, `pista-${nombre}.mp4`);
    const grabacion = await iniciarGrabacion(page, { ...dim, salida: archivoPista, calidad, fps });
    const datos = { ctx, page, t0: Date.now(), grabacion, dim };
    contextos.set(nombre, datos);
    return datos;
}
```

Hay que declarar `const clics = [];` junto a `pasos` y exportar `alClicar` desde camara.mjs. En el bucle, el `dividir` vigente se resuelve por escena (`let dividirVigente = null` al empezar cada escena; `if ('dividir' in paso) dividirVigente = paso.dividir`). Se valida y se abren los contextos antes de `paso.hacer`. Antes de validar hay que avisar, si algún actor nombrado se abre recién ahí y no tiene URL (`page.url() === 'about:blank'`). El paso guardado lleva `dividir: dividirVigente`. Al final se devuelve `{ pistas, pasos, origenes, clics, dimensiones }`, con `origenes` y `dimensiones` armados desde `contextos`.

**Ojo con `iniciarGrabacion`:** tiene que recibir `maxWidth`/`maxHeight` del tamaño de la pista. Ya los toma de `ancho`/`alto` (`pantalla.mjs:76`), así que no hay que tocar ese archivo.

`camara.mjs`:

```js
const AVISOS_CLIC = new WeakMap();
/** El grabador se entera de cada pulsación (para el clic sonoro) sin que los guiones cambien. */
export function alClicar(page, fn) { AVISOS_CLIC.set(page, fn); }
// en pulsar(), justo antes de `.click()`:
AVISOS_CLIC.get(page)?.(Date.now());
```

`linea-tiempo.mjs`: agregar `dividir: p.dividir ?? null` al objeto del `.map`.

- [ ] **Step 4: Correr y ver que pasan** — los tres archivos y `npm test`.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "Grabador con dispositivo por actor, pantalla dividida y registro de clics

El APK y la app del vecino se ven como teléfono solo si se graban como
teléfono; los traspasos necesitan las dos pistas abiertas en el mismo tramo." -- src/grabador.mjs src/camara.mjs src/linea-tiempo.mjs pruebas/grabador.test.mjs pruebas/camara.test.mjs pruebas/linea-tiempo.test.mjs
```

---

### Task 7: Montaje por superficie, tramos divididos y nueva mezcla

**Files:**
- Create: `src/composicion.mjs`
- Modify: `src/montaje.mjs`
- Test: `pruebas/composicion.test.mjs`, `pruebas/montaje.test.mjs`

**Interfaces:**
- Consumes: `renderizarLienzo`/`geometriaLienzo` (T3), `cadenaDeMezcla` (T5), `superficieDe` (T1), y `grabar()` → `{origenes, clics, dimensiones}` más `seg.dividir` (T6).
- Produces:
  - `montar({ pistas, pasos, voz, video, presentacion, marca, baseURL, superficies=null, actores={}, origenes={}, clics=[], dimensiones={}, audio=null }, { salida, nombre })`. Los parámetros nuevos son opcionales y, sin ellos, el comportamiento es idéntico.
  - `export function componerEnLienzo(entradas:Array<{mp4,desdeSeg,hastaSeg}>, { png, huecos, lienzo, salida }): string` (composicion.mjs) devuelve un mp4 mudo del lienzo con cada entrada escalada a su hueco (`force_original_aspect_ratio=decrease` + `pad` negro) y el PNG encima.
  - `export function lienzoDe({ superficies, presentacion, video })`: si hay presentación devuelve `presentacion.salida`; si no, `{ancho: video.ancho, alto: video.alto}`.

Reglas:
- **Modo:** si `superficies` es null Y ningún segmento trae `dividir`, se usa el camino ACTUAL sin tocar nada. Es la compatibilidad, y hay un test que la cubre.
- **Por segmento, en el modo nuevo:**
  - Se arman los paneles:
    - Con `dividir`, son los 2 actores, en ese orden.
    - Sin `dividir`, es el actor del segmento.
  - Cada panel queda así:
    - `tipo` es `'telefono'` si la superficie es de tipo `telefono` o si el actor tiene `dispositivo`; si no, `'ventana'`.
    - `aspecto` sale de `dimensiones[actor]`, con `video.ancho/alto` como respaldo.
    - `chip` es la superficie del actor, o null.
    - `url` es `presentacion?.url ?? actor.baseURL ?? baseURL`.
  - El PNG se renderiza **una vez por combinación distinta** de paneles, cacheado por `JSON.stringify(paneles)`.
- **Tramo de cada actor:**
  - El actor del segmento usa `desdeSeg`/`hastaSeg`.
  - El otro actor de un `dividir` usa `desde = (seg.tGlobal - origenes[otro]) / 1000` y la misma duración, recortado a su pista con la misma `TOLERANCIA_SEG`. Si `desde < 0`, error: "el actor x empezó a grabar después del tramo dividido".
- **Presentación en el modo nuevo:** se ignora `componer()` sobre el mudo, porque el lienzo ya pone el fondo y el marco. La transición 3D del curso sigue funcionando porque el lienzo tiene el mismo tamaño.
- **Audio:** reemplazar el bloque 5 de `montar()` por `cadenaDeMezcla({ total, locuciones, musica: audio?.musica ?? null, clics: clicsEnVideo, clic: audio?.clic ?? { activo:false } })`. Los clics (ms globales) se traducen al reloj del video final: para cada clic se busca el segmento cuyo `[tGlobal, tGlobal+dura)` lo contiene y se calcula `inicioSeg + (clic - tGlobal)/1000`. Los clics que caen fuera de todo segmento se descartan.
  - **Compatibilidad de audio:** si no se pasa `audio`, se conserva la cadena mono vieja tal cual. Se decide así: `audio ? nueva : vieja`.

- [ ] **Step 1: Tests que fallan**

`pruebas/composicion.test.mjs`:

```js
test('componerEnLienzo pone cada entrada en su hueco sin deformar (Review Focus #3)', async () => {
    // 1. Fuente: un mp4 de 412x839 con un CUADRADO blanco de 200x200 sobre negro:
    //    ff(['-y','-f','lavfi','-i','color=c=black:s=412x839:d=1','-vf','drawbox=x=106:y=319:w=200:h=200:color=white:t=fill', ...])
    //    (drawbox SÍ está en ffmpeg-static; drawtext no).
    // 2. renderizarLienzo({ lienzo:{ancho:1920,alto:1080}, paneles:[{tipo:'telefono', aspecto:412/839}], ... })
    // 3. componerEnLienzo([{mp4, desdeSeg:0, hastaSeg:1}], { png, huecos, lienzo, salida })
    // 4. Extraer el primer frame a PNG, buscar por píxeles el ancho y alto del cuadrado blanco
    //    (recorriendo la fila y la columna centrales del hueco) y exigir |ancho/alto - 1| < 0.03.
});

test('dos entradas: ambos huecos tienen contenido (no negro)', async () => { /* dos fuentes de colores distintos; leer el centro de cada hueco */ });
```

`pruebas/montaje.test.mjs`:

```js
test('compatibilidad: sin superficies ni dividir ni audio, montar produce lo mismo que antes', async () => {
    // Mismo fixture que los tests actuales de montaje: comparar dimensiones (1600x1000 o las del fixture),
    // duración ±0.05 s y que el audio sea mono (la cadena vieja) — `Audio: aac.*mono`.
});

test('con superficies: un actor teléfono sale en un lienzo de video.ancho x video.alto y con audio estéreo 48 kHz', async () => { /* … */ });

test('dividir: el tramo muestra las dos pistas y dura lo mismo que el segmento', async () => { /* … */ });

test('clics traducidos al reloj del video: un clic en tGlobal cae dentro de su segmento', () => {
    // probar la función pura exportada `clicsEnVideo(segmentos, clics)` de montaje.mjs
});
```

Los tests marcados `/* … */` se escriben completos con pistas sintéticas: `ff(['-f','lavfi','-i','testsrc=s=412x839:d=3', …])` para la pista del teléfono y `testsrc=s=1600x1000` para la de escritorio. Los `pasos` se arman a mano (`{escena, actor, tLocal, tGlobal, duracionMs, dividir}`) y `voz` es `{ disponible: () => false }`. Las aserciones exactas son las de cada título.

- [ ] **Step 2: Correr y ver que fallan.**

- [ ] **Step 3: Implementación**

`composicion.mjs`:

```js
import { ff } from './ffmpeg.mjs';

export function lienzoDe({ presentacion, video }) {
    return presentacion ? presentacion.salida : { ancho: video.ancho, alto: video.alto };
}

/**
 * Compone uno o dos tramos de pista dentro del lienzo. El orden es el mismo de la
 * presentación (y por la misma razón): fondo negro, videos en sus huecos, PNG del lienzo
 * ENCIMA — el PNG trae el hueco transparente con esquinas antialias, así que tapa el
 * sobrante rectangular del video sin recortes con alfa binario.
 */
export function componerEnLienzo(entradas, { png, huecos, lienzo, salida }) {
    const dura = entradas[0].hastaSeg - entradas[0].desdeSeg;
    const args = ['-y'];
    for (const e of entradas) args.push('-ss', String(e.desdeSeg), '-t', String(dura), '-i', e.mp4);
    args.push('-i', png);
    const f = [`color=c=black:s=${lienzo.ancho}x${lienzo.alto}:d=${dura}[b0]`];
    entradas.forEach((_, i) => {
        const h = huecos[i];
        f.push(`[${i}:v]scale=${h.ancho}:${h.alto}:force_original_aspect_ratio=decrease,pad=${h.ancho}:${h.alto}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25[e${i}]`);
        f.push(`[b${i}][e${i}]overlay=${h.x}:${h.y}:shortest=1[b${i + 1}]`);
    });
    const n = entradas.length;
    f.push(`[${n}:v]scale=${lienzo.ancho}:${lienzo.alto}[marco]`);
    f.push(`[b${n}][marco]overlay=0:0,format=yuv420p[v]`);
    ff([...args, '-filter_complex', f.join(';'), '-map', '[v]', '-t', String(dura),
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', salida]);
    return salida;
}
```

En `montaje.mjs`, dentro del paso 1 (cortar), si `modoLienzo`, cada `trozo` se produce con `componerEnLienzo` en lugar del `ff` de escalado. El resto del pipeline (concat, tiempos, subtítulos) no cambia. Con `modoLienzo` se salta el bloque 2b de la presentación. Hay que exportar `clicsEnVideo(segmentos, clics)`, que es pura.

- [ ] **Step 4: Correr y ver que pasan** — tests nuevos + `npm test`. Verificación visual: extraer con ffmpeg un frame de un tramo dividido (teléfono | ventana) a PNG, abrirlo con Read y describirlo.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "Montaje en lienzo por superficie, tramos divididos y mezcla nueva

Cada trozo se compone con el marco de su superficie y los traspasos muestran a
los dos actores a la vez: es lo que hace legible un caso que cruza siete
pantallas. Sin superficies el montaje sigue por el camino de siempre." -- src/composicion.mjs src/montaje.mjs pruebas/composicion.test.mjs pruebas/montaje.test.mjs
```

---

### Task 8: Curso (tarjetas, capítulo mapa, video con superficie), CLI `formatos`, docs y E2E

**Files:**
- Modify: `src/curso.mjs`, `cli.mjs`
- Modify: `plantillas/demo.config.mjs`, `plantillas/demo/guiones/curso.mjs`
- Modify: `docs/CONFIGURACION.md`, `docs/GUIONES.md`, `README.md` (solo la sección de funciones, breve)
- Create: `docs/TUTORIALES-MULTISUPERFICIE.md` (la guía de narrativa del spec §3, con la receta para seguridad-graneros)
- Modify: `package.json` (versión `1.14.0`)
- Test: `pruebas/curso.test.mjs`, `pruebas/cli.test.mjs`, `pruebas/extremo-a-extremo.test.mjs`

**Interfaces:**
- Consumes: todo lo anterior. `montar()` recibe `superficies`, `actores`, `origenes`, `clics`, `dimensiones` y `audio` desde `grabarCurso` y desde `demo grabar`.
- Maestro, capítulos nuevos:
  - `{ id, titulo, tipo:'mapa', narrar?:string, ms?:number }` es una tarjeta a pantalla completa sin resaltar. Dura `max(ms ?? 6000, voz + 600 ms)` y lleva su locución y su VTT.
  - `{ id, titulo, guion, superficie?:string }`: si trae `superficie` y la config declara `superficies`, antes del capítulo se inserta una tarjeta con `activa = superficie` y `anterior` igual a la superficie del capítulo previo que haya declarado una. Esa tarjeta se cuenta dentro del capítulo que ENTRA, igual que la transición 3D (ver el comentario de `duraTransicion` en `curso.mjs`).
  - `{ id, titulo, fuente:'video', archivo, superficie?:string }`: con superficie, el video se compone en el lienzo con `componerEnLienzo` (un panel del tipo de la superficie, con `aspecto` medido del propio archivo) antes de normalizarlo.
- `demo formatos <video.mp4> [--vertical] [--cuadrado]` hace ambos formatos si no se pasa ninguna bandera y escribe al lado del video.

- [ ] **Step 1: Tests que fallan**
  - `curso.test.mjs`: `pegarCapitulos` con una parte `{ tarjeta: '/ruta/mapa.mp4' }` suma la duración de la tarjeta al capítulo. Los subtítulos del capítulo se desplazan por la tarjeta: el primer cue del capítulo 2 cae en `inicioSeg + duraTarjeta (+ duraTransicion)`.
  - `cli.test.mjs`: `demo formatos x.mp4 --vertical` crea `x-vertical.mp4` y no crea `x-cuadrado.mp4`. Sin archivo, sale con código ≠ 0 y el mensaje de uso.
  - `extremo-a-extremo.test.mjs`: curso contra el juguete con dos actores. `funcionario` es escritorio con sesión; `vecina` va con `sesion:false`, `Pixel 7` y superficie `vecino`. El maestro tiene `[mapa, cap1(superficie vecino), cap2(superficie sala, con un paso dividir)]` y la config trae `audio.clic.activo=true`. Se exige:
    - el mp4 existe, con 3 capítulos y audio estéreo 48 kHz;
    - el `.md` lista 3 capítulos;
    - un frame del tramo dividido tiene contenido en los dos huecos.

- [ ] **Step 2: Correr y ver que fallan.**

- [ ] **Step 3: Implementación**

`pegarCapitulos` acepta en cada parte un `tarjeta?: string` (mp4 mudo), que se normaliza con `anullsrc` estéreo igual que la transición. Va DESPUÉS de la transición 3D y ANTES del clip. Hay que sumar `duraTarjeta[i]` al offset de los cues y a `duraCap`, y cambiar el normalizado de audio del curso a `-ar 48000`.

`grabarCurso` en `cli.mjs`:
- Resuelve `tipo:'mapa'` con `renderizarMapa` (activa null) más la locución (`voz.sintetizar(cap.narrar)`), muxeada con `cadenaDeMezcla` sobre el clip. Escribe el `.vtt` del capítulo con `generarVtt([{inicioSeg:0, finSeg:dur, narrar}])`.
- Para capítulos con `superficie`, genera la tarjeta con `renderizarMapa({activa, anterior, ms: config.video.presentacion?.mapaMs ?? 2500})`.
- Le pasa a `montar` los parámetros nuevos (`superficies: config.superficies, actores: config.actores, origenes, clics, dimensiones, audio: config.audio`).
- `demo grabar` hace lo mismo. La tarjeta solo aplica en `curso`.

`plantillas/demo.config.mjs`: bloques comentados de `superficies`, `flujo`, actor `sesion:false` con `dispositivo`, y `audio`. `plantillas/demo/guiones/curso.mjs`: un capítulo `tipo:'mapa'` comentado.

`docs/TUTORIALES-MULTISUPERFICIE.md`: las 5 reglas del spec §3, la tabla de las 7 superficies de seguridad-graneros con su config, el guion de 8 capítulos y la lista de lo que falta **en seguridad-graneros**:
- seeder `demo:preparar-contexto` con turnos abiertos, vehículos con posición e incidentes en varios estados;
- actores operador, supervisor y patrullero;
- encender `pwa-del-vecino`, `denuncia-en-react` y `grabacion-de-terreno` solo en local;
- servir `capacitor-www/` apuntando al backend local;
- clips nativos con `scrcpy --record` desde el emulador;
- MFA en local con `config('mfa.enabled')=false` o con el login `comprobar` apuntando a `/verificar-mfa`;
- la pestaña grabada tiene que estar visible, porque MapLibre usa rAF;
- Reverb y el worker levantados.

Cerrar con los avisos legales:
- Pocket TTS pide atribución CC-BY-4.0 en los créditos.
- Clonar una voz exige consentimiento escrito.
- La música la aporta el proyecto, con licencia compatible.

- [ ] **Step 4: Correr y ver que pasan** — `npm test` completo. Verificación visual del E2E: extraer 3 frames (tarjeta, teléfono solo, dividido), abrirlos con Read y describirlos.

- [ ] **Step 5: Commit**

```bash
git commit --only -m "Curso con tarjetas de superficie, capítulo mapa y demo formatos (1.14.0)

Cierra el circuito: el curso orienta al espectador antes de cada capítulo, los
clips nativos del APK entran con marco de teléfono, y el mismo tutorial sale en
vertical para redes. La guía deja lista la receta para seguridad-graneros." -- src/curso.mjs cli.mjs plantillas/ docs/ README.md package.json pruebas/curso.test.mjs pruebas/cli.test.mjs pruebas/extremo-a-extremo.test.mjs
```

---

## Self-review (hecho)

- **Cobertura del spec:**

  | Spec | Tarea |
  |---|---|
  | §4.1 | T1 y T6 |
  | §4.2 | T3 |
  | §4.3 | T7 |
  | §4.4 | T4 y T8 |
  | §4.5 | T5 (con los clics en T6 y T7) |
  | §4.6 | T2 |
  | §4.7 | T4 y T8 |
  | §3 (narrativa) | `docs/TUTORIALES-MULTISUPERFICIE.md` (T8) |
  | §7 (pruebas por píxel) | T3, T4, T7 y T8 |

- **Tipos consistentes:** `superficieDe`, `geometriaLienzo`, `renderizarLienzo → {png, huecos}`, `componerEnLienzo`, `cadenaDeMezcla → {entradas, filtro, salida}`, `renderizarMapa → mp4`, `variante → mp4` y `grabar → {pistas, pasos, origenes, clics, dimensiones}` se usan con esos nombres en todas las tareas.
- **Nota de ejecución:** las tareas T6 a T8 dan el código clave y las aserciones exactas. Algunos tests de integración se describen por sus aserciones en lugar de pegarse enteros, porque dependen del andamiaje de cada archivo de pruebas, que el implementador tiene delante. Los ejecutan implementadores Opus (decisión de César).
