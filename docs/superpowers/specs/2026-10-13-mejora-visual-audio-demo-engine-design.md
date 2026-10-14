# Pulido visual y diagnóstico de demo-engine — diseño

Fecha: 2026-10-13 · Rama: `feature/mejora-visual-audio` (base: `fac2a59`, sobre `develop`) ·
Estado: aprobado por César (Opción 1: bounded de 4 candidatos de bajo riesgo, sin tocar audio ·
sin agregar features, sin servidor externo)

## 1. Por qué

`demo-engine 1.18.1` ya hizo el "acabado moderno" (cámara que sigue clics, subtítulos
quemados, rótulos animados, 60 fps, recorte de silencios, loudnorm −16 LUFS, música con
ducking) sobre `src/acabado/`. El spec de video-moderno
(`docs/superpowers/specs/2026-10-02-video-moderno-design.md`) dejó cuatro huecos de
**consistencia y diagnóstico** que el acabado no cubre:

1. **Cuatro stacks tipográficos distintos** dibujan el mismo "cromo" sobre la marca
   (`system-ui` puro en portada/cierre, Noto Sans/Inter en subtítulos del acabado, otro
   Noto en `grabador.mjs`, etc.). El video salta de glifo entre la portada y el rótulo de
   escena del primer capítulo.
2. **Easing asimétrico** del rótulo: la entrada usa cubic-out (`acabado/capas.mjs:88`),
   la salida es lineal (`acabado/capas.mjs:103`). Se nota en cualquier rótulo que se
   queda más de 2 s.
3. **Caída silenciosa** de piper → pocket con voz inválida: el motor no avisa el
   formato esperado y el operador se entera al ver el video final con la voz cambiada
   o ausente.
4. **`esPlano` sin cobertura de test**: el contrato `data-demo-plano` que
   `componerPlano` usa para sacar el rótulo a pantalla completa está probado solo en
   integration, no unitariamente. Una refactor que rompa el atributo no se entera
   hasta el integration test.

Este bounded **no agrega features**: refactoriza lo existente para que el acabado
moderno se vea como un solo video, y blinda el diagnóstico.

## 2. Punto de partida (mirado en el código real, no supuesto)

Confirmado por el subagente de mapeo (Explore, 2026-10-13) sobre HEAD `fac2a59`:

- `src/rotulos.mjs:44` y `:71`: `font-family:system-ui` en portada y cierre.
- `src/explainer.mjs:48` (y otras 2 apariciones): `font-family:system-ui`.
- `src/grabador.mjs:23`: `font:600 22px/1.3 'Noto Sans',system-ui,sans-serif`.
- `src/acabado/capas.mjs:115`: `font-family:'Noto Sans','Inter','DejaVu Sans',system-ui,sans-serif`.
- `src/acabado/capas.mjs:88`: `easeOut = 1 - (1-u)^3` para la entrada.
- `src/acabado/capas.mjs:103`: `1 - (k+1)/(nSalida+1)` (lineal) para la salida.
- `src/voz/pocket.mjs:27-28`: `split(/:(.*)/s)` con un string sin `:` devuelve
  `['string']` → el motor busca una voz llamada `string` y falla con un mensaje
  genérico.
- `src/voz/chatterbox.mjs`: `voz` es la ruta a un `.wav` de referencia con
  consentimiento escrito (línea 30). Sin validación de existencia (es un fallo del
  operador; el motor no avisa con claridad).
- `src/rotulos.mjs:24`: `esPlano` se usa desde el montaje, pero
  `pruebas/rotulos.test.mjs` no la ejercita como unit test.

## 3. Diseño

### Candidato A — Stack tipográfico unificado del cromo del motor

**Qué cambia**: un único stack canónico exportado como constante, importado en los
cuatro lugares que dibujan "cromo" del motor. Sin tocar el `subtitulos.font:600
24px/1.34` (es el peso/tamaño lo que define legibilidad, no la familia).

**Stack canónico** (mismo que `src/acabado/capas.mjs:115`):
`'Noto Sans','Inter','DejaVu Sans',system-ui,sans-serif`

**Archivos a tocar**:
- `src/tipografia.mjs` (nuevo): exporta `STACK_TIPOGRAFIA`. El reuso de la lógica
  de "elige blanco o negro según el mayor contraste" que ya existe en
  `src/lienzo.mjs:313-321` queda fuera del alcance de este bounded.
