# demo-engine

Motor genérico para grabar, montar y publicar videos-tutorial de sistemas web. Ejecuta guiones en navegadores Chromium reales, captura pantalla y voz, aplica efectos de privacidad, y genera MP4 con subtítulos sin tocar ningún servidor.

## Qué es

Un sistema que automatiza la grabación de tutoriales de video para plataformas web:

- **Grabación genuina**: lanza Chromium real, navega por el sistema, simula clics y escritura.
- **Privacidad embebida**: cubre datos sensibles en pantalla hasta que se filtran.
- **Voz automática**: sintetiza locuciones sobre la pantalla sin servidor externo.
- **Montaje offline**: ffmpeg local pega videos, dibuja subtítulos, normaliza audio.
- **Genérico**: una config y un guion por sistema, sin código hardcodeado.

## Empezar en un sistema nuevo (rápido)

```bash
# 1. Instalar (en la RAÍZ del proyecto que vas a grabar — ver nota abajo)
npm install github:muni-graneros/demo-engine        # o el tarball de un tag: .../archive/refs/tags/v1.11.0.tar.gz

# 2. Andamiaje: crea demo.config.mjs + demo/guiones/ de ejemplo + guía (no pisa lo existente)
npx demo init

# 3. Editar demo.config.mjs (baseURL, login, marca, actores) y los guiones de demo/guiones/.
#    Leer demo/CONTEXTO-Y-SEEDER.md para el dataset determinista (sin PII).

# 4. Declarar que ESTA máquina es de desarrollo (si no, el motor se niega a grabar).
#    Ver "Invariante de privacidad": la dirección IP ya no basta como prueba.
export DEMO_ENTORNO=local

# 5. Generar TODO en un comando: pack de contexto + curso (video) + manual (PDF)
npx demo preparar          # inicia sesión de los actores (una vez)
npx demo todo              # aislar PII → pack → curso → manual → restaurar PII
```

**Comandos:** `init` (andamiaje) · `preparar` (sesiones) · `grabar <guion>` (un capítulo) ·
`curso [maestro]` (encadena capítulos) · `manual [guion]` (PDF) · `contexto` (screenshots) ·
`todo [maestro]` (todo el pipeline) · `auditar <guion|video>` (revisa PII).

`demo init` deja además un `demo/.gitignore` que **ignora todo lo generado** (`contexto/`,
`salida/`, `*.mp4`) — no versiones videos ni el pack (binarios grandes + data sensible).

### La skill (la parte que hace la IA)

El **mapa de flujos** (Mermaid), el **análisis funcional** y la **plantilla del seeder
determinista** no los hace el CLI: los hace un asistente de IA (Claude) siguiendo una skill.
El paquete la trae en **`skill/`**:

- `skill/mapa-funcional/` — radiografía el sistema (mapa Mermaid + pack de contexto) y guía el
  seeder determinista y los guiones. Es el paso previo que da el ORDEN de los capítulos.
- `skill/catalogo-funcional/` — extrae todo lo funcional (flujos, roles, mensajes) en lenguaje
  de usuario, para alimentar guiones y manuales.

Para usarlas con Claude Code, cópialas a tus skills:

```bash
cp -r node_modules/demo-engine/skill/* ~/.claude/skills/
```

Flujo completo: **la skill** (entender + mapear + escribir seeder y guiones) → **el CLI**
(`demo todo`, que genera pack + video + manual). Una parte la hace la IA una vez por sistema; el
resto es un comando.

## Instalación

```bash
npm install github:muni-graneros/demo-engine
```

**Importante — dónde correr ese `npm install`:** tiene que ser en el `package.json` **desde el
que vas a invocar `demo`** y **donde vive `demo.config.mjs`** — normalmente la raíz del
proyecto que estás grabando. NO instales el paquete en un `package.json` de una subcarpeta
separada (por ejemplo `npm install --prefix e2e demo-engine` mientras `demo.config.mjs` y los
guiones viven en la raíz): eso NO funciona. Node resuelve los *bare specifiers* de un módulo
ESM (`import 'playwright'`, `import 'marked'`, etc.) buscando `node_modules` desde la ubicación
del script hacia arriba en el árbol de directorios — no desde el directorio donde corriste
`npm install`. Y `NODE_PATH` no ayuda acá: esa variable no aplica a la resolución de módulos
ESM. Si `demo-engine` (y sus dependencias) quedan instalados en `e2e/node_modules` pero
`demo.config.mjs` y los guiones están en la raíz, el CLI revienta con `ERR_MODULE_NOT_FOUND` al
intentar cargar sus propias dependencias.

Requisitos:
- **Node ≥ 20** (ESM puro, sin TypeScript)
- **ffmpeg 7.0+** (suministrado por `ffmpeg-static`)
- **Chromium** (descargado por Playwright)

Antes de grabar, instala los motores de voz (Kokoro + Piper de respaldo, ambos en español) con:

```bash
bash node_modules/demo-engine/herramientas/instalar-voces.sh
```

Esto crea un venv de Python y descarga los modelos en **`~/.cache/demo-engine/`**
(`venv/` y `voces/`; se respeta `XDG_CACHE_HOME`). Son ~670 MB: van a la caché del usuario
y no al árbol de trabajo, así se bajan una vez por máquina en vez de una vez por repo,
por worktree y por proyecto que instale `demo-engine` como dependencia — y sobreviven a un
`rm -rf node_modules`.

**Dónde busca los modelos el motor de voz, en orden:**
1. lo que declares en `demo.config.mjs` (`voz.venv` / `voz.voces`, ver más abajo)
2. las variables de entorno `DEMO_VENV` / `DEMO_VOCES`
3. el directorio del propio paquete `demo-engine` (donde los dejaban las instalaciones
   anteriores a este cambio)
4. `~/.cache/demo-engine/{venv,voces}` — donde los deja el instalador de arriba
5. el cwd del proceso, como último recurso

