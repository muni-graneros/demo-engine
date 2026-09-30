# Configuración — `demo.config.mjs`

Todo lo que el motor sabe de tu sistema vive acá. Hay una plantilla lista para copiar en
`plantillas/demo.config.mjs` (la misma que deja `demo init`); los valores por defecto reales
están en `src/configurar.mjs`.

---

## El archivo completo

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

  // Video: resolución y tiempos. Los defectos son los de un tutorial ÁGIL (ver "Ritmo").
  video: {
    ancho: 1600,                // Píxeles (defecto: 1600)
    alto: 1000,                 // Píxeles (defecto: 1000)
    fps: 25,                    // Cuadros por segundo del montaje (defecto: 25)
    calidad: 90,                // Calidad de las capturas del montaje (defecto: 90)
    pausaMinima: 350,           // Milisegundos entre pasos (defecto: 350). Subilo para
                                // una capacitación con más aire.
    msCursor: 260,              // Lo que tarda el puntero en viajar a lo que va a pulsar
                                // (defecto: 260)
    presentacion: null,         // Marco tipo navegador + transición 3D (defecto: null = crudo)
    cursorEnCapturas: true      // false: las capturas por paso (las del manual) salen sin
                                // cursor ni halo; el video lo sigue mostrando (desde 1.15)
  },

  // Subtítulos (.vtt y pista del MP4), desde 1.15: cada locución se parte en frases y en
  // bloques de a lo más `lineas` líneas de `ancho` caracteres, con el tiempo repartido según
  // el largo. `partir: false` vuelve al cue por paso de antes.
  subtitulos: { partir: true, ancho: 42, lineas: 2 },

  // Banderas extra de Chromium para grabar, preparar sesiones y el pack de contexto (1.15).
  // Solo banderas `--…`; `--host-resolver-rules` solo puede mapear a 127.x/localhost/[::1]
  // (mapear a otra máquina saltaría el guardián de entorno, que decide por el host de baseURL).
  // Caso típico: que el APK y los enlaces muestren el dominio público grabando en local.
  navegador: {
    args: [],  // p. ej. ['--host-resolver-rules=MAP seguridad.ejemplo.cl 127.0.0.1:8071']
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
    velocidad: 1.25,            // Ritmo de la locución: 1.25 habla un 25 % más rápido (defecto: 1.25).
                                // A 1.0 un tutorial se siente lento: quien mira ya está viendo
                                // lo que se le cuenta. Se aplica igual en Kokoro (speed) y en
                                // Piper (length-scale, que es su inverso), para que caer al
                                // respaldo no cambie la cadencia del video.
    respaldo: 'piper',          // Si el principal no está disponible (defecto: piper)
    vozRespaldo: null,          // Voz del respaldo; si es null, el respaldo usa la suya
    venv: null,                 // Carpeta del venv de Python, opcional (ver "Voces", abajo)
    voces: null                 // Carpeta de los modelos .onnx, opcional (ver "Voces", abajo)
  },

  // Comandos shell (opcionales).
  sembrar: 'npm run seed',      // Se ejecuta en CADA `demo grabar`, `demo curso` y `demo preparar`.
                                // Tiene que ser IDEMPOTENTE: lo normal es que borre lo suyo y
                                // vuelva a crearlo. Sin siembra por corrida, la segunda graba
                                // sobre lo que dejó la primera —casos ya resueltos que no
                                // muestran sus botones, filas acumuladas— y cada síntoma parece
                                // un selector roto cuando en realidad es el estado.
  limpiar: 'npm run clean',     // Después de todo

  // Pack de contexto (`demo contexto` y `demo todo`): un screenshot por pantalla declarada.
  // `aislar`/`mostrar` son comandos DEL SISTEMA GRABADO (no del CLI de este repo) que
  // sustituyen la PII por datos de demostración y la restauran después; `mostrar` corre
  // siempre, incluso si la captura falla a la mitad.
  contexto: {
    salida: './demo/contexto',
    // Cada pantalla: { id, url?, actor?, esperaTexto?, hacer?, completa?, esperaMs? }.
    // `actor: null` (u omitido) captura SIN sesión: landing, login, pantallas de error.
    pantallas: [
      { id: 'pub-01-login', url: '/login', actor: null },
      { id: 'app-01-inicio', url: '/', actor: 'funcionario' }
    ],
    aislar: 'docker compose exec -T app php artisan demo:preparar-contexto --aislar',
    mostrar: 'docker compose exec -T app php artisan demo:preparar-contexto --mostrar'
  },

  // Privacidad y auditoría. `patron`/`validar` los usan DOS controles: el chequeo en vivo
  // de cada paso (`chequeoEnVivo`) y `demo auditar` sobre lo que quedó en disco.
  auditoria: {
    ocr: 'http://127.0.0.1:8110/ocr',   // Endpoint OCR. SIN DEFECTO: hay que declararlo.
    patron: '(?<![\\d-])\\d{7,8}-[\\dkK](?![\\dkK])',  // Qué cuenta como identificador (defecto: RUT-like, ANCLADO)
    token: process.env.DEMO_OCR_TOKEN,   // Header X-Service-Token del OCR. SIN DEFECTO; desde el entorno, nunca en claro.
    cada: 10,                            // Un frame cada N segundos, en TODO el video (defecto: 10)
    maximo: null,                        // Opcional: tope de frames; reparte en vez de cortar (defecto: sin tope)
    validar: validarRut,                 // Opcional. Descarta lecturas que no son un RUT real.
    chequeoEnVivo: true                  // Portero por paso durante la grabación (defecto: true)
  }
};
```

Valores por defecto reales (`src/configurar.mjs`): video `1600x1000` a 25 fps,
`pausaMinima 350 ms`, `msCursor 260 ms`, sin presentación; voz Kokoro `ef_dora` a
velocidad `1.25` con Piper de respaldo; guiones en `./demo/guiones` y salida en
`./docs/manual`; auditoría de un frame cada 10 s **en todo el video** (sin tope; ver docs/AUDITORIA.md,
"Política de muestreo"), con el chequeo en vivo **encendido**, **sin** endpoint OCR (ese hay
que declararlo) y **sin** `auditoria.token`: si el OCR exige credencial (el del ecosistema
contesta 401 sin ella), exportar `DEMO_OCR_TOKEN` y declarar
`token: process.env.DEMO_OCR_TOKEN`; viaja en el header `X-Service-Token` y nunca se loguea.

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
    mapaMs: 2500,                 // Duración de la tarjeta de superficies antes de cada capítulo
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

## Tutorial multi-superficie

Todo esto es opcional (desde la 1.14.0). Una config sin estas claves produce el mismo video
que la 1.13.0. La guía de narrativa, con la receta de seguridad-graneros, está en
[TUTORIALES-MULTISUPERFICIE.md](TUTORIALES-MULTISUPERFICIE.md).

```js
// Cada superficie sale con su marco y su chip, y aparece en la tarjeta «usted está aquí».
superficies: {
  sala:   { nombre: 'Sala de operaciones', tipo: 'escritorio', color: '#1e3a8a', quien: 'Operador' },
  vecino: { nombre: 'App del vecino', tipo: 'telefono', color: '#9a3412', quien: 'Vecina' },
  // icono: 'monitor' | 'phone' (defecto: según el tipo)
},
// Flechas de la tarjeta: pares [desde, hasta], ambos declarados en superficies.
flujo: [['vecino', 'sala']],

