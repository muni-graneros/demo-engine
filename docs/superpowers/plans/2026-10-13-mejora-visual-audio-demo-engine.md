# Plan: pulido visual y diagnóstico de demo-engine

Spec: `docs/superpowers/specs/2026-10-13-mejora-visual-audio-demo-engine-design.md`
Base: `fac2a59` (HEAD antes de la rama) · Rama: `feature/mejora-visual-audio` · Sin push.

## Preflight scan

| Tasks | Shared file/interface | Finding |
|---|---|---|
| T1–T4 | ninguno | disjoint files; ejecutables en wave 1 paralelo |
| T1 (E) | `pruebas/rotulos.test.mjs` | consistente: solo agrega test |
| T2 (D) | `src/voz/pocket.mjs`, `src/voz/chatterbox.mjs`, `pruebas/voz-nuevos.test.mjs` | consistente |
| T3 (A) | `src/tipografia.mjs` (nuevo), `src/rotulos.mjs`, `src/explainer.mjs`, `src/grabador.mjs`, `src/acabado/capas.mjs` | consistente: un módulo nuevo + search & replace |
| T4 (B) | `src/acabado/capas.mjs:88-108` | T3 también toca `capas.mjs:115` (otro literal); el cambio de T3 es el string del stack, el de T4 es el cálculo de opacidad; no se solapan en líneas |
| T1–T2, T3 | ninguno | T1, T2, T3 tocan archivos distintos entre sí |

Ruling: wave 1 (T1–T4) corre en PARALELO con disjoint files — instrucción
explícita de César (plan previo `2026-09-28-tutorial-multisuperficie.md` ruling
línea 17). Implementadores usan Opus (no el cheap tier default). Commits con
`git commit --only`. Sin `Co-Authored-By: Claude` (hook `commit-msg` lo
rechaza).

Ruling: el "primer stack disponible" del navegador hace que el cambio de
tipografía de T3 sea seguro: si Noto/Inter no están instaladas, el render
cae a `system-ui`, mismo que hoy. La prueba de T3 verifica el STRING del
`font-family`, no la presencia de la fuente.

Ruling: `STACK_TIPOGRAFIA` vive en `src/tipografia.mjs` (módulo neutro) y
no en `src/acabado/capas.mjs` para que `rotulos.mjs`, `explainer.mjs` y
`grabador.mjs` la importen sin arrastrar dependencias del acabado.

Ruling: T4 (cubic-out en salida) NO se toca `easeOut` de la entrada en
`capas.mjs:88` — solo el bucle de la SALIDA en `:103`. La entrada
queda igual.

---

## Wave 1 — paralelo

### Task 1: Test unitario de `data-demo-plano` (Candidato E)

**Files:**
- Modify: `pruebas/rotulos.test.mjs` (agregar 3 asserts)
- (sin cambios de código de producción)

**Interfaces:**
- Consumes: `portada(page, opts)`, `cierre(page, opts)`, `esPlano(page)` (todos en `src/rotulos.mjs`).
- Produces: 3 nuevos tests que ejercitan el contrato de `esPlano` en unit, no en integration.

- [ ] **Step 1: Tests que fallan**

Agregar al final de `pruebas/rotulos.test.mjs` (antes de la última línea vacía, junto a los demás tests):

```js
test('esPlano devuelve "portada" después de portada()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'esplano-portada-'));
    const { page } = await conPagina({ '/portada.html': `<!doctype html><title>x</title>` });
    try {
        await portada(page, { titulo: 'Hola', marca: { color: '#1e3a8a' }, esperaMs: 0 });
        assert.equal(await esPlano(page), 'portada');
    } finally { await page.context().close(); rmSync(dir, { recursive: true, force: true }); }
});

test('esPlano devuelve "cierre" después de cierre()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'esplano-cierre-'));
    const { page } = await conPagina({ '/cierre.html': `<!doctype html><title>x</title>` });
    try {
        await cierre(page, { mensaje: 'Fin', marca: { color: '#1e3a8a' }, esperaMs: 0 });
        assert.equal(await esPlano(page), 'cierre');
    } finally { await page.context().close(); rmSync(dir, { recursive: true, force: true }); }
});

test('esPlano devuelve null después de navegar a about:blank', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'esplano-blank-'));
    const { page } = await conPagina({ '/x.html': `<!doctype html><title>x</title>` });
    try {
        await page.goto('about:blank');
        assert.equal(await esPlano(page), null);
    } finally { await page.context().close(); rmSync(dir, { recursive: true, force: true }); }
});
```