- `src/rotulos.mjs:44`, `:71`: reemplazar `system-ui` por `STACK_TIPOGRAFIA` (vía
  import).
- `src/explainer.mjs:48` (y las otras dos apariciones detectadas por el subagente:
  `:208`, `:346`): reemplazar.
- `src/grabador.mjs:23`: reemplazar el literal.
- `src/acabado/capas.mjs:115`: importar `STACK_TIPOGRAFIA` y reemplazar el literal
  (la fuente del stack canónico, así si cambia no hay que tocar 5 archivos).

**Por qué `src/tipografia.mjs` y no una constante en `capas.mjs`**: la constante
debe estar en un módulo "neutro" (no de un paquete específico) para que los
otros la importen sin arrastrar dependencias del acabado.

**Qué NO cambia**:
- `subtitulos.font:600 24px/1.34` (es peso/tamaño, no familia).
- `pruebas/acabado-capas.test.mjs` que mide contraste con `ebur128` real (sigue
  pasando porque el stack de fuentes es independiente del contraste medido).
- `lienzo.mjs:313-321` (ya tiene la lógica de "texto según contraste"; convive).

### Candidato B — Easing cubic en la SALIDA del rótulo

**Qué cambia**: `src/acabado/capas.mjs:103` usa `1 - (k+1)/(nSalida+1)` (lineal).
Lo reemplazo por `easeOut((k+1)/nSalida)` (cubic-out) con la misma
`easeOut = 1 - (1-u)^3` que ya usa la entrada en `:88`.

**Archivos a tocar**:
- `src/acabado/capas.mjs:88-108`: reordenar el bucle para que la SALIDA use
  `easeOut` aplicado a `(1 - u)`. Sin cambiar el contrato externo de
  `estadosDeRotulos({inicio, fin, datos})`.

**Qué NO cambia**: `ENTRADA_S`, `SALIDA_S`, `PASOS_POR_SEG`, los demás easing
del archivo, los `cuesDeVoz` (la línea 88 ya es cubic y no se toca).

### Candidato D — Validar formato de voz en pocket y chatterbox

**Qué cambia**: el `split(/:(.*)/s)` de `src/voz/pocket.mjs:27-28` acepta cualquier
string. Si el consumidor pasa `voz: 'sin-dos-puntos'`, el split devuelve
`['sin-dos-puntos']` y el motor busca una voz con ese nombre. Lo cambio a una
validación temprana: si el string no contiene `:`, `archivosListos` devuelve
`false` y `m.error()` incluye el formato esperado. Mismo patrón para
`chatterbox.mjs` con la validación de que la ruta al `.wav` de referencia existe.

**Archivos a tocar**:
- `src/voz/pocket.mjs:27-28`: agregar check `if (!voz.includes(':'))` antes del
  split, con un mensaje que diga "voz debe tener formato '<idioma>:<voz>'".
- `src/voz/chatterbox.mjs:25` (la resolución de la ruta): agregar check de
  existencia del archivo de referencia con `fs.existsSync` antes de aceptar
  la voz, con un mensaje que diga "el .wav de referencia debe existir".
- `pruebas/voz-nuevos.test.mjs`: una prueba para cada caso mal formado
  verifica que `m.disponible() === false` y que `m.error()` menciona el
  formato.

**Qué NO cambia**: el comportamiento con un `voz` bien formado, el
`atempo` post-síntesis, el `env: OFFLINE`, el flujo de fallback piper → pocket
(sigue cayendo a `spanish:alba` por default).

### Candidato E — Test unitario de `data-demo-plano`

**Qué cambia**: `pruebas/rotulos.test.mjs` no ejercita `esPlano` como test
unitario. Lo agrego.

**Archivos a tocar**:
- `pruebas/rotulos.test.mjs`: tres asserts nuevos:
  1. Después de `portada(page, ...)` con un `data:` URL fixture, `await esPlano(page) === 'portada'`.
  2. Después de `cierre(page, ...)` con el mismo fixture, `await esPlano(page) === 'cierre'`.
  3. Después de `page.goto('about:blank')` (sin pintar nada) o
     `page.goto('https://example.com')` (navegación al sistema grabado),
     `await esPlano(page) === null`. Esto blinda la invariante "una
     navegación borra la portada del atributo" (mencionada en el comentario
     de `rotulos.mjs:17-19`).