El paso 3 va antes que el 4 a propósito: **si ya tenías las voces dentro del repo, siguen
funcionando y no hay nada que migrar.** Si igual las querés mover para recuperar el espacio,
las instrucciones están en la cabecera de `herramientas/instalar-voces.sh` (los modelos se
mueven; el venv se rehace, porque guarda rutas absolutas).

Si instalaste los modelos en otra carpeta (por ejemplo, una compartida entre varios
sistemas), apuntá `DEMO_VENV`/`DEMO_VOCES` ahí, o declará `voz.venv`/`voz.voces` en la
config.

Sin una voz instalada, el motor genera subtítulos sin locución (no falla) — pero si la
config pide voz explícitamente (`voz.motor` distinto de `'ninguno'`) y no encuentra ningún
motor disponible, **avisa por stderr** qué buscó, dónde, y cómo instalarlo. La degradación a
"solo subtítulos" es intencional; que pase desapercibida no lo es — así fue como un curso
entero salió mudo sin que nadie lo notara hasta después de publicarlo.

## Estructura del proyecto

Tu proyecto necesita este árbol:

```
mi-sistema/
├── demo.config.mjs          # Configuración del motor
├── guiones/                 # Guiones de grabación
│   ├── login.mjs
│   ├── panel.mjs
│   ├── curso.mjs            # Guion maestro (para `demo curso`)
│   └── ...
├── docs/manual/             # Salida: MP4, PDF, Markdown
└── .sesiones/               # Sesiones guardadas (git-ignored)
```

## demo.config.mjs

Configuración completa del motor. Ejemplo:

```js
export default {
  // URL del sistema (HTTP/HTTPS). Debe permitir localhost en desarrollo.
  baseURL: 'http://127.0.0.1:8000',

  // Identidad visual (aparece en portadas).
  marca: {
    nombre: 'Mi Sistema',
    color: '#1e3a8a',           // Hex, por defecto azul oscuro
    escudo: './public/logo.png' // PNG 200x200, opcional
  },

  // Login automático: selectores CSS para campos y botón. Este bloque es el DEFECTO
  // GLOBAL; cada actor puede pisarlo total o parcialmente con su propio `login` (ver abajo).
  login: {
    url: '/login',                       // Página de entrada
    usuario: 'input[name=email]',        // Campo correo (defecto)
    clave: 'input[type=password]',       // Campo contraseña (defecto)
    enviar: 'button[type=submit]',       // Botón entrar (defecto)
    codigo: 'input[name=code]',          // Campo TOTP si hay MFA (defecto)
    comprobar: 'h1'                      // Selector que prueba éxito (opcional)
  },

  // Actores: usuarios que aparecen en los videos.
  actores: {
    funcionario: {
      email: 'f@x.cl',
      password: 'secret123',
      totp: 'SECRETODEBASE32'  // Si el actor usa TOTP (RFC 6238)
    },
    ciudadano: {
      email: 'c@x.cl',
      password: 'otro123',
      // Login propio, fusionado SOBRE el `login` global: solo hace falta pisar lo que
      // cambia. Útil cuando el sistema tiene más de una superficie de autenticación (por
      // ejemplo /admin/login para el panel de personal y /login para el portal del
      // ciudadano): sin esto, el `login` global obliga a elegir una y deja a los actores
      // de la otra sin forma de entrar.
      login: { url: '/portal-ciudadano/login' }
    }
  },

  // Rutas relativas al proyecto.
  guiones: './guiones',         // Dónde buscar los .mjs de guiones (defecto: ./demo/guiones)
  salida: './docs/manual',      // Dónde guardar MP4, VTT, PDF (defecto: ./docs/manual)

  // Video: resolución y tiempos.
  video: {
    ancho: 1600,                // Píxeles (defecto: 1600)
    alto: 1000,                 // Píxeles (defecto: 1000)
    pausaMinima: 1200,          // Milisegundos entre pasos (defecto: 1200)
    msCursor: 550               // Lo que tarda el puntero en viajar a lo que va a pulsar
                                // (defecto: 550). Bajalo para un tutorial ágil.
  },

  // Voz: síntesis de audio.
  //
  // OJO: cada motor nombra sus voces a su manera, y no son intercambiables. Kokoro usa
  // nombres propios ('ef_dora' femenina, 'em_alex' y 'em_santa' masculinas); Piper usa el
  // nombre del archivo del modelo ('es_ES-davefx-medium' busca es_ES-davefx-medium.onnx).
  // Por eso el respaldo tiene su propio campo: pasarle al respaldo la voz del motor
  // principal lo dejaría sin poder cargar nada.
  voz: {
    motor: 'kokoro',            // Motor principal: 'kokoro' | 'piper' (defecto: kokoro)
    voz: 'ef_dora',             // Voz del motor principal (defecto: ef_dora, de Kokoro)
    velocidad: 1,               // Ritmo de la locución: 1.2 habla un 20 % más rápido (defecto: 1).
                                // A 1.0 un tutorial se siente lento: quien mira ya está viendo
                                // lo que se le cuenta. Se aplica igual en Kokoro (speed) y en
                                // Piper (length-scale, que es su inverso), para que caer al
                                // respaldo no cambie la cadencia del video.
    respaldo: 'piper',          // Si el principal no está disponible (defecto: piper)
    vozRespaldo: null,          // Voz del respaldo; si es null, el respaldo usa la suya
    venv: null,                 // Carpeta del venv de Python, opcional (ver "Instalación")
    voces: null                 // Carpeta de los modelos .onnx, opcional (ver "Instalación")
  },

  // Comandos shell (opcionales).
  sembrar: 'npm run seed',      // Se ejecuta en CADA `demo grabar`, `demo curso` y `demo preparar`.
                                // Tiene que ser IDEMPOTENTE: lo normal es que borre lo suyo y
                                // vuelva a crearlo. Sin siembra por corrida, la segunda graba
                                // sobre lo que dejó la primera —casos ya resueltos que no
                                // muestran sus botones, filas acumuladas— y cada síntoma parece
                                // un selector roto cuando en realidad es el estado.
  limpiar: 'npm run clean',     // Después de todo

  // Auditoría (opcional): verifica sobre el video ya grabado, ver "Auditoría: demo auditar".
  auditoria: {
    ocr: 'http://127.0.0.1:8110/ocr',   // Endpoint OCR. SIN DEFECTO: hay que declararlo.
    patron: '(?<![\\d-])\\d{7,8}-[\\dkK](?![\\dkK])',  // Qué cuenta como identificador (defecto: RUT-like, ANCLADO)
    cada: 10,                            // Un frame cada N segundos (defecto: 10)
    maximo: 20,                          // Tope de frames por video (defecto: 20)
    validar: validarRut                  // Opcional. Descarta lecturas que no son un RUT real.
  }
};
```