(Los imports `mkdtempSync` de `node:fs`, `tmpdir` de `node:os`, `join` de `node:path`,
`rmSync` de `node:fs`, `assert` de `node:assert/strict`, `test` de `node:test` ya
deberían estar en el archivo; verificar y agregar lo que falte. `conPagina` viene
de `pruebas/entorno.mjs`.)

- [ ] **Step 2: Correr y ver que fallan**

```bash
cd ~/Dev/demo-engine && node --test pruebas/rotulos.test.mjs
```

Expected: los 3 nuevos tests fallan porque `esPlano` se llama con `page.evaluate`
y el setup de `conPagina` puede no devolver `page.context()` igual a la firma
esperada. Ajustar firmas hasta que los 3 pasen.

- [ ] **Step 3: Implementación**

Sin cambios — solo tests.

- [ ] **Step 4: Correr y ver que pasan**

```bash
cd ~/Dev/demo-engine && node --test pruebas/rotulos.test.mjs && npm test
```

Expected: PASS. La suite completa sigue verde (354 tests previos + 3 nuevos).

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/demo-engine && git add pruebas/rotulos.test.mjs && git commit --only -m "Test unitario de esPlano (data-demo-plano)

Blindar el contrato que componePlano usa para sacar el rótulo a pantalla
completa. Antes: solo probado en integration; una refactor que rompa el
atributo no se entera hasta el integration. Ahora: 3 tests unitarios
cubren portada, cierre y navegación a about:blank." -- pruebas/rotulos.test.mjs
```

---

### Task 2: Validar formato de voz en pocket y chatterbox (Candidato D)

**Files:**
- Modify: `src/voz/pocket.mjs` (líneas 27-28, agregar check temprano)
- Modify: `src/voz/chatterbox.mjs` (línea 25, agregar check de existencia del `.wav`)
- Modify: `pruebas/voz-nuevos.test.mjs` (2 tests nuevos)

**Interfaces:**
- Consumes: `crear({ voz, ... })` de cada motor.
- Produces: `m.disponible() === false` y `m.error()` con mensaje accionable cuando el formato es inválido.

- [ ] **Step 1: Tests que fallan**

En `pruebas/voz-nuevos.test.mjs` (verificar imports primero; agregar lo que falte: `existsSync`, `mkdtempSync`, `writeFileSync`, `tmpdir`, `join`, `rmSync`):

```js
test('pocket con voz sin ":" devuelve error de formato', () => {
    const m = crearPocket({ voz: 'sin-dos-puntos', venv: '/nope', voces: '/nope', ejecutarProceso: () => ({ status: 0, stdout: Buffer.alloc(0) }) });
    assert.equal(m.disponible(), false);
    assert.match(m.error(), /formato/);
    assert.match(m.error(), /idioma:voz/);
});

