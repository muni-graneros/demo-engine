# Tutoriales multi-superficie

Algunos sistemas no son "un sistema": son varias superficies que se pasan un mismo caso. El
vecino denuncia desde el celular, la sala de operaciones lo recibe en escritorio, el
patrullero lo atiende desde una app Android y la jefatura lo revisa en el panel. Si el video
corta de un escritorio a un teléfono sin avisar, el espectador pierde **dónde está** y
**quién** está actuando.

Esta guía explica cómo contar un caso así con demo-engine (desde la 1.14.0). La receta de
ejemplo es la de **seguridad-graneros**, pero las reglas sirven para cualquier sistema con
varias superficies.

La referencia de cada clave está en [CONFIGURACION.md](CONFIGURACION.md#tutorial-multi-superficie)
y en [GUIONES.md](GUIONES.md#capítulos-de-un-curso-multi-superficie).

---

## Criterio de éxito

Al terminar el tutorial "panorama", un funcionario que nunca vio el sistema tiene que poder
responder tres preguntas:

1. ¿Qué superficies existen y quién usa cada una?
2. ¿Por dónde entra un caso y por dónde sale?
3. ¿Qué ve cada actor cuando otro actúa? Por ejemplo, la denuncia *aparece* en la sala, la
   asignación *suena* en el teléfono del patrullero y el cierre *llega* al celular del vecino.

En lo técnico, el espectador **siempre** sabe en qué superficie está, gracias al marco y al
chip. Los traspasos entre superficies se **ven** en pantalla dividida, no solo se narran.

## Las cinco reglas

### 1. Un caso, de punta a punta

El hilo es **un** incidente con un elenco ficticio, no un paseo por los menús. Los capítulos
son **momentos del caso**, no superficies: la tercera pregunta solo se responde viendo los
traspasos, y un capítulo por superficie los esconde entre capítulos.

### 2. Tarjeta de superficies al entrar a cada capítulo

El curso abre con un capítulo `tipo: 'mapa'`. Es el diagrama completo, sin nada resaltado,
con quién usa cada superficie. Después, cada capítulo que declara `superficie` entra con la
misma tarjeta durante unos 2,5 s (`presentacion.mapaMs`). En esa tarjeta:

- la superficie activa va resaltada con «Usted está aquí»;
- la superficie del capítulo anterior aparece atenuada, con la flecha del traspaso marcada.

Cada superficie lleva color, ícono y **texto**, porque el color nunca puede ser lo único que
la identifica (WCAG 2.2, 1.4.1).

### 3. Marco según el dispositivo

Una superficie de escritorio se muestra en una ventana de navegador. Una de teléfono se
muestra en un marco de teléfono genérico, sin marca comercial. En los dos casos aparece
arriba el **chip de la superficie**, con su nombre, su ícono y su color.

Cada actor graba a su tamaño real. Un `Pixel 7` graba a 412×840, así que su pista no se
estira hasta el ancho del escritorio.

### 4. Cursos derivados, no videos distintos

Del mismo set de guiones salen dos tipos de curso, sin volver a grabar nada:

- el *panorama*, que es el maestro completo, de 8 a 10 minutos;
- un curso por rol (operador, patrullero, vecino, jefatura). Cada uno es otro guion maestro
  que reordena o filtra los capítulos.

El formato vertical para redes sale del video terminado con `demo formatos`.

### 5. Lo nativo se inserta, no se simula

Chromium no tiene GPS en segundo plano, notificaciones de turno ni la grabación cifrada del
APK. Esas partes se graban una vez en el emulador con `scrcpy --record` y entran como capítulo
`fuente: 'video'` **con** `superficie`. El motor mide el aspecto del clip y lo compone en el
marco de teléfono con su chip, así que queda indistinguible del resto. Si el clip viene
apaisado con una rotación en la metadata (`displaymatrix`), el motor la respeta y lo trata
como vertical. Lo que no corrige es un clip grabado de costado **sin** metadata: ese hay que
enderezarlo antes.

---

## Receta: seguridad-graneros

### Las siete superficies

| # | Superficie | Tecnología | Quién la usa | `superficies.<id>` |
|---|---|---|---|---|
| 1 | Landing pública `/` | Blade | cualquiera | `landing: { nombre: 'Sitio público', tipo: 'escritorio', color: '#334155', quien: 'Cualquiera' }` |
| 2 | Denuncia `/denuncia` y consulta `/consultar` | Inertia + React / Blade | vecino | `denuncia: { nombre: 'Denuncia en línea', tipo: 'telefono', color: '#9a3412', quien: 'Vecina' }` |
| 3 | PWA del vecino `/vecino` | Inertia + React + SW | vecino | `vecino: { nombre: 'App del vecino', tipo: 'telefono', color: '#7c2d12', quien: 'Vecina' }` |
| 4 | Enlace de ubicación `/ubicacion/{token}` | React + MapLibre | afectado | `ubicacion: { nombre: 'Enlace de ubicación', tipo: 'telefono', color: '#86198f', quien: 'Afectado' }` |
| 5 | Consola `/consola/sala` | Inertia + React + Reverb | operador, supervisor | `sala: { nombre: 'Sala de operaciones', tipo: 'escritorio', color: '#1e3a8a', quien: 'Operador' }` |
| 6 | Panel `/admin` | Filament (SPA) | jefatura, administración | `admin: { nombre: 'Panel de jefatura', tipo: 'escritorio', color: '#3f3f46', quien: 'Jefatura' }` |
| 7 | APK "Terreno Graneros" | Capacitor 8 + React | patrullero | `apk: { nombre: 'App del patrullero · Android', tipo: 'telefono', color: '#166534', quien: 'Patrullero' }` |

Los colores van en hexadecimal: la tarjeta calcula con ellos el contraste de la etiqueta. Son
oscuros a propósito, para que el texto blanco cumpla 4.5:1.

```js
// demo.config.mjs (extracto)
flujo: [
  ['denuncia', 'sala'], ['sala', 'ubicacion'], ['ubicacion', 'sala'],
  ['sala', 'apk'], ['apk', 'vecino'], ['sala', 'admin'],
],
actores: {
  operador:   { email: 'operador@demo.cl',   password: process.env.DEMO_CLAVE ?? 'password', superficie: 'sala' },
  supervisor: { email: 'supervisor@demo.cl', password: process.env.DEMO_CLAVE ?? 'password', superficie: 'sala' },
  jefa:       { email: 'jefa@demo.cl',       password: process.env.DEMO_CLAVE ?? 'password', superficie: 'admin' },
  vecina:     { sesion: false, dispositivo: 'Pixel 7', superficie: 'denuncia' },
  patrullero: { sesion: false, dispositivo: 'Pixel 7', superficie: 'apk',
                baseURL: 'http://localhost:8072', permisos: ['geolocation'],
                geolocalizacion: { latitude: -34.065, longitude: -70.727 } },
},
audio: { clic: { activo: true, volumen: 0.5 } },
video: { ancho: 1600, alto: 1000, presentacion: { salida: { ancho: 1920, alto: 1080 }, mapaMs: 2500 } },
```

### El guion: ocho capítulos

El elenco es ficticio: la vecina Marta Soto, el operador Diego, el patrullero Cabo Rojas y la
jefa Ana.

| # | Capítulo | Superficie | Cómo se graba |
|---|---|---|---|
| 1 | *El mapa* (~30 s) | — | `tipo: 'mapa'`, con `narrar` presentando quién usa qué |
| 2 | *Marta avisa* | `denuncia` | Marta denuncia desde el celular y recibe un folio |
| 3 | *La sala lo recibe* | `sala` | `dividir: ['vecina', 'operador']`: Marta envía y el incidente entra a la sala |
| 4 | *¿Dónde es exactamente?* | `ubicacion` | el operador pide la ubicación y Marta marca el pin (`dividir`) |
| 5 | *Despacho* | `sala` | `dividir: ['operador', 'patrullero']`: el operador asigna y el teléfono del patrullero recibe |
| 6 | *En terreno* | `apk` | el APK acepta, traza la ruta, marca en sitio, registra el procedimiento y las fotos; el audio y el GPS van en un clip nativo `fuente: 'video'` |
| 7 | *Cierre* | `vecino` | `dividir: ['patrullero', 'vecina']`: el patrullero resuelve, la PWA de Marta muestra el cierre y Marta califica |
| 8 | *La jefatura mira* | `admin` | panel Filament con reportes, mapa de calor, bitácora y moderación |

Cada guion abre los dos actores del tramo dividido **antes** de dividir: el paso anterior
navega al actor pasivo. Si no, su panel sale en blanco y el motor avisa.

### Lo que falta en seguridad-graneros

Todo esto es trabajo **en ese repo**, no en el motor:

- Un seeder `demo:preparar-contexto` con turnos abiertos, vehículos con posición e incidentes
  en varios estados. Tiene que ser idempotente, porque corre antes de cada grabación.
- Los actores operador, supervisor y patrullero en ese seeder.
- Encender `pwa-del-vecino`, `denuncia-en-react` y `grabacion-de-terreno` **solo en local**.
- Servir `capacitor-www/` apuntando al backend local. Es la `baseURL` del actor `patrullero`.
- Los clips nativos, grabados con `scrcpy --record` desde el emulador.
- El MFA en local: `config('mfa.enabled') = false`, o un login con `comprobar` que apunte a
  `/verificar-mfa`.
- La pestaña grabada tiene que estar **visible**. MapLibre dibuja con `requestAnimationFrame`,
  y en una pestaña oculta el mapa no avanza.
- Reverb y el worker de colas levantados. Sin ellos, la denuncia no *aparece* en la sala y el
  tramo dividido del capítulo 3 no muestra nada.

---

## Variantes para redes

```bash
demo formatos demo/salida/curso.mp4               # curso-vertical.mp4 (1080×1920) y curso-cuadrado.mp4 (1080×1080)
demo formatos demo/salida/curso.mp4 --vertical    # solo el vertical
```

El video se centra sobre una copia suya agrandada y desenfocada, así que no queda ninguna
franja negra. El audio, los subtítulos y los capítulos se copian tal cual.

## Avisos legales

- **Pocket TTS**: su código es MIT y sus pesos son **CC-BY-4.0**. Un video narrado con
  Pocket lleva en sus créditos una línea de atribución, por ejemplo: «Voz sintética: Pocket
  TTS, Kyutai, CC-BY-4.0».
- **Clonar una voz** (Chatterbox, o Pocket con un `.wav` de referencia) exige el
  **consentimiento escrito** de la persona. La voz es un dato personal (Ley 21.719), y el
  consentimiento debe quedar archivado junto al `.wav`.
- **La música la aporta el proyecto**, con una licencia compatible con el uso institucional y
  la publicación del video. El motor no trae ninguna pista, y la licencia de la que se use es
  responsabilidad del proyecto.