actores: {
  operador: { email: 'op@x.cl', password: process.env.DEMO_CLAVE, superficie: 'sala' },
  // sesion:false: no exige email/password y `demo preparar` lo salta (vecino anónimo, o
  // una app que se loguea dentro del guion).
  vecina: { sesion: false, dispositivo: 'Pixel 7', superficie: 'vecino' },
  patrullero: {
    sesion: false, superficie: 'apk',
    dispositivo: 'Pixel 7',                   // nombre de playwright.devices: viewport, táctil, userAgent
    baseURL: 'http://localhost:8072',         // propia: la app se sirve desde otro puerto.
                                              // Solo con sesion:false: `preparar` loguea contra la baseURL global.
    permisos: ['geolocation'],
    geolocalizacion: { latitude: -34.065, longitude: -70.727 },
  },
},

audio: {
  // La música la aporta el proyecto con licencia compatible: el motor no trae ninguna.
  // Se comprueba al cargar la config; `atenuar` la baja ~12 dB bajo la voz.
  musica: { archivo: './demo/musica.mp3', volumen: 0.12, atenuar: true },
  // Un clic corto (sintetizado, sin archivo) en cada `pulsar()`.
  clic: { activo: false, volumen: 0.5 },
},
```

- **`superficies.<id>`**: exige `nombre` y `tipo` (`escritorio` o `telefono`). El `color`
  tiene que ir en hexadecimal (`#rgb` o `#rrggbb`), porque la tarjeta calcula con él el
  contraste de la etiqueta. Si no se declara, se usa `marca.color`.