test('chatterbox con .wav de referencia inexistente devuelve error accionable', () => {
    const m = crearChatterbox({ voz: '/ruta/que/no/existe.wav', venv: '/nope', voces: '/nope', ejecutarProceso: () => ({ status: 0, stdout: Buffer.alloc(0) }) });
    assert.equal(m.disponible(), false);
    assert.match(m.error(), /wav/);
    assert.match(m.error(), /existe/);
});
```

- [ ] **Step 2: Correr y ver que fallan**

```bash
cd ~/Dev/demo-engine && node --test pruebas/voz-nuevos.test.mjs
```

Expected: FAIL (mensaje actual no menciona "formato" ni "idioma:voz"; chatterbox
no chequea existencia).

- [ ] **Step 3: Implementación**

En `src/voz/pocket.mjs:27-28`, antes del `split`, agregar:

```js
if (typeof voz !== 'string' || !voz.includes(':')) {
    return { disponible: () => false, error: () => `voz debe tener formato '<idioma>:<voz>', recibido: ${JSON.stringify(voz)}`, ... };
}
```

Verificar la firma real de retorno del módulo (puede ser `crearPocket` o
similar) y adaptar.

En `src/voz/chatterbox.mjs:25`, antes de aceptar `voz`, agregar:

```js
if (typeof voz !== 'string' || voz.length === 0) {
    return { disponible: () => false, error: () => `voz es la ruta a un .wav de referencia con consentimiento escrito; recibido: ${JSON.stringify(voz)}` };
}
import { existsSync } from 'node:fs';
if (!existsSync(voz)) {
    return { disponible: () => false, error: () => `el .wav de referencia debe existir; no se encontró: ${voz}` };
}
```

- [ ] **Step 4: Correr y ver que pasan**

```bash
cd ~/Dev/demo-engine && node --test pruebas/voz-nuevos.test.mjs && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/demo-engine && git add src/voz/pocket.mjs src/voz/chatterbox.mjs pruebas/voz-nuevos.test.mjs && git commit --only -m "Validar formato de voz en pocket y chatterbox

Antes: pocket con voz sin ':' buscaba una voz llamada 'string' y caía
en silencio; chatterbox aceptaba una ruta inexistente. Ahora: error
accionable con el formato esperado, sin recargar el motor. Sin cambios
de comportamiento para voces bien formadas." -- src/voz/pocket.mjs src/voz/chatterbox.mjs pruebas/voz-nuevos.test.mjs
```

---

### Task 3: Unificar stack tipográfico del cromo (Candidato A)

**Files:**
- Create: `src/tipografia.mjs` (nuevo, ~20 líneas: `STACK_TIPOGRAFIA` y `textoSegunContraste`)
- Modify: `src/rotulos.mjs:44`, `:71` (reemplazar `font-family:system-ui` por el stack)
- Modify: `src/explainer.mjs:48`, `:208`, `:346` (id.)
- Modify: `src/grabador.mjs:23` (id.)
- Modify: `src/acabado/capas.mjs:115` (id., fuente del stack)
- Modify: `pruebas/acabado-capas.test.mjs` (1 test que verifica el string del stack)
- Modify: `pruebas/rotulos.test.mjs` (1 test que verifica el stack en portada/cierre)

**Interfaces:**
- Produce: `STACK_TIPOGRAFIA` (string exportado de `src/tipografia.mjs`).
- Produce: `textoSegunContraste(colorFondo)` (helper opcional; reusar la lógica de `src/lienzo.mjs:313-321` si conviene).

- [ ] **Step 1: Tests que fallan**

```js
// en pruebas/acabado-capas.test.mjs
test('htmlDeEstado usa STACK_TIPOGRAFIA en subtítulos', () => {
    const estados = estadosDeSubtitulos({ lienzo: { ancho: 1920, alto: 1080 }, marca: { color: '#1e3a8a' }, segmentos: [{ texto: 'Hola mundo', inicioSeg: 0, finSeg: 1 }] });
    const html = htmlDeEstado(estados[0], { ancho: 1920, alto: 1080 });
    assert.match(html, /font-family:[^;]*Noto Sans/);
});