Valores por defecto: video `1600x1000`, `pausaMinima 1200ms`, voz Kokoro español con Piper de respaldo, login en URL raíz con selectores estándar, auditoría cada 10s hasta 20 frames (sin endpoint OCR por defecto: hay que declararlo).

**Ojo con los selectores por defecto en paneles Filament (5 + Livewire 4):** los ejemplos de
arriba (`input[name=email]`, `input[type=password]`) son genéricos y sirven para un form HTML
cualquiera, pero un panel Filament típico NO los cumple:
- El campo de correo no trae atributo `name`: es `id="form.email"` con `wire:model="data.email"`.
  Selector que sí funciona: `input[id="form.email"]` (o `[wire\\:model="data.email"]`) — usar
  un selector de atributo con el valor entre comillas evita tener que escapar el punto.
- El campo de contraseña tampoco trae `type="password"` en el HTML que sirve el servidor: lo
  agrega Alpine.js recién al hidratar en el navegador. Buscarlo por `input[type=password]`
  ANTES de esa hidratación no encuentra nada. Selector que sí funciona, y que no depende de
  cuándo hidrató Alpine: `input[wire\\:model="data.password"]`.

## Presentación

Opcional y OPT-IN: sin este bloque en `video.presentacion`, el video sale exactamente
como la grabación cruda, a pantalla completa (comportamiento idéntico al de siempre —
más de diez proyectos ya usan el motor y ninguno debe cambiar de aspecto sin declararlo).
Declarado, la grabación se mete dentro de un marco tipo "ventana de navegador" sobre un
fondo, y en `demo curso` cada cambio de capítulo puede hacer una transición 3D.

```js
video: {
  ancho: 1600, alto: 1000,
  presentacion: {
    fondo: null,                  // Color o gradiente CSS ('#0f172a', 'linear-gradient(...)'),
                                  // o null = gradiente 135° derivado de marca.color.
                                  // No acepta imágenes: están fuera de alcance.
    padding: 80,                  // Margen entre el borde del fondo y la ventana (px)
    radio: 16,                    // Radio de las esquinas de la ventana (px)
    sombra: true,                 // Sombra proyectada bajo la ventana
    barra: true,                  // Barra superior tipo navegador (con baseURL en la URL simulada)
    salida: { ancho: 1920, alto: 1080 }, // Resolución final del video (distinta de video.ancho/alto)
    transicion3d: { activa: true, ms: 900, gradosMax: 12 }, // Giro 3D al cambiar de capítulo
  },
},
```

**Costo de render:** las transiciones se calculan frame a frame. Medido en el equipo de
referencia (ThinkPad E490, salida 1920x1080), una transición de 900 ms —los 23 frames que le
corresponden a 25 fps— cuesta **entre 5 y 8 segundos de render**: los ~94 ms por frame de la
captura más el arranque de un Chromium propio por transición, que es lo que domina el número.
No se ve así en el video (dura los 900 ms declarados), pero un curso de seis capítulos son
cinco transiciones, o sea del orden de medio minuto extra en `demo curso`.

**`transicion3d.activa: false`** deja el marco (fondo + ventana con sombra) pero sin ningún
movimiento entre capítulos: es la opción para material que necesita una versión sin
animación — por ejemplo, para cumplir `prefers-reduced-motion` o por pedido explícito de
quien va a mirar el video.

## Ritmo: por qué el video sale fluido

Un tutorial se siente lento por cosas que no son la velocidad de la voz. El motor
resuelve las tres, y por eso **el ritmo ágil es el comportamiento por defecto**:

**1. La locución se sintetiza ANTES de grabar.** Kokoro tarda decenas de segundos
por frase en una máquina sin GPU. Sintetizándola dentro del bucle, ese rato queda
grabado como una pantalla congelada entre paso y paso, y quien mira lo lee como
«el sistema se quedó pensando». Ahora todas las locuciones se generan antes de
abrir la grabación, cacheadas por texto.

**2. La voz suena MIENTRAS el paso actúa.** Antes cada paso duraba la acción más
la locución entera: primero la pantalla se movía en silencio, después se quedaba
quieta hablando. Ahora lo que la acción ya consumió se descuenta de la espera, así
que el paso dura lo que dura su locución y las dos cosas coinciden.

**3. Los tiempos por defecto son cortos** (`pausaMinima: 350`, `msCursor: 260`,
`voz.velocidad: 1.25`). A velocidad natural una locución de tutorial se arrastra,
porque quien mira ya está viendo en pantalla lo que se le cuenta.

Medido en un tutorial de 13 escenas y 19 narraciones: **de 7:28 a 3:13 sin sacar
una sola escena**. Más de la mitad del video eran huecos.

### Si tu tutorial quiere ir más pausado

Es legítimo —una capacitación larga quiere aire— y se pide en la config:

```js
video: { pausaMinima: 1800, msCursor: 700 },
voz:   { velocidad: 0.95 },
```

### Lo que sigue estando en tus manos

