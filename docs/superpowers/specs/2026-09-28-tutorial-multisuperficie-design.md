# Tutoriales multi-superficie — diseño

Fecha: 2026-09-28 · Rama: `develop` · Estado: aprobado para plan (automode, rulings registrados abajo)

## 1. Por qué

El próximo tutorial es el de **seguridad-graneros**, que no es "un sistema" sino **siete
superficies** que se pasan un mismo caso:

| # | Superficie | Tecnología | Quién la usa | Dispositivo |
|---|---|---|---|---|
| 1 | Landing pública `/` | Blade | cualquiera | escritorio/móvil |
| 2 | Denuncia `/denuncia` + consulta `/consultar` | Inertia+React / Blade | vecino | móvil |
| 3 | PWA del vecino `/vecino` | Inertia+React + SW | vecino | móvil |
| 4 | Enlace de ubicación `/ubicacion/{token}` | React + MapLibre | afectado | móvil |
| 5 | Consola `/consola/sala` | Inertia+React + Reverb | operador, supervisor | escritorio |
| 6 | Panel `/admin` | Filament (SPA) | jefatura, administrador | escritorio |
| 7 | APK "Terreno Graneros" | Capacitor 8 + React | patrullero | teléfono Android |

Hoy demo-engine graba **un solo lienzo de escritorio**: todos los actores comparten viewport
1600×1000, no hay emulación móvil ni marco de teléfono, y se ve un actor por vez. Un tutorial
así, cortando de un escritorio a un "escritorio angosto" que en realidad es un teléfono, no se
entiende: el espectador pierde **dónde está** y **quién** está actuando.

Además quedaron de la investigación del 2026-09-28 mejoras de calidad general: voz con mejor
español, música con atenuación bajo la voz, sonido de clic y variantes verticales para redes.

## 2. Qué tiene que lograr el video (criterio de éxito)

Un funcionario que nunca vio el sistema, al terminar el tutorial "panorama", puede responder:
1. ¿Qué superficies existen y quién usa cada una?
2. ¿Por dónde entra un caso y por dónde sale?
3. ¿Qué ve cada actor cuando el otro actúa? (la denuncia *aparece* en la sala; la asignación
   *suena* en el teléfono del patrullero; el cierre *llega* al celular del vecino)

Técnicamente: el espectador **siempre** sabe en qué superficie está (marco + rótulo), y los
traspasos entre superficies se **ven** (pantalla dividida), no se narran.

## 3. Diseño de la narrativa (seguridad-graneros, aplica a cualquier sistema multi-superficie)

**Regla 1 — Un caso, de punta a punta.** El hilo es UN incidente con elenco ficticio
(vecina "Marta Soto", operador "Diego", patrullero "Cabo Rojas", jefa "Ana"), no un paseo por
menús. Los capítulos son **momentos del caso**, no superficies:

1. *El mapa* (30 s): la tarjeta de superficies completa, sin resaltar, con quién usa qué.
2. *Marta avisa* — denuncia desde el celular → folio.
3. *La sala lo recibe* — **pantalla dividida**: Marta envía | la sala muestra el incidente entrar.
4. *¿Dónde es exactamente?* — enlace de ubicación: operador lo pide | Marta marca el pin.
5. *Despacho* — **pantalla dividida**: operador asigna | el teléfono del patrullero recibe.
6. *En terreno* — APK: acepta, ruta, en sitio, procedimiento, fotos, (audio: clip nativo).
7. *Cierre* — **pantalla dividida**: patrullero resuelve | la PWA de Marta muestra el cierre; Marta califica.
8. *La jefatura mira* — panel Filament: reportes, mapa de calor, bitácora, moderación.

**Regla 2 — Tarjeta de superficies al entrar a cada capítulo** (≈2,5 s): el mismo diagrama
del capítulo 1 con la superficie activa resaltada (y la anterior atenuada con flecha). Es el
"usted está aquí" del video. Color + ícono + TEXTO: el color nunca es el único portador.

**Regla 3 — Marco según dispositivo.** Escritorio → ventana de navegador (ya existe).
Móvil/APK → marco de teléfono centrado sobre el fondo de marca. Siempre con **chip de
superficie** arriba a la izquierda: "App del patrullero · Android", "Sala de operaciones".