// en pruebas/rotulos.test.mjs
test('portada y cierre usan STACK_TIPOGRAFIA', async () => {
    const { page } = await conPagina({ '/x.html': '<!doctype html><title>x</title>' });
    try {
        await portada(page, { titulo: 'Hola', marca: { color: '#1e3a8a' }, esperaMs: 0 });
        const html = await page.content();
        assert.match(html, /font-family:[^;]*Noto Sans/);
    } finally { await page.context().close(); }
});
```

(Verificar firmas exactas de `estadosDeSubtitulos` y `htmlDeEstado` en `src/acabado/capas.mjs` antes de escribir el assert; puede que el atributo esté escapado distinto.)

- [ ] **Step 2: Correr y ver que fallan**

```bash
cd ~/Dev/demo-engine && node --test pruebas/acabado-capas.test.mjs pruebas/rotulos.test.mjs
```

Expected: los 2 nuevos tests fallan (los literales `system-ui` no contienen "Noto Sans").

- [ ] **Step 3: Implementación**

Crear `src/tipografia.mjs`:

```js
/**
 * Stack tipográfico canónico del cromo del motor.
 *
 * El navegador usa el primer fuente disponible; en máquinas sin Noto/Inter cae
 * a system-ui, mismo render que antes. La unificación es de string: garantiza
 * que portada, cierre, explainer, grabador y los rótulos del acabado usen
 * exactamente el mismo stack en el mismo orden.
 */
export const STACK_TIPOGRAFIA = "'Noto Sans','Inter','DejaVu Sans',system-ui,sans-serif";
```

En `src/rotulos.mjs`: agregar `import { STACK_TIPOGRAFIA } from './tipografia.mjs';` arriba;
reemplazar `font-family:system-ui` por `font-family:${STACK_TIPOGRAFIA}` en `:44` y `:71`.

En `src/explainer.mjs`: id. (verificar los 3 file:line y reemplazar).
En `src/grabador.mjs:23`: id.
En `src/acabado/capas.mjs:115`: id.

- [ ] **Step 4: Correr y ver que pasan**

```bash
cd ~/Dev/demo-engine && node --test pruebas/acabado-capas.test.mjs pruebas/rotulos.test.mjs && npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/demo-engine && git add src/tipografia.mjs src/rotulos.mjs src/explainer.mjs src/grabador.mjs src/acabado/capas.mjs pruebas/acabado-capas.test.mjs pruebas/rotulos.test.mjs && git commit --only -m "Unificar stack tipográfico del cromo del motor

