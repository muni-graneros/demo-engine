# demo-engine

Motor genérico para grabar, montar y publicar videos-tutorial y manuales de sistemas web.
Ejecuta guiones en Chromium reales, captura pantalla y voz, tapa los datos sensibles y
genera MP4 con subtítulos y PDF **sin tocar ningún servidor**.

## Qué es

- **Grabación genuina**: lanza Chromium con Playwright, navega, simula clics y escritura.
- **Portero de privacidad**: cubre la pantalla hasta que los datos están filtrados, y se
  **niega a grabar** un paso donde haya más de una persona a la vista.
- **Voz local**: sintetiza la locución con Kokoro (Piper de respaldo), sin servicio externo.
- **Montaje offline**: ffmpeg local pega los videos, dibuja subtítulos, normaliza audio.
- **Multi-superficie** (1.14.0): cada actor graba en su dispositivo (escritorio o teléfono), sale
  con su marco y su chip, dos actores pueden verse a la vez en pantalla dividida, y el curso
  pone la tarjeta «usted está aquí» antes de cada capítulo. También suma música atenuada bajo
  la voz, un clic sonoro y variantes vertical y cuadrada para redes. Guía en
  [docs/TUTORIALES-MULTISUPERFICIE.md](docs/TUTORIALES-MULTISUPERFICIE.md).
- **Genérico**: el motor no conoce ningún sistema; todo vive en `demo.config.mjs`.

## Requisitos

- **Node ≥ 20** (ESM puro, sin TypeScript)
- **ffmpeg 7.0+** — lo trae `ffmpeg-static`
- **Chromium** — lo descarga Playwright

## Instalación

```bash
npm install github:muni-graneros/demo-engine
```

**Dónde correr ese `npm install`:** en el `package.json` **desde el que vas a invocar `demo`**
y **donde vive `demo.config.mjs`** — normalmente la raíz del proyecto que estás grabando. NO
lo instales en una subcarpeta (`npm install --prefix e2e …` con la config en la raíz): Node
resuelve los *bare specifiers* de un módulo ESM buscando `node_modules` desde la ubicación
del script hacia arriba, y `NODE_PATH` no aplica a ESM. Si el paquete queda en
`e2e/node_modules` y los guiones en la raíz, el CLI revienta con `ERR_MODULE_NOT_FOUND`
cargando sus propias dependencias.

Antes de grabar, instala los motores de voz (Kokoro + Piper, los dos en español):

```bash
bash node_modules/demo-engine/herramientas/instalar-voces.sh
```

Crea un venv de Python y baja los modelos a **`~/.cache/demo-engine/`** (se respeta
`XDG_CACHE_HOME`). Son ~670 MB: van a la caché del usuario y no al árbol de trabajo, así se
bajan una vez por máquina y sobreviven a un `rm -rf node_modules`. Sin voz instalada el motor
genera subtítulos sin locución y **avisa por stderr** qué buscó y dónde — la degradación es
intencional, que pase desapercibida no: así fue como un curso entero salió mudo sin que nadie
lo notara hasta después de publicarlo. El orden completo en que busca los modelos está en
[docs/CONFIGURACION.md](docs/CONFIGURACION.md).

Los motores opcionales Pocket TTS y Chatterbox se instalan con `--pocket` / `--chatterbox`
(con red: el script baja sus pesos de Hugging Face con una síntesis de calentamiento); al
grabar corren con `HF_HUB_OFFLINE=1`, así que nada sale a internet. Detalle en
[docs/CONFIGURACION.md](docs/CONFIGURACION.md).

## Empezar en un sistema nuevo

```bash
# 1. Andamiaje: demo.config.mjs + demo/guiones/ de ejemplo + guía (no pisa lo existente)
npx demo init

# 2. Editar demo.config.mjs (baseURL, login, marca, actores) y los guiones de demo/guiones/.
#    Leer demo/CONTEXTO-Y-SEEDER.md para el dataset determinista (sin PII).

# 3. Declarar que ESTA máquina es de desarrollo. Sin esto el motor se niega a grabar:
#    la dirección IP no es prueba de nada (ver docs/PRIVACIDAD.md).
export DEMO_ENTORNO=local

# 4. Generar todo
npx demo preparar          # inicia sesión de los actores (una vez)
npx demo todo              # aislar PII → pack de contexto → curso → manual → restaurar PII
```