Las esperas que escribas dentro de `hacer` **se suman** a la locución, no la
reemplazan. Si un paso queda largo, revisá esos `waitForTimeout` antes de tocar la
velocidad de la voz. Y preferí esperar por un elemento (`waitFor({ state:
'visible' })`) antes que dormir un número fijo: una espera fija que «funcionaba»
suele estar apoyada en el colchón de otro paso, y se rompe en cuanto el ritmo
cambia.

## Guiones: estructura

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

## CLI: cinco comandos

### 1. Preparar sesiones

```bash
demo preparar
```

- Ejecuta `config.sembrar` si existe (resetea datos, carga fixtures, etc.).
- Loguea a cada actor guardando cookies en `.sesiones/`.
- Necesario antes de grabar.

### 2. Grabar un guion

```bash
demo grabar panel
```

- Ejecuta `guiones/panel.mjs` contra sesiones previas.
- Abre un Chromium por actor.
- Captura video webm (Playwright), sintetiza voz wav.
- Emite: `docs/manual/panel.mp4` (video montado con subtítulos).

### 3. Montar curso

```bash
demo curso
```

- Lee `guiones/curso.mjs`.
- Graba cada capítulo (o carga pregrabados si están en `fuente: 'video'`).
- Pega todos en un MP4 único con transiciones.
- Emite:
  - `docs/manual/curso.mp4` (video final)
  - `docs/manual/curso.md` (índice de capítulos con tiempos)

### 4. Generar manual PDF

```bash
demo manual [guion]
```

- Genera PDF a partir de un guion grabado.
- Incluye capturas de cada escena, subtítulos como texto.
- Emite: `docs/manual/[guion].pdf` (o `docs/manual/curso.pdf` en el caso maestro de abajo).

**Sin argumento, o con el guion maestro:** `demo manual` (sin argumento) carga
`guiones/curso.mjs` — el mismo maestro que usa `demo curso`. Como ese guion declara
`capitulos`, no `escenas`, el motor lo detecta y genera el manual **encadenado de todos sus
capítulos** (cada `guion:` de `capitulos` se graba y sus pasos se agregan uno tras otro; los
capítulos con `fuente: 'video'` no aportan pasos propios, así que salen como una nota con la
ruta del archivo en vez de capturas). Esto también aplica si le pasás explícitamente el
nombre de un guion maestro (`demo manual curso`).

**Con un guion normal** (uno que declara `escenas`, no `capitulos`): `demo manual panel`
graba ese guion solo y genera el manual de sus escenas, como siempre.

### 5. Auditar un video ya grabado

```bash
demo auditar panel
# o, contra una ruta directa:
demo auditar docs/manual/panel.mp4
```

- Toma un guion ya grabado (busca `[guion].mp4` en `config.salida`, como `curso`/`manual`) o
  una ruta a un `.mp4` directamente.
- Muestrea frames del video y les pasa OCR (ver "Auditoría: `demo auditar`" más abajo).
- Imprime, por cada frame sospechoso, el **segundo exacto** y la ruta del frame guardado en
  `config.salida/auditoria/[guion]/`.
- **Código de salida distinto de cero si encontró algo sospechoso** — pensado para correr en CI.
- Sin `config.auditoria.ocr`, falla con un mensaje que dice exactamente qué falta, en vez de
  un error de conexión críptico.

**Costo:** el OCR tarda ~9,5s por frame. Por eso es un comando aparte, no algo que corra
en cada `demo grabar` — auditar un video de varios minutos toma minutos, no segundos (un
curso real: 31 peticiones, ~5 minutos).

**Reintento ante fallos transitorios.** Con ese costo, una sola petición perdida por un
parpadeo de red no puede tirar toda la corrida — eso solo empuja a saltarse el control. Un
fallo de RED (la petición no llegó a tener respuesta: socket cortado, timeout) se reintenta
una vez, mismo criterio que ya usa la síntesis de voz (ver `src/voz/proceso.mjs`). Un fallo
que SÍ trae respuesta del servidor (un 404 por endpoint mal configurado, un 500 consistente)
no se reintenta: el servidor ya contestó, y va a contestar exactamente lo mismo la segunda
vez — reintentar ahí solo demora el fracaso. Si tras el reintento el frame o la captura
siguen sin poder leerse, `demo auditar` corta con un mensaje que dice qué imagen falló y por
qué — nunca se reporta "limpio" sobre algo que no se pudo revisar.

## Privacidad: `abrirFiltrado` y `abrirVerificado`

El motor protege datos sensibles **durante la grabación** tapando la pantalla desde el primer frame hasta que los datos están a salvo de mostrarse de más. Esto es crítico porque muchas aplicaciones (Filament, Livewire, etc.) pintan **la tabla completa** y luego la filtran con JavaScript — esa ventana es la fuga que el motor debe bloquear.

### Invariante de privacidad

**Jamás se graba un dato sensible sin protección.** Dos niveles:

1. **Entorno declarado a mano:** `exigirEntornoDeDesarrollo(config.baseURL)` exige
   `DEMO_ENTORNO=local|testing|development` (o `APP_ENV` con uno de esos valores) y, además,
   que el host no sea público. **Sin declaración no se graba**: el defecto es negar.
   Antes esto se deducía de la IP —cualquier `10.x`, `192.168.x` o loopback se daba por
   desarrollo— y eso es exactamente lo que había que sacar: en la red municipal la VPN
   interna y **los sistemas en producción** viven en esos mismos rangos privados, así que la
   inferencia relajaba el guardián justo donde hay datos reales de vecinos.
2. **Pantalla tapada hasta que se cumple una condición:** `abrirFiltrado`/`abrirVerificado` cubren la pantalla, abren la URL, esperan a que una condición se cumpla **de forma estable**, y solo entonces destapan. Si la condición no se cumple, **la pantalla se queda tapada y la función lanza** — nunca se graba "por las dudas".

### Cuál usar: `abrirFiltrado` vs `abrirVerificado`