Antes: cuatro stacks distintos (system-ui puro en portada/cierre, Noto
Sans/Inter en subtítulos del acabado, otro Noto en grabador). El video
saltaba de glifo entre la portada y el rótulo de escena. Ahora: un
módulo src/tipografia.mjs con STACK_TIPOGRAFIA y los cinco lugares
que dibujan cromo lo importan. Sin cambios de render en máquinas
sin Noto/Inter (cae a system-ui igual que antes)." -- src/tipografia.mjs src/rotulos.mjs src/explainer.mjs src/grabador.mjs src/acabado/capas.mjs pruebas/acabado-capas.test.mjs pruebas/rotulos.test.mjs
```

---

### Task 4: Easing cubic en SALIDA de rótulo (Candidato B)

**Files:**
- Modify: `src/acabado/capas.mjs:88-108` (reordenar el bucle de la SALIDA para usar `easeOut`)
- Modify: `pruebas/acabado-capas.test.mjs` (1 test que verifica la forma)

**Interfaces:**
- Consumes: `estadosDeRotulos({ escena, inicioSeg, duracion, antetitulo, titulo, segundos })` existente.
- Produces: misma forma externa `{inicio, fin, datos}`; solo cambia el cálculo de `datos.opacidad` durante la SALIDA.

- [ ] **Step 1: Tests que fallan**

```js
// en pruebas/acabado-capas.test.mjs
test('la salida del rótulo usa cubic-out, no lineal', () => {
    const rotulos = estadosDeRotulos({ escena: 'cap-1', inicioSeg: 0, duracion: 5, antetitulo: 'A', titulo: 'B', segundos: 2.5 });
    // rotulos es un array de {inicio, fin, datos: {opacidad, ...}}
    // Los últimos elementos son la salida. La cubic-out de u=0.5 es 0.875, no 0.5.
    const salida = rotulos.slice(-10);     // últimos 10 cuadros son SALIDA
    const mitad = salida[Math.floor(salida.length / 2)];
    assert.ok(mitad.datos.opacidad > 0.7, `cubic-out en u=0.5 debe ser > 0.7, dio ${mitad.datos.opacidad}`);
});
```

(Verificar la firma exacta de `estadosDeRotulos` y la estructura del array
devuelto; ajustar el assert a lo real.)

- [ ] **Step 2: Correr y ver que fallan**

```bash
cd ~/Dev/demo-engine && node --test pruebas/acabado-capas.test.mjs
```

Expected: el nuevo test falla (lineal en u=0.5 da 0.5, no > 0.7).

- [ ] **Step 3: Implementación**

En `src/acabado/capas.mjs:88-108`, el bucle actual de la SALIDA es:

```js
for (let k = 0; k < nSalida; k++) {
    const u = (k + 1) / (nSalida + 1);
    datos.opacidad = 1 - u;          // lineal
    ...
}
```

Cambiarlo por (mismo `easeOut` que la entrada en `:88`):

```js
for (let k = 0; k < nSalida; k++) {
    const u = (k + 1) / (nSalida + 1);
    datos.opacidad = 1 - Math.pow(1 - u, 3);   // cubic-out
    ...
}
```

Sin tocar la entrada (que ya es cubic en `:88`).

- [ ] **Step 4: Correr y ver que pasan**

```bash
cd ~/Dev/demo-engine && node --test pruebas/acabado-capas.test.mjs && npm test
```

Expected: PASS. La opacidad en el primer cuadro de SALIDA sigue cerca de 0 y
en el último cerca de 1 (igual que lineal), solo cambia la forma de la
curva intermedia.

- [ ] **Step 5: Commit**

```bash
cd ~/Dev/demo-engine && git add src/acabado/capas.mjs pruebas/acabado-capas.test.mjs && git commit --only -m "Easing cubic-out en la SALIDA del rótulo de escena

La entrada ya era cubic-out (1 - (1-u)^3) desde 1.18.0; la salida era
lineal (1 - u). Se nota en cualquier rótulo de más de 2 s: la
desaparición se siente como un 'corte' en vez de un 'respirar'.
Mismo contrato externo de estadosDeRotulos." -- src/acabado/capas.mjs pruebas/acabado-capas.test.mjs
```

---

## Rulings (a llevar al ledger)

- Wave 1 (T1–T4) corre en PARALLELO (instrucción de César). Implementadores: **Opus**.
- Commits con `git commit --only -- <archivos>`. Sin `Co-Authored-By: Claude`.
- Sin pushear ni mergear sin OK explícito de César.
- Sin worktree (convención del repo).
- El cambio de tipografía de T3 es seguro porque el navegador cae al primer
  stack disponible; en máquinas sin Noto/Inter cae a `system-ui` (mismo
  render que antes).
- T3 y T4 tocan `src/acabado/capas.mjs` pero en líneas distintas
  (T3:115 string del stack; T4:88-108 cálculo de opacidad); corren en
  paralelo sin conflicto.

## Fuera de alcance (repetido del spec, para que el implementador no se desvíe)

- Servidor externo para TTS (OpenAI, ElevenLabs, Azure): vetado.
- Cambios en `montaje.mjs`, `ffmpeg.mjs`, `grabador.mjs` (más allá de
  `grabador.mjs:23` para T3), `sesiones.mjs`, `auditoria.mjs`, `cli.mjs`,
  `plantillas/`.
- Cambios en el motor de audio más allá de T2 (formato de voz).
- Cambios en el defecto del stack tipográfico del navegador.
- Refactor del CLI o de las plantillas.
- Push a `origin/feature/mejora-visual-audio` sin OK explícito.