`demo init` deja también un `demo/.gitignore` que **ignora todo lo generado** (`contexto/`,
`salida/`, `*.mp4`): no versiones videos ni el pack — son binarios grandes y datos sensibles.

## Los comandos

| Comando | Qué hace |
|---|---|
| `demo init` | Andamiaje en el proyecto que se va a grabar |
| `demo preparar` | Siembra y deja la sesión iniciada de **todos** los actores |
| `demo grabar <guion>` | Graba un guion → `[guion].mp4` + `.vtt` |
| `demo curso [maestro]` | Encadena los capítulos del guion maestro → `curso.mp4` + `curso.md` |
| `demo manual [guion]` | Manual en PDF con capturas y subtítulos como texto |
| `demo contexto` | Pack de contexto: un screenshot por pantalla declarada |
| `demo todo [maestro]` | Pipeline completo: aislar PII → pack → curso → manual → restaurar |
| `demo auditar <guion\|video>` | Revisa por OCR si quedó PII en el MP4 y en las capturas |
| `demo formatos <video> [--vertical] [--cuadrado]` | Variantes 1080×1920 y 1080×1080 al lado del video (sin banderas, las dos) |
| `demo vivo [maestro\|guion]` | Presenta los guiones **en vivo**, paso a paso, sin grabar (ver [Demo en vivo](#demo-en-vivo)) |

`grabar`, `curso` y `todo` ejecutan `config.sembrar` en **cada** corrida: tiene que ser
idempotente. Sin siembra por corrida la segunda toma graba sobre lo que dejó la primera —
casos ya resueltos que no muestran sus botones, filas acumuladas— y cada síntoma parece un
selector roto cuando en realidad es el estado.

## Demo en vivo

`demo vivo` ejecuta **los mismos guiones** que se graban, frente a un público: ventanas reales
de Chromium (una por actor), y cada paso actúa cuando el presentador lo manda. No graba, no
sintetiza voz y no usa ffmpeg: **narra el presentador**, leyendo el teleprompter.

### Requisitos

- El sistema **local** levantado y sembrable (el mismo stack con que se graba) y
  `DEMO_ENTORNO=local` declarado.
- Un escritorio con pantalla (el modo con ventanas necesita un display). Lo ideal, dos monitores:
  el proyector para las ventanas (`vivo.pantalla` en la config) y la laptop para la consola.
- Para el modo seguro, los MP4 del curso ya grabados y `mpv` instalado (sin mpv se usa
  `xdg-open`; el Chromium de Playwright no reproduce H.264).

### Comandos

```bash
DEMO_ENTORNO=local npx demo vivo                       # el maestro `curso`, desde el primer capítulo
DEMO_ENTORNO=local npx demo vivo curso --desde=07      # desde el capítulo con id 07
DEMO_ENTORNO=local npx demo vivo curso --capitulos=00,04,08,15   # solo esos (un curso por rol)
DEMO_ENTORNO=local npx demo vivo c06-asignar           # un guion suelto es un capítulo
DEMO_ENTORNO=local npx demo vivo --auto                # avanza solo (tótem, sala de espera)
DEMO_ENTORNO=local npx demo vivo --headless --auto     # sin ventanas: ensayo o CI
```

Otras banderas: `--puerto=N` (consola; defecto `vivo.puerto`, 8190), `--velocidad=0.8` (cursor
más lento), `--permitir-host=HOST` (ver Riesgos), `--sin-teclado` (no toma la terminal).

Al arrancar imprime la dirección de la **consola del presentador**
(`http://127.0.0.1:8190/`): teleprompter con la narración del paso actual (grande) y la del
siguiente, capítulo, actor y superficie, y los controles. La terminal acepta las mismas teclas
(`q` o Ctrl+C para salir) e imprime la narración de cada paso como respaldo.

Por capítulo: siembra con su escena (`sembrar` como función, ver
[docs/CONFIGURACION.md](docs/CONFIGURACION.md); la escena sale del maestro o de
`export const escena` del guion), prepara las sesiones que falten, espera la orden antes de cada
paso y al salir —termine, falle o se salte— llama al `export function limpiar()` del guion si
lo exporta. En un tramo con `dividir`, las dos ventanas se ponen lado a lado; si no, la del actor
ocupa la pantalla (un teléfono, centrado a su tamaño) y las demás se minimizan.

### Teclas (las de un presentador inalámbrico)

| Tecla | Orden |
|---|---|
| `→` · `PageDown` · `Espacio` | Siguiente paso (ejecuta su acción) o siguiente capítulo |
| `←` · `PageUp` · `R` | Reintentar el paso que falló (retroceder no deshace: el paso ya cambió la base) |
| `S` | Saltar el paso |
| `P` | Pausa / reanudar (en `--auto`, detiene el avance) |
| `B` · `.` | Pantalla negra en las ventanas de los actores (avanzar la levanta) |
| `I` · `Inicio` | Reiniciar el capítulo: vuelve a sembrar y empieza de cero |
| `C` | Modo seguro: abre el video grabado del capítulo |
| `1`…`9` | Ir a ese capítulo (el menú de la consola llega a todos) |

Una orden que llega mientras un paso actúa no lo corta a la mitad: se aplica al terminar el paso.
El foco del teclado lo tiene la ventana activa: con el clicker, deja la consola en foco (idealmente
en el otro monitor); un `PageDown` sobre la ventana del sistema bajaría la página.

### Modo seguro

Si un paso falla, su ventana queda **tapada** y el error se ve solo en la consola. Se puede
reintentar, saltar, reiniciar el capítulo o pasar al clip grabado (`C`): el motor busca
`<salida>/final/<guion>/<guion>.mp4` y después `<salida>/<guion>.mp4` (configurable con
`vivo.clips`) y lo abre con `mpv --fs`. Con «siguiente» se cierra el clip y sigue el capítulo
siguiente, en vivo. Un capítulo `fuente: 'video'` del maestro va siempre por este camino.

### Riesgos

- **Nunca contra producción.** Además de `exigirEntornoDeDesarrollo`, el modo en vivo solo acepta
  loopback, `localhost` y `*.test` (una IP privada puede ser producción en la red municipal);
  un servidor de demo aislado se declara host por host con `--permitir-host` o
  `vivo.permitirHosts`. `DEMO_FORZAR=1` no se acepta en vivo.
- **Solo datos ficticios.** El seeder del sistema tiene que dejar personas, RUT y correos
  inventados: es la única protección real.
- **El portero de privacidad no previene en vivo.** Al grabar, un paso con varias personas a la
  vista aborta la toma y el video no sale. En vivo el chequeo corre al final del paso, cuando el
  público **ya vio** la pantalla: solo alcanza a taparla y avisar en la consola.
- **Sesiones.** Se verifican una vez por actor y los contextos siguen abiertos entre capítulos;
  el motor nunca fuerza un relogueo (los sistemas suelen limitar los ingresos diarios por cuenta).
- **La hora.** Lo que se ve en pantalla es la hora real del equipo: si el sistema la narra (un
  turno de la mañana), presenta en ese horario. El motor no lo controla; el script del sistema
  que lanza la demo es quien puede negarse fuera de horario (así lo hace `grabar.sh` de
  seguridad-graneros).
- Sin verificar en un escritorio real: la posición exacta de las ventanas con cada gestor de
  ventanas, el minimizado y el comportamiento del foco con el clicker.

## La parte que hace la IA

El **mapa de flujos** (Mermaid), el análisis funcional y la plantilla del **seeder
determinista** no los hace el CLI: los escribe un asistente siguiendo una skill. El paquete
las trae en `skill/`:

- `skill/mapa-funcional/` — radiografía el sistema y da el ORDEN de los capítulos.
- `skill/catalogo-funcional/` — extrae flujos, roles y mensajes en lenguaje de usuario.

```bash
cp -r node_modules/demo-engine/skill/* ~/.claude/skills/
```

Flujo completo: **la skill** (entender, mapear, escribir seeder y guiones, una vez por
sistema) → **el CLI** (`demo todo`, que genera pack + video + manual).

## Estructura del proyecto que se graba

```
mi-sistema/
├── demo.config.mjs          # Configuración del motor
├── demo/guiones/            # Guiones (defecto; configurable con `guiones`)
│   ├── login.mjs
│   ├── panel.mjs
│   └── curso.mjs            # Guion maestro (para `demo curso` y `demo todo`)
├── docs/manual/             # Salida: MP4, VTT, PDF, capturas (configurable con `salida`)
└── .sesiones/               # Sesiones guardadas (git-ignored)
```

## Privacidad: cuatro controles encadenados

1. **`exigirEntornoDeDesarrollo`** — hace falta `DEMO_ENTORNO` (o `APP_ENV`) declarado como
   `local|testing|development` y que el host no sea público. **Sin declaración no se graba.**
   La dirección nunca autoriza, solo puede negar: en la red municipal la producción vive en
   los mismos rangos privados que el desarrollo.
2. **Chequeo en vivo por paso** — al cerrar cada paso el motor cuenta identificadores en el
   DOM; si hay más de uno, cubre la pantalla y aborta la toma. La excepción se declara paso a
   paso (`variasPersonas: true`), nunca por omisión.
3. **`abrirFiltrado` / `abrirVerificado`** — tapan la pantalla, abren la URL, esperan a que
   la condición se cumpla de forma estable y recién ahí destapan.
4. **`demo auditar`** — verifica **el resultado** en disco (frames del MP4 + capturas del
   manual) por OCR, sin confiar en que el guion hizo lo correcto.

Detalle completo en [docs/PRIVACIDAD.md](docs/PRIVACIDAD.md) y
[docs/AUDITORIA.md](docs/AUDITORIA.md).

## Documentación

| Documento | Qué contiene |
|---|---|
| [docs/CONFIGURACION.md](docs/CONFIGURACION.md) | `demo.config.mjs` completo con sus valores por defecto reales, marco de presentación y transición 3D, por qué el ritmo sale ágil, selectores que sí funcionan en Filament, resolución de los modelos de voz |
| [docs/TUTORIALES-MULTISUPERFICIE.md](docs/TUTORIALES-MULTISUPERFICIE.md) | Cómo contar un caso que pasa por varias superficies: las cinco reglas, la receta de seguridad-graneros y los avisos legales (atribución de Pocket TTS, consentimiento para clonar voces, licencia de la música) |
| [docs/GUIONES.md](docs/GUIONES.md) | Estructura de un guion y del guion maestro, uso programático desde Node y la API completa |
| [docs/PRIVACIDAD.md](docs/PRIVACIDAD.md) | El portero: entorno, chequeo en vivo, `abrirFiltrado`/`abrirVerificado`, `cubrir`/`descubrir` |
| [docs/AUDITORIA.md](docs/AUDITORIA.md) | `demo auditar`: cómo muestrea, el patrón anclado, `auditoria.validar` y sus límites honestos |
| [docs/LICENCIA-PENDIENTE.md](docs/LICENCIA-PENDIENTE.md) | Titularidad y licencia: decisión pendiente, con sus opciones y la GPL de `ffmpeg-static` |

## Cómo se prueba

```bash
npm test      # node pruebas/correr.mjs — única fuente de verdad
```

Compatible con Node 20 y Node 22+. El script `pruebas/correr.mjs` descubre y ejecuta los tests automáticamente, evitando la incompatibilidad en Node 21+ cuando se pasa un directorio a `node --test`.

## Invariantes

1. **Offline**: sin llamadas de red para grabar ni montar. La única excepción es
   `demo auditar`, que por definición habla con un servicio OCR — por eso es un comando
   aparte, explícito, y nunca corre dentro de `grabar`.
2. **Privacidad**: jamás registra datos de sistemas reales; sin entorno declarado no graba.
3. **Subtítulos**: pista `mov_text` dentro del MP4 + sidecar `.vtt`.
4. **Reproducibilidad**: mismo guion + misma config = mismo MP4.
5. **Genérico**: el motor no conoce RUT chilenos, ni puertos, ni hosts de ningún sistema
   consumidor — eso vive en `demo.config.mjs`, nunca hardcodeado.

## Licencia

**Sin definir todavía.** El repo no declara licencia y `package.json` no trae el campo
`license`: por omisión, todos los derechos reservados. Como lo consumen tres frentes que por
regla no se mezclan (Municipalidad de Graneros, muni-kit y KraftDo), conviene resolverlo por
escrito. La pregunta, las opciones y la restricción independiente que impone la GPL de
`ffmpeg-static` están planteadas en
[docs/LICENCIA-PENDIENTE.md](docs/LICENCIA-PENDIENTE.md). **No la decida quien mantenga este
archivo.**
