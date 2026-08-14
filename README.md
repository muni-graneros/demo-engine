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

Antes de grabar, instala los motores de voz que usarás (se guardan en `~/.demo-engine/`):

```bash
# Kokoro (español fluido, recomendado)
npm exec -- demo-engine-voice kokoro es_ES

# Piper (respaldo, más lento pero sin dependencias)
npm exec -- demo-engine-voice piper es_ES
```

Sin una voz instalada, el motor genera subtítulos sin locución (no falla).

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
  voz: {
    motor: 'kokoro',            // Motor principal: 'kokoro' | 'piper' (defecto: kokoro)
    voz: 'es_ES',               // Código de idioma/voz (defecto: es_ES)
    respaldo: 'piper'           // Si motor no está disponible (defecto: piper)
  },

  // Comandos shell (opcionales).
  sembrar: 'npm run seed',      // Antes de grabar (resetea BD, etc.)
  limpiar: 'npm run clean'      // Después de todo
};
```

Valores por defecto: video `1600x1000`, `pausaMinima 1200ms`, voz Kokoro español con Piper de respaldo, login en URL raíz con selectores estándar.

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

## CLI: cuatro comandos

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

## Privacidad: `abrirFiltrado`

El motor protege datos sensibles **durante la grabación** tapando la pantalla desde el primer frame hasta que los datos estén filtrados. Esto es crítico porque muchas aplicaciones (Filament, Livewire, etc.) pintan **la tabla completa** y luego la filtran con JavaScript — esa ventana es la fuga que el motor debe bloquear.

### Invariante de privacidad

**Jamás se graba un dato sensible sin filtro.** Dos niveles de protección:

1. **Verificación de host:** `exigirEntornoDeDesarrollo(config.baseURL)` falla si no es `localhost`, `127.0.0.1`, o red privada.
2. **Pantalla tapada hasta filtrado:** `abrirFiltrado` cubre la pantalla, abre la URL, filtra por un criterio, espera a que la tabla se reduzca a una fila, y solo entonces destapa.

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
- `pegarCapitulos(partes, { salida, nombre, titulo, video }) → Promise<{mp4, md}>`
  - `partes`: array de `{id, titulo, archivo}`

### Salida
- `generarManual({ guion, pasos, marca }, { salida }) → Promise<{pdf}>`

### Voz
- `crearVoz(config: {motor?, voz?, respaldo?}) → vozEngine`
  - `.disponible() → bool`
  - `.sintetizar(texto) → rutaWav | null`

### Privacidad
- `exigirEntornoDeDesarrollo(baseURL, env?) → void` (falla si no es dev)
- `cubrir(page) → Promise<void>` (cubre toda la pantalla con panel opaco)
- `descubrir(page) → Promise<void>` (destapa la pantalla)
- `abrirFiltrado(page, url, { filtro, valor, selectorFilas, alPintar?, esperaMs? }) → Promise<void>`

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

1. **Offline**: sin llamadas de red en tiempo de ejecución.
2. **Privacidad**: jamás registra datos de sistemas reales. Solo `localhost`, `127.0.0.1`, red privada (10.x, 192.168.x, etc.).
3. **Subtítulos**: pista `mov_text` dentro del MP4 + sidecar `.vtt`.
4. **Reproducibilidad**: mismo guion + misma config = mismo MP4.