`abrirVerificado(page, url, comprobar, opciones?)` es la función genérica: `comprobar` es un
predicado de solo lectura sobre el DOM ya pintado, y `abrirVerificado` lo llama en un bucle
hasta que da verdadero varias veces seguidas (o se acaba el tiempo, y ahí lanza). No asume
nada sobre la pantalla — ni que hay un buscador, ni qué significa "estar filtrado" — así que
sirve para **cualquier** pantalla con datos de varias personas.

`abrirFiltrado` es el caso más común de eso: pantallas **con un buscador** que reduce una
tabla a una sola fila. Está construido sobre `abrirVerificado` (le pasa `preparar` para
escribir el filtro y apretar enter, y `comprobar` para contar las filas).

Usa `abrirFiltrado` cuando la pantalla tiene un campo de búsqueda. Usa `abrirVerificado`
cuando no hay nada que escribir. **Ejemplo:** una cola de atención del día lista a quien sea
que esté citado ahora — sin buscador, porque no tiene sentido "filtrar" una cola. Ahí
`abrirFiltrado` no aplica: el predicado tiene que juzgar directamente lo que quedó pintado.

```js
import { abrirVerificado } from 'demo-engine';

await abrirVerificado(page, baseURL + '/admin/mi-turno', async () => {
  const nombres = await page.locator('.mt-item-nom').allTextContents();
  return nombres.every(esPermitido);   // TODOS deben estar permitidos
});
```

### Ejemplo: filtrar solicitudes por RUT

```js
import { abrirFiltrado, exigirEntornoDeDesarrollo } from 'demo-engine';

// En config
export default {
  baseURL: 'http://127.0.0.1:8000',  // Solo localhost/red privada
  // ...
};

// En el guion
{
  actor: 'funcionario',
  narrar: 'Buscamos al ciudadano por su RUT.',
  hacer: async (page) => {
    // Abre /panel, cubre la pantalla, filtra por RUT, destapa solo cuando 
    // la tabla tenga una sola fila.
    await abrirFiltrado(page, 'http://127.0.0.1:8000/panel', {
      filtro: '#filtro',               // Selector del input de búsqueda
      valor: '11111111-1',             // RUT (o valor que reduce la tabla)
      selectorFilas: 'tr.fila',        // Selector de las filas de datos
    });
    // Ahora solo se ve una fila. Se graba normalmente.
    await page.click('a.ver');
  }
}
```

### Si necesitas código personalizado durante el filtrado

```js
await abrirFiltrado(page, baseURL + '/panel', {
  filtro: '#filtro',
  valor: '12345678-5',
  selectorFilas: 'tr.fila',
  alPintar: async () => {
    // Se ejecuta 3 veces: al tapar (antes de filtrar), al filtrar, y al destapar.
    // Útil para clickear botones o esperar cambios que no ocurren en la URL.
    await page.waitForTimeout(100);
  },
  esperaMs: 10000  // Timeout para que el filtro se aplique (defecto: 5000 ms)
});
```

### Menos común: tapar/destapar manualmente

Si **no** usas `abrirFiltrado` (porque la lógica es más rara), puedes hacerlo a mano:

```js
import { cubrir, descubrir } from 'demo-engine';

{
  hacer: async (page) => {
    await cubrir(page);                // Pantalla negra desde ahora
    await page.goto('/seccion-sensible');
    await page.fill('input[type=search]', 'filtro-valor');
    await page.click('button[type=submit]');
    await page.waitForTimeout(500);    // Espera a que el JavaScript filtre
    await descubrir(page);             // Ahora se ve
  }
}
```

**Importante:** `cubrir` cubre **toda la pantalla**, no un elemento suelto. Se repone si una navegación ocurre, y la altura es exactamente la del viewport (no hay overflow).

### Validación en tiempo de compilación

```js
// Esto aborta ANTES de grabar:
exigirEntornoDeDesarrollo(config.baseURL, process.env);
// Falla si:
// - No hay entorno declarado           ← el defecto, y el caso más común
// - CUALQUIERA de las dos, DEMO_ENTORNO o APP_ENV, dice 'production', 'staging', etc.
//   (declarar desarrollo en la otra NO lo tapa: la señal de producción manda)
// - El host es público (aunque el entorno diga 'local')
// Solo continúa si:
// - Al menos una de las dos está declarada, y NINGUNA de las declaradas dice otra cosa
//   que 'local', 'testing' o 'development'
//   Y el host es 127.x, 192.168.x, 10.x, 172.16-31.x, ::1, localhost, *.local, *.lan, *.test
// - O DEMO_FORZAR=1 (pero no lo hagas en producción)
```

La dirección **nunca autoriza**, solo puede negar: un `10.x` o un `localhost` pueden ser
producción perfectamente (en el despliegue por islas, dentro de la isla, `localhost:8031` ES
el sistema real). Por eso el permiso viene de una variable que alguien puso a propósito y el
comportamiento por omisión es no grabar.

## Auditoría: `demo auditar`

`abrirFiltrado`/`abrirVerificado` protegen **durante la grabación**, pero dependen de que el
guion las llame — una auditoría real encontró que 4 de 10 guiones de un sistema en uso no lo
hacían, y dejaban varias personas a la vista. `demo auditar` verifica **el resultado**, no la
intención: mira lo que quedó en disco y busca datos a la vista, sin confiar en que el guion
hizo lo correcto.

Audita **dos cosas**, con el mismo criterio: el `.mp4` grabado Y las capturas que `demo
manual` incrusta en el `.md`/`.html`/`.pdf` (`capturas/*.png` dentro de `config.salida`). El
manual es un canal de fuga tan real como el video —una captura sin filtrar queda publicada
en el PDF igual que un frame sin filtrar queda en el MP4— y antes de esto quedaba
completamente fuera del portero automático: un guion descuidado (sin `abrirFiltrado`) podía
dejar una captura con varias personas a la vista incrustada en un manual publicado sin que
nada la detectara.