**Qué NO cambia**: la implementación de `esPlano`, el atributo HTML, la
lógica de `componerPlano` en `montaje.mjs`.

## 4. Pruebas

- **Unitarias puras por candidato** (E, D, A, B): se agregan en
  `pruebas/<paquete>.test.mjs` siguiendo el patrón del repo (ver
  `pruebas/rotulos.test.mjs`, `pruebas/voz-nuevos.test.mjs`,
  `pruebas/acabado-capas.test.mjs`).
- **Suite completa**: `npm test` (correr `node pruebas/correr.mjs`) debe
  pasar sin romper los 354 tests existentes.
- **Con ffmpeg real para A**: una prueba de contraste que renderice un rótulo
  con `STACK_TIPOGRAFIA` y verifique que el string del `font-family` está
  presente en el HTML (sin requerir Noto/Inter instaladas en CI).
- **Verificación visual** (opcional, no obligatoria en CI): correr
  `node cli.mjs init` + `node cli.mjs grabar` contra el juguete y ver el
  video. La mejora visual es subjetiva; el suite verde es lo que cuenta.

## 5. Fuera de alcance

- **Servidor externo para TTS** (OpenAI, ElevenLabs, Azure, etc.): vetado por
  `CLAUDE.md` y `docs/PRIVACIDAD.md`. Las voces son locales (Kokoro, Piper,
  Pocket, Chatterbox, cada uno en su venv, `HF_HUB_OFFLINE=1`).
- **Cambio del defecto del stack tipográfico** del navegador (cualquier
  fuente que NO esté ya en el sistema): "Noto Sans" e "Inter" siguen
  siendo opcionales; el motor cae a `system-ui` en cualquier máquina.
- **Cambio del motor TTS por default**: Kokoro + Piper siguen siendo los
  principales; Pocket y Chatterbox siguen siendo opt-in.
- **Mejoras de audio** más allá de la validación de formato de voz (C:
  calibrar música por LUFS, A's alimiter, etc.): otro bounded si se
  prioriza después.
- **Cambios en `montaje.mjs`, `ffmpeg.mjs`, `grabador.mjs`, `sesiones.mjs`,
  `auditoria.mjs`, `cli.mjs`, `plantillas/`**: este bounded es estrictamente
  visual + diagnóstico. El acabado moderno ya está hecho.
- **Refactor del CLI o de las plantillas**.
- **No pushear** sin OK explícito de César.

## 6. Riesgos

- **Cambio de string (A)**: el motor de Chromium cae al primer stack
  disponible; en cualquier máquina Linux sin Noto/Inter cae a `system-ui`,
  mismo render que hoy. Riesgo bajo.
- **Cambio de easing (B)**: las pruebas que miden opacidad < 0.5 al
  principio y al final siguen pasando (cubic-out arranca cerca de 1 y
  termina cerca de 0 igual que lineal). Riesgo bajo.
- **Validación de voz (D)**: agrega un mensaje accionable a una rama de
  fallo. Riesgo bajo.
- **Test de esPlano (E)**: agregar cobertura. Riesgo nulo.

## 7. Decisiones del diseño (rulings)

- **Implementador usa Opus** (instrucción explícita de César en planes
  previos del repo): el skill de SDD default es cheap tier, pero acá
  César pidió Opus. Se respeta.
- **Sin worktree, directo en `develop` (convención)**: el repo trabaja en
  checkout principal con rama `feature/...` desde develop, no pushea sin
  OK. La rama actual `feature/mejora-visual-audio` ya está creada.
- **Commits con `git commit --only`**: el índice es compartido con
  sesiones paralelas en otros repos del ecosistema. Cada task se commitea
  con `git commit --only -- <archivos>` y mensaje en español con el
  porqué.
- **Sin `Co-Authored-By: Claude`**: el hook `commit-msg` del repo
  rechaza cualquier atribución a IA. César es el único autor.
- **4 tasks en wave 1 con disjoint files** (instrucción de César:
  "máximo de subagentes en paralelo"): E toca `pruebas/rotulos.test.mjs`,
  D toca `src/voz/pocket.mjs` + `pruebas/voz-nuevos.test.mjs`, A toca
  `src/tipografia.mjs` (nuevo) + `src/rotulos.mjs` + `src/explainer.mjs`
  + `src/grabador.mjs`, B toca `src/acabado/capas.mjs`. Sin solapamiento
  → wave 1 paralelo.