**Regla 4 — Cursos derivados, no videos distintos.** Del mismo set de guiones salen: el
*panorama* (maestro completo, ~8–10 min) y un curso por rol (operador, patrullero, vecino,
jefatura) que reordena/filtra capítulos. Cero regrabación extra.

**Regla 5 — Lo nativo se inserta, no se simula.** GPS en segundo plano, notificación de turno
y grabación cifrada del APK no existen en Chromium: se graban una vez en emulador con
`scrcpy --record` y entran como capítulo `fuente:'video'` **con** marco de teléfono y chip,
indistinguibles del resto.

## 4. Cambios en el motor

### 4.1 Superficies y actores con dispositivo (`configurar.mjs`, `grabador.mjs`, `sesiones.mjs`)

```js
// demo.config.mjs
superficies: {
  sala:     { nombre: 'Sala de operaciones', tipo: 'escritorio', icono: 'monitor', color: '#1e3a8a' },
  apk:      { nombre: 'App del patrullero · Android', tipo: 'telefono', icono: 'phone', color: '#166534' },
  vecino:   { nombre: 'App del vecino', tipo: 'telefono', icono: 'phone', color: '#9a3412' },
},
actores: {
  operador:   { email, password, superficie: 'sala' },
  patrullero: { superficie: 'apk', sesion: false, baseURL: 'http://localhost:8072',
                dispositivo: 'Pixel 7', permisos: ['geolocation'], geolocalizacion: { latitude: -34.065, longitude: -70.727 } },
  vecina:     { sesion: false, superficie: 'vecino', dispositivo: 'Pixel 7' },
},
```

- `sesion: false` → actor anónimo o que se loguea dentro del guion: no exige email/password, `preparar` lo salta.
- `dispositivo`: nombre de `playwright.devices` → viewport, `isMobile`, `hasTouch`, `deviceScaleFactor`, `userAgent`.
  Sin dispositivo = viewport `video.ancho/alto` (comportamiento actual intacto).
- `baseURL` por actor (el APK se sirve estático desde otro puerto).
- `permisos` + `geolocalizacion` → `context.grantPermissions` / `geolocation`.
- Sin `superficies` en la config todo se comporta **exactamente** como hoy (compatibilidad = test).
- Grabación: el screencast de un actor móvil se captura a su viewport real × `deviceScaleFactor`
  acotado a 2 (nitidez en el marco).

### 4.2 Marco de teléfono y chip (`src/escenario/telefono.html`, `src/marco-telefono.mjs`, `src/chip.mjs`)
Mismo patrón que `marco.mjs`: HTML renderizado en Chromium → PNG con alfa. El teléfono es un
bisel redondeado genérico (sin marcas comerciales) con la "pantalla" como hueco transparente de
la relación de aspecto del dispositivo; `geometria()` devuelve dónde cae la pantalla en el lienzo.
El chip es un PNG aparte (ícono SVG inline + texto, contraste ≥ 4.5:1 sobre su fondo, verificado por píxel).

### 4.3 Montaje por superficie y pantalla dividida (`montaje.mjs`)
- Cada segmento se compone al lienzo según la superficie de su actor: escritorio como hoy;
  teléfono → escala a la pantalla del marco + overlay del marco; chip encima si hay superficies.
- **Pantalla dividida:** un paso puede declarar `dividir: ['vecina', 'operador']` (hasta el paso
  que declare `dividir: null`). En ese tramo el lienzo muestra **dos** pistas a la vez, cada una
  en su marco, lado a lado, tomadas del mismo intervalo global (las pistas por actor ya son
  continuas: `pista-<actor>.mp4` con `tGlobal`). La narración sigue siendo una sola.
- Sin `dividir` ni superficies → salida byte a byte equivalente en dimensiones/duración a la actual (test).

### 4.4 Tarjeta de superficies (`src/mapa-superficies.mjs`, `src/escenario/superficies.html`)
Render en navegador → clip MP4 corto (reusa `render-web.mjs`): nodos = superficies (ícono,
nombre, quién la usa), flechas = `config.flujo` (lista de pares `[desde, hasta]`), resalta
`activa`, atenúa `anterior`. `curso.mjs` la inserta antes de cada capítulo que declare
`superficie` (y en el capítulo `{ tipo: 'mapa' }` a pantalla completa, sin resaltar).
Respeta la duración configurable (`presentacion.mapaMs`, defecto 2500).