- **Un actor con `dispositivo`** graba a su viewport CSS real: un `Pixel 7` graba a 412×840.
  Sin `dispositivo`, graba a `video.ancho`×`video.alto` como siempre.
- **`tactil`** (superficie o actor, booleano, desde 1.15): en una superficie táctil el cursor
  es un indicador de toque (círculo centrado en el punto) en vez de la flecha del ratón. Manda
  el `tactil` del actor, después el de su superficie; sin declarar, es táctil el actor cuyo
  `dispositivo` lo es (`hasTouch`: Pixel 7, iPhone…). `tactil: false` lo apaga.
- **Modo lienzo**: basta con declarar `superficies` o que algún paso use `dividir` para que
  cada tramo se componga en el lienzo, con el marco de la superficie de su actor. El lienzo
  mide `presentacion.salida` o, sin presentación, `video.ancho`×`video.alto`.
- **`audio`** solo cambia la mezcla si trae música o `clic.activo`. En ese caso la mezcla
  pasa a estéreo 48 kHz y la voz se normaliza a -16 LUFS. Sin nada de eso, `demo grabar`
  mantiene la cadena mono de siempre. El curso (`demo curso`) sale siempre en estéreo 48 kHz.

### Motores de voz opcionales: Pocket y Chatterbox

```js
voz: { motor: 'pocket', voz: 'spanish:alba' },               // "<idioma>:<voz>", idioma spanish | spanish_24l
voz: { motor: 'chatterbox', voz: './demo/voz-consentida.wav' }, // SIEMPRE una voz de referencia
```

Se instalan aparte, cada uno en su propio venv dentro de la caché:
`bash node_modules/demo-engine/herramientas/instalar-voces.sh --pocket` (o `--chatterbox`).
Ese paso necesita red: además de instalar, baja los pesos de Hugging Face con una síntesis de
calentamiento (`POCKET_IDIOMA=spanish_24l` para el modelo de 24 capas; `CHATTERBOX_REF=<wav>`
para que el calentamiento de Chatterbox sea una síntesis completa). Al grabar, los dos corren
con `HF_HUB_OFFLINE=1`: si faltan los pesos, el motor no queda disponible y el aviso remite a
ese script, en vez de salir a internet a mitad de una grabación.

- **Pocket** (Kyutai): el código es MIT y los pesos son CC-BY-4.0, así que el video lleva
  una línea de **atribución en los créditos**.
- **Chatterbox** clona la voz del `.wav`. Clonar una voz exige el **consentimiento escrito**
  de la persona (Ley 21.719). Sin `voz`, el motor queda no disponible y lo dice.

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