### Cómo funciona

**Video:**
1. Muestrea frames del MP4 con ffmpeg (el mismo binario estático que ya trae el motor), uno
   cada `auditoria.cada` segundos, hasta `auditoria.maximo` frames — pero **siempre al menos
   uno** si el video tiene contenido: con un video más corto que `auditoria.cada` (un guion de
   una sola escena, por ejemplo), el paso efectivo se recorta a la duración real para que el
   primer frame (segundo 0) nunca se pierda. Sin esto, `fps=1/cada` de ffmpeg no entregaba
   ningún frame y el comando "aprobaba" sin haber mirado nada.
2. Manda cada frame al servicio OCR configurado en `auditoria.ocr`.
3. Cuenta cuántos identificadores **distintos** matchean `auditoria.patron` en el texto que
   devolvió el OCR. **Más de uno en el mismo frame significa que había una lista sin
   filtrar** — la misma fuga que `abrirFiltrado` existe para evitar.

**El patrón por defecto está ANCLADO (desde v1.1.1).** Antes no lo estaba, y eso era un
defecto de exactitud confirmado por una revisión de seguridad: `\d{7,8}-[\dkK]` sin anclar
muerde **dentro** de cadenas más largas en vez de exigir un identificador completo. Dos
casos reales:

```
"9918039759-0"        (número de 10 dígitos) → sin anclar extrae "18039759-0", que además
                       VALIDA como RUT real: un identificador fantasma.
"Folio 12345678-2024" → sin anclar extrae "12345678-2" (el validador de dígito verificador
                       lo descarta después, pero ya se había extraído).
```

El daño va en las dos direcciones: un identificador fantasma marca **de más** (y un
control que grita en falso termina desactivado); y dos cadenas largas **distintas** que
comparten la cola (`9918039759-0` y `5518039759-0`, por ejemplo) colapsan en el **mismo**
identificador extraído, marcando **de menos** — justo lo que este control existe para
evitar. El patrón por defecto ahora exige que no haya otro dígito (ni un guion) inmediatamente
antes del identificador, ni otro dígito (ni `k`/`K`) inmediatamente después.

Si el video no tiene contenido examinable (duración cero, corrupto), no hay frames que
muestrear. Eso **nunca** se reporta como "0 de 0 sospechosos": `demo auditar` corta con un
mensaje explícito y código de salida distinto de cero — un resultado "0 de 0" sería
indistinguible de una auditoría real que sí miró y no encontró nada.

**Capturas del manual:** mismo paso 2 y 3 de arriba, pero SIN muestreo — a diferencia del
video (una corriente continua de la que conviene recortar solo cada tantos segundos), cada
paso del guion ya deja UNA sola captura, así que se audita cada PNG que haya en
`capturas/`. Si una captura resulta sospechosa, no hace falta guardar una copia aparte: la
imagen ya vive en disco (es la misma que embebe el manual), así que es su propia evidencia.

No hace falta que el OCR lea bien el texto: está afinado para cédulas, no para interfaces
web, y en la práctica **lee mal algún carácter pero mantiene el patrón intacto** (verificado
a mano: leyó `12145678-5` donde decía `12345678-5` — un dígito mal, el patrón sigue
matcheando). Por eso alcanza con contar coincidencias del patrón.

### Configuración (`demo.config.mjs`)

```js
export default {
  // ...
  auditoria: {
    ocr: 'http://127.0.0.1:8110/ocr',                  // endpoint del servicio OCR, SIN VALOR POR DEFECTO
    patron: '(?<![\\d-])\\d{7,8}-[\\dkK](?![\\dkK])',  // qué cuenta como identificador (regex, sin flags; anclado desde v1.1.1)
    cada: 10,                                          // un frame cada N segundos
    maximo: 20,                                        // tope de frames por video
  },
};
```

**Compatibilidad (v1.1.1):** el patrón por defecto cambió (ver arriba). Esto es un arreglo
de exactitud, no un cambio de comportamiento declarado — pero cambia lo que se detecta. Un
sistema que hoy pasa `demo auditar` limpio podría empezar a marcarse (si dependía, sin
saberlo, de que un identificador fantasma quedara agrupado con otro y no superara el
umbral de "más de uno"); y al revés, un sistema con dos identificadores largos que
compartían cola y colapsaban en uno solo ahora los verá contados como corresponde. Si se
depende del comportamiento viejo (sin anclar) por algún motivo, `auditoria.patron` sigue
siendo 100% configurable: basta con declarar `'\\d{7,8}-[\\dkK]'` explícitamente.

**`auditoria.ocr` no tiene valor por defecto, a propósito:** es un host al que el proceso se
conecta, y esa decisión le corresponde a quien configura el sistema, no al motor genérico —
igual que `baseURL`. El motor tampoco sabe de RUT chilenos: `patron` es un regex de config,
no lógica hardcodeada; el valor de arriba es solo un defecto razonable para RUT, totalmente
reemplazable. Sin `auditoria.ocr`, `demo auditar` falla con un mensaje que dice exactamente
qué falta (no un `ECONNREFUSED` críptico contra `null`).

El servicio OCR debe aceptar `POST` con el archivo en un campo `file` (`multipart/form-data`)
y responder `{ text: "..." }`.

### Validación de identificadores (`auditoria.validar`)

**El problema, diagnosticado con un caso real.** `demo auditar` cuenta identificadores
DISTINTOS que matchean `auditoria.patron`; más de uno en una pantalla es la señal de una
lista sin filtrar. Corrido sobre el curso real de un sistema en producción, marcó una
captura como sospechosa:

```
[SOSPECHOSO CAPTURA] 2 identificadores distintos (16030759-0, 18023759-0)
```

