# demo-engine

Motor genérico para grabar, montar y publicar videos-tutorial de sistemas web. Ejecuta guiones en navegadores Chromium reales, captura pantalla y voz, aplica efectos de privacidad, y genera MP4 con subtítulos sin tocar ningún servidor.

## Qué es

Un sistema que automatiza la grabación de tutoriales de video para plataformas web:

- **Grabación genuina**: lanza Chromium real, navega por el sistema, simula clics y escritura.
- **Privacidad embebida**: cubre datos sensibles en pantalla hasta que se filtran.
- **Voz automática**: sintetiza locuciones sobre la pantalla sin servidor externo.
- **Montaje offline**: ffmpeg local pega videos, dibuja subtítulos, normaliza audio.
- **Genérico**: una config y un guion por sistema, sin código hardcodeado.

## Instalación

```bash
npm install demo-engine
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

Esto crea un venv de Python (`.venv`) y descarga los modelos (`.voces`) **en el directorio
donde corras el script** — normalmente eso es la raíz del paquete `demo-engine` dentro de
`node_modules` (por ejemplo si lo corrés como parte de un `postinstall`), y así es como lo
encuentra por defecto el paso 3 de abajo.

**Dónde busca los modelos el motor de voz, en orden:**
1. lo que declares en `demo.config.mjs` (`voz.venv` / `voz.voces`, ver más abajo)
2. las variables de entorno `DEMO_VENV` / `DEMO_VOCES`
3. el directorio del propio paquete `demo-engine` (donde los deja el instalador de arriba)
4. el cwd del proceso, como último recurso

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
    pausaMinima: 1200           // Milisegundos entre pasos (defecto: 1200)
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
    respaldo: 'piper',          // Si el principal no está disponible (defecto: piper)
    vozRespaldo: null,          // Voz del respaldo; si es null, el respaldo usa la suya
    venv: null,                 // Carpeta del venv de Python, opcional (ver "Instalación")
    voces: null                 // Carpeta de los modelos .onnx, opcional (ver "Instalación")
  },

  // Comandos shell (opcionales).
  sembrar: 'npm run seed',      // Antes de grabar (resetea BD, etc.)
  limpiar: 'npm run clean',     // Después de todo

  // Auditoría (opcional): verifica sobre el video ya grabado, ver "Auditoría: demo auditar".
  auditoria: {
    ocr: 'http://127.0.0.1:8110/ocr',   // Endpoint OCR. SIN DEFECTO: hay que declararlo.
    patron: '\\d{7,8}-[\\dkK]',          // Qué cuenta como identificador (defecto: RUT-like)
    cada: 10,                            // Un frame cada N segundos (defecto: 10)
    maximo: 20                           // Tope de frames por video (defecto: 20)
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
en cada `demo grabar` — auditar un video de varios minutos toma minutos, no segundos.

## Privacidad: `abrirFiltrado` y `abrirVerificado`

El motor protege datos sensibles **durante la grabación** tapando la pantalla desde el primer frame hasta que los datos están a salvo de mostrarse de más. Esto es crítico porque muchas aplicaciones (Filament, Livewire, etc.) pintan **la tabla completa** y luego la filtran con JavaScript — esa ventana es la fuga que el motor debe bloquear.

### Invariante de privacidad

**Jamás se graba un dato sensible sin protección.** Dos niveles:

1. **Verificación de host:** `exigirEntornoDeDesarrollo(config.baseURL)` falla si no es `localhost`, `127.0.0.1`, o red privada.
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
// - APP_ENV es 'production', 'staging', etc.
// - El host no es localhost ni red privada
// Solo continúa si:
// - Host es 127.x, 192.168.x, 10.x, ::1, *.local, *.lan, *.test
// - O APP_ENV es 'local', 'testing', 'development'
// - O DEMO_FORZAR=1 (pero no lo hagas en producción)
```

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
    ocr: 'http://127.0.0.1:8110/ocr',   // endpoint del servicio OCR, SIN VALOR POR DEFECTO
    patron: '\\d{7,8}-[\\dkK]',          // qué cuenta como identificador (regex, sin flags)
    cada: 10,                            // un frame cada N segundos
    maximo: 20,                          // tope de frames por video
  },
};
```

**`auditoria.ocr` no tiene valor por defecto, a propósito:** es un host al que el proceso se
conecta, y esa decisión le corresponde a quien configura el sistema, no al motor genérico —
igual que `baseURL`. El motor tampoco sabe de RUT chilenos: `patron` es un regex de config,
no lógica hardcodeada; el valor de arriba es solo un defecto razonable para RUT, totalmente
reemplazable. Sin `auditoria.ocr`, `demo auditar` falla con un mensaje que dice exactamente
qué falta (no un `ECONNREFUSED` críptico contra `null`).

El servicio OCR debe aceptar `POST` con el archivo en un campo `file` (`multipart/form-data`)
y responder `{ text: "..." }`.

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
  - `venv`/`voces` son opcionales; sin ellos, resuelve por `DEMO_VENV`/`DEMO_VOCES` y después
    por el directorio del propio paquete (ver "Instalación" para el orden completo)
  - si `motor !== 'ninguno'` y no encuentra ningún motor disponible, escribe un aviso por
    `stderr` (no lanza excepción: sigue degradando a subtítulos-sin-locución)

### Privacidad
- `exigirEntornoDeDesarrollo(baseURL, env?) → void` (falla si no es dev)
- `cubrir(page) → Promise<void>` (cubre toda la pantalla con panel opaco)
- `descubrir(page) → Promise<void>` (destapa la pantalla)
- `abrirFiltrado(page, url, { filtro, valor, selectorFilas, alPintar?, esperaMs? }) → Promise<void>`
- `abrirVerificado(page, url, comprobar, { alPintar?, preparar?, esperaMs?, estabilidadRequerida?, mensajeError? }?) → Promise<void>`
  — genérico: usa esto para pantallas sin buscador; `abrirFiltrado` se construye encima.

### Auditoría
- `auditarVideo(video, config, { dirFrames?, ocr? }?) → Promise<{total, sospechosos}>`
  — `config.auditoria`: `{ocr, patron, cada, maximo}`; `sospechosos`: `{segundo, archivo, identificadores}[]`
  — `ocr` es inyectable (para pruebas); sin él usa el endpoint real de `config.auditoria.ocr`
- `auditarCapturas(dirCapturas, config, { ocr? }?) → Promise<{total, sospechosos}>`
  — audita las capturas del manual (`config.salida/capturas`), mismo criterio que `auditarVideo`
    pero sin muestreo (una imagen por paso, se auditan todas); `sospechosos`: `{archivo, identificadores}[]`
  — sin la carpeta de capturas en disco, devuelve `{total: 0, sospechosos: []}` sin fallar
- `muestrearFrames(video, { cada, maximo, dirSalida }) → {segundo, archivo}[]` (usa ffmpeg, no ffprobe)
- `contarIdentificadores(texto, patron) → string[]` (identificadores DISTINTOS que matchean el patrón)
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
2. **Privacidad**: jamás registra datos de sistemas reales. Solo `localhost`, `127.0.0.1`, red privada (10.x, 192.168.x, etc.).
3. **Subtítulos**: pista `mov_text` dentro del MP4 + sidecar `.vtt`.
4. **Reproducibilidad**: mismo guion + misma config = mismo MP4.
5. **Genérico**: el motor no conoce RUT chilenos, puertos ni hosts concretos de ningún
   sistema consumidor — eso vive en `demo.config.mjs` (`baseURL`, `auditoria.ocr`,
   `auditoria.patron`, etc.), nunca hardcodeado.