### 4.5 Audio (`montaje.mjs`, `grabador.mjs`, `camara.mjs`)
- `audio.musica: { archivo, volumen: 0.12, atenuar: true }` — pista en bucle bajo todo el
  video; con `atenuar`, `sidechaincompress` usando la voz como llave. Sin archivo = sin música.
  **El motor no trae música** (licencias): el proyecto pone la suya.
- `audio.clic: { activo: false, volumen: 0.5 }` — `pulsar()` registra el instante del clic
  en la línea de tiempo; el montaje mezcla un clic corto **sintetizado con lavfi** (sin asset).
- La mezcla pasa a **estéreo 48 kHz** (hoy mono 22,05/44,1); `loudnorm` se mantiene al final.

### 4.6 Motores de voz (`src/voz/pocket.mjs`, `src/voz/chatterbox.mjs`)
- **pocket** (Kyutai, código MIT, pesos CC-BY-4.0 → atribución en créditos): Python
  `TTSModel.load_model(language='spanish'|'spanish_24l')`, voz por nombre predefinido o `.wav`.
  No tiene velocidad → `crearMotorProceso` gana un hook `despues(destino)` que aplica `atempo`
  con ffmpeg-static.
- **chatterbox** (MIT, marca de agua Perth): `ChatterboxMultilingualTTS.from_pretrained(device='cpu')`,
  `generate(texto, language_id='es', audio_prompt_path=voz)`. **Exige** `voz` = ruta a un `.wav`
  de referencia; sin ella `disponible()` es false con motivo "falta la voz de referencia".
  El README advierte: la voz es dato biométrico, clonarla exige consentimiento escrito (Ley 21.719).
- `herramientas/instalar-voces.sh --pocket` / `--chatterbox` instala cada uno opcionalmente en
  su propio venv dentro de la caché (no ensucian el de Kokoro/Piper).
- Los motores reales NO se prueban en CI (como hoy): ejecutor falso + prueba opcional con `DEMO_CON_VOZ`.

### 4.7 Variantes de formato (`src/formatos.mjs`, comando `demo formatos <video> [--vertical] [--cuadrado]`)
Post-proceso del MP4 final: fondo = el mismo video escalado y desenfocado (`boxblur`), video
original centrado; conserva audio, subtítulos y capítulos. 1080×1920 y 1080×1080.

## 5. Fuera de alcance (YAGNI)
- Grabar el APK nativo automáticamente (queda como clip `scrcpy`, regla 5).
- HyperFrames (pendiente de auditar sus skills; se evalúa aparte).
- Seguimiento de cursor para recortar a vertical (se usa fondo desenfocado).
- El contenido del tutorial de seguridad-graneros (seeder `demo:preparar-contexto`, actores,
  guiones): es trabajo **en ese repo**, con su propio plan, cuando César lo pida.

## 6. Rulings (decisiones tomadas en automode)
1. Capítulos por momento del caso, no por superficie — porque la pregunta 3 del criterio de éxito
   solo se responde viendo traspasos.
2. Pantalla dividida máx. 2 pistas — 3 no se lee en 1920×1080 con un teléfono al lado.
3. Pocket como candidato principal de voz (sin clonación obligatoria, CPU de 2 núcleos); Chatterbox
   solo si hay una voz con consentimiento. La elección final es una **prueba a ciegas** de César.
4. Sin dependencias npm nuevas: todo con ffmpeg-static, Playwright y Chromium ya presentes.
   Los motores Python son opcionales y viven en la caché del usuario.
5. Compatibilidad estricta: una config sin claves nuevas produce el mismo video que v1.13.0.

## 7. Pruebas
- Unitarias por módulo (config, dispositivos, geometría de marcos, filtros ffmpeg, formatos).
- Por píxel (lección de la presentación 3D): marco de teléfono sin deformar, chip con contraste,
  pantalla dividida con ambos lados con contenido, fondo del vertical desenfocado.
- Extremo a extremo contra el servidor de juguete: un curso con un actor de escritorio, uno móvil,
  un tramo dividido, tarjeta de superficies y clic sonoro.
- `npm test` completo en verde en cada tarea; CI serializado como hoy.