Era un **falso positivo**: la pantalla mostraba una sola persona, con la tabla correctamente
filtrada a un resultado. Su RUT real (`18039759-0`) aparecía **tres veces** en pantalla —en
el buscador, en el chip de filtro activo, y en la celda de la tabla— y el OCR, que está
afinado para cédulas y no para texto de interfaz, lo transcribió mal en dos de esas tres
lecturas. Las dos cadenas "distintas" eran lecturas erróneas del **mismo** identificador, no
dos personas.

**Por qué esto importa más que un aviso molesto:** un portero que grita en falso termina
desactivado, y entonces no protege nada.

**La solución: `auditoria.validar` es una función OPCIONAL que descarta coincidencias del
patrón que no son un identificador real.** El RUT chileno trae dígito verificador (módulo
11); una lectura errónea del OCR casi nunca lo satisface por casualidad:

```
18039759-0   RUT VÁLIDO      ← el real
16030759-0   inválido        ← lectura errónea del OCR
18023759-0   inválido        ← lectura errónea del OCR
```

```js
// demo.config.mjs
function validarRut(id) {
  const limpio = id.toUpperCase();
  const [cuerpo, dv] = limpio.split('-');
  if (!cuerpo || !dv) return false;

  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  const dvEsperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  return dv === dvEsperado;
}

export default {
  // ...
  auditoria: {
    ocr: 'http://127.0.0.1:8110/ocr',
    patron: '(?<![\\d-])\\d{7,8}-[\\dkK](?![\\dkK])',
    validar: validarRut,
  },
};
```

Con `validar` declarado, `contarIdentificadores` llama a esa función por cada coincidencia
del patrón y descarta las que no aprueba; un frame o captura donde todas menos una resultan
inválidas queda con **un solo** identificador real, y ya no se marca como sospechoso.
**Sin `validar`, el comportamiento no cambia**: se sigue contando todo lo que matchea
`patron`, exactamente como hasta ahora — es puramente opt-in.

**El motor sigue sin saber qué es un RUT.** `validarRut` de arriba no vive en el motor: es
un ejemplo para `demo.config.mjs` de cada sistema consumidor, igual que `patron` u `ocr`.
Cualquier otro identificador (RFC mexicano, DNI argentino, un ID interno con su propio
checksum) se resuelve con la misma idea: una función `(id: string) => boolean` que solo
quien configura el sistema puede escribir, porque solo esa persona sabe qué hace válido a
su identificador.

**El límite honesto: esto reduce mucho los falsos positivos, no los elimina.** Una lectura
errónea del OCR puede, por pura casualidad, caer en un identificador con dígito verificador
correcto — con un solo dígito de control eso pasa aproximadamente 1 de cada 11 veces. Frente
a "toda coincidencia del patrón cuenta", que es 100% de las lecturas erróneas, la mejora es
grande mientras `patron` produzca varios candidatos por pantalla (el caso real de arriba). No
es una garantía criptográfica: es un filtro de forma, igual que `patron` lo es, solo que un
paso más estricto.

Si `validar` lanza una excepción, `demo auditar` falla con un mensaje que dice qué
identificador estaba validando y el motivo — no se traga el error en silencio.

### Salida

```
[SOSPECHOSO] segundo 40s — 2 identificadores distintos (12345678-5, 87654321-0) — frame guardado en: docs/manual/auditoria/panel/frame-0005.png
[SOSPECHOSO CAPTURA] 2 identificadores distintos (12345678-5, 87654321-0) — imagen: docs/manual/capturas/panel-3.png

docs/manual/panel.mp4: 1 de 12 frames sospechosos.
docs/manual/capturas: 1 de 4 capturas sospechosas.
```

Cada frame sospechoso del video queda **guardado en disco** (`config.salida/auditoria/[guion]/`)
junto con el segundo exacto en que apareció; cada captura sospechosa YA vive en disco (es la
misma imagen que embebe el manual) — un aviso que no se puede inspeccionar no sirve de nada.
El comando termina con código de salida **distinto de cero** si encontró algo en cualquiera de
los dos (video o capturas), para poder usarlo como gate en CI.

### Capturas: se limpian al empezar cada corrida

`demo grabar`/`demo curso`/`demo manual` limpian `capturas/` (dentro de `config.salida`) ANTES
de grabar nada, igual que ya se hace con los directorios temporales del montaje (`.tmp`,
`.tmp-curso`). Sin esto, una captura sin filtrar que dejó una corrida vieja sobrevive
indefinidamente en un directorio que termina incrustado en el manual publicado — nadie la
vuelve a mirar una vez que el video de esa corrida ya está aprobado.

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

- **`[guion].mp4`**: video montado, 1600x1000, H.264 + AAC
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

### Voz
- `crearVoz(config: {motor?, voz?, respaldo?, venv?, voces?}) → vozEngine`
  - `.disponible() → bool`
  - `.sintetizar(texto) → rutaWav | null`
  - `venv`/`voces` son opcionales; sin ellos, resuelve por `DEMO_VENV`/`DEMO_VOCES`, después
    por el directorio del propio paquete y después por `~/.cache/demo-engine`
    (ver "Instalación" para el orden completo)
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
- `instalarCursor(page) → Promise<void>` (dibuja cursor SVG, idempotente)
- `moverCursorA(page, selector) → Promise<void>` (mueve con easing)
- `pulsar(page, selector, { alPintar? }) → Promise<void>` (mueve, halo, clic)
- `acercarA(page, selector, { escala? }) → Promise<void>` (zoom sobre elemento, escala defecto: 1.6)
- `alejar(page) → Promise<void>` (vuelve al zoom 1:1)

### Portadas
- `portada(page, { titulo, subtitulo?, capitulo?, marca?, esperaMs? }) → Promise<void>`
- `cierre(page, { mensaje, marca?, esperaMs? }) → Promise<void>` (simétrico a `portada`)

## Invariantes

1. **Offline**: sin llamadas de red en tiempo de ejecución para grabar/montar. La única
   excepción es `demo auditar`, que por definición necesita hablar con un servicio OCR
   externo — por eso es un comando aparte, explícito, y nunca corre como parte de `grabar`.
2. **Privacidad**: jamás registra datos de sistemas reales. Hace falta declarar el entorno
   (`DEMO_ENTORNO=local|testing|development`) y que el host no sea público; sin
   declaración no graba. La IP no es prueba de nada: la producción municipal vive en los
   mismos rangos privados que el desarrollo.
3. **Subtítulos**: pista `mov_text` dentro del MP4 + sidecar `.vtt`.
4. **Reproducibilidad**: mismo guion + misma config = mismo MP4.
5. **Genérico**: el motor no conoce RUT chilenos, puertos ni hosts concretos de ningún
   sistema consumidor — eso vive en `demo.config.mjs` (`baseURL`, `auditoria.ocr`,
   `auditoria.patron`, `auditoria.validar`, etc.), nunca hardcodeado.

## Titularidad y licencia: DECISIÓN PENDIENTE

> Esta sección no resuelve nada. Deja planteada una pregunta que hoy **no tiene respuesta
> escrita en ninguna parte**, para que la conteste César (con Jurídica si corresponde) en
> vez de que la siga contestando el silencio.

### El hecho

Hoy este repositorio **no declara licencia**: no hay archivo `LICENSE` y `package.json` no
trae el campo `license` (ni `author`, ni `repository`). Sin una concesión expresa, lo que
aplica por omisión es "todos los derechos reservados": nadie tiene permiso escrito para
usarlo, ni siquiera quienes ya lo usan.

Y ya lo usan tres frentes que, por regla del ecosistema, **no se mezclan**:

| Consumidor | Frente |
|---|---|
| `atencionvecino`, `licencias-graneros`, `rrhh-graneros`, `discapacidad-graneros` | Municipalidad de Graneros |
| `scaffold-laravel-filament-pwa` | base de **muni-kit** (JV con Gastón Leiva) y de **KraftDo SpA** |

El motor es **genérico** por diseño (invariante 5: no conoce ningún sistema concreto), pero
vive bajo la cuenta `muni-graneros`. Esa combinación —código reutilizable, alojado en la
cuenta de una de las tres entidades, consumido por las tres— es exactamente la que conviene
resolver por escrito antes de que crezca.

### La pregunta

**¿Quién es el titular de los derechos de `demo-engine`, y bajo qué licencia lo consumen los
otros dos frentes?**

El artículo que gobierna esto es el **8° de la Ley 17.336**, que asigna la titularidad del
software producido por un trabajador dependiente. Si aplica o no depende de hechos que solo
César y la Municipalidad conocen —qué dice el contrato, si se produjo en el ejercicio de las
funciones del cargo, con qué equipos y en qué horario—, y eso no se deduce leyendo el repo.
**No lo decida quien mantenga este archivo.**

### Opciones, con sus consecuencias

**A. Titular la Municipalidad, licencia abierta permisiva (MIT / Apache-2.0).**
Es la que menos fricción genera: KraftDo y muni-kit lo consumen sin pedir permiso ni firmar
nada, y el municipio conserva la autoría. A cambio, el motor queda liberado también para
cualquier tercero —incluido un competidor de KraftDo— sin contraprestación. Apache-2.0 suma
una concesión expresa de patentes que MIT no tiene.

**B. Titular la Municipalidad, uso interno, y licencia expresa a los otros dos frentes.**
El municipio mantiene el control y KraftDo/muni-kit operan bajo un convenio escrito
(gratuito o no, revocable o no). Es lo más prolijo para la regla de los tres frentes, pero
hay que redactar y firmar ese convenio: mientras no exista, el consumo actual desde el
scaffold sigue sin respaldo documental.

**C. Titular César, licenciado a la Municipalidad.**
Solo es viable si los hechos del art. 8° respaldan que la obra no es del empleador. Deja a
César libre para explotarlo comercialmente vía KraftDo, y el municipio pasa a depender de
una licencia de un particular: conviene que sea perpetua e irrevocable para lo ya
desplegado, o el municipio queda expuesto si la relación cambia.

**D. Doble licencia.** Abierta para uso municipal y público, comercial para KraftDo. Es la
más flexible y la más cara de mantener: exige que el titular sea uno solo e inequívoco
(vuelve a A, B o C como paso previo) y disciplina para no aceptar contribuciones externas
sin cesión de derechos.

Cualquiera que se elija, hay que **escribirla en `LICENSE` y en el campo `license` de
`package.json`**, y decidir si el repo se queda en la cuenta `muni-graneros` o se muda a
la del titular real.

### Restricción independiente: las dependencias tienen su propia licencia

Esto no depende de quién sea el titular y acota lo que se puede elegir:

| Dependencia | Licencia declarada | Nota |
|---|---|---|
| `ffmpeg-static` 5.3.0 | **GPL-3.0-or-later** | Trae un binario de FFmpeg precompilado |
| `playwright` 1.62.1 | Apache-2.0 | |
| `three` 0.185.1 | MIT | |

El caso a mirar es **`ffmpeg-static`**. El motor lo invoca como **proceso separado**
(`spawnSync` sobre la ruta del binario, en `src/ffmpeg.mjs`), no lo enlaza, que es el
escenario donde habitualmente se sostiene que no se produce una obra derivada. Pero
*redistribuir* ese binario —cosa que pasa sola en cuanto alguien instala el paquete— sí
arrastra las obligaciones de la GPL sobre el binario. Antes de publicar `demo-engine` bajo
una licencia permisiva o comercial, **esto hay que revisarlo con quien corresponda**; acá
solo se deja anotado el hecho, no una opinión legal.

Los modelos de voz (Kokoro y Piper) **no se distribuyen** con el paquete: los descarga el
usuario en su propia máquina con `herramientas/instalar-voces.sh`. Eso simplifica el
problema, pero cada modelo conserva su licencia de origen y hay que verificarla antes de
usar los videos resultantes con fines comerciales.
