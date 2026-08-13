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

Requisitos:
- **Node ≥ 20** (ESM puro, sin TypeScript)
- **ffmpeg 7.0+** (suministrado por `ffmpeg-static`)
- **Chromium** (descargado por Playwright)

Las voces se descargan bajo demanda la primera vez y se guardan en `~/.demo-engine/`:

```bash
# Kokoro (español fluido, recomendado)
npm exec -- demo-engine-voice kokoro es_ES

# Piper (respaldo, más lento pero sin dependencias)
npm exec -- demo-engine-voice piper es_ES
```

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

  // Login automático: selectores CSS para campos y botón.
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
      password: 'otro123'
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
- `hacer` recibe un objeto Playwright `Page` listo para navegar.
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

- Genera PDF a partir de un guion grabado (defecto: `curso`).
- Incluye capturas de cada escena, subtítulos como texto.
- Emite: `docs/manual/[guion].pdf`.

## Privacidad: `abrirFiltrado`

El motor protege datos sensibles **durante la grabación**:

```js
import { abrirFiltrado, cubrir, descubrir, exigirEntornoDeDesarrollo } from 'demo-engine';

// Antes de grabar, verifica que estamos en desarrollo (localhost).
exigirEntornoDeDesarrollo(config.baseURL);  // Falla si es prod

// Durante un paso, cubre un elemento hasta que se filtre:
{
  hacer: async (page) => {
    await cubrir(page, '#rut-del-ciudadano');  // Pantalla cubierta
    await page.goto('/panel');                 // Se graba todo negro
    await descubrir(page, '#rut-del-ciudadano'); // Ahora se ve
  }
}

// O usa abrirFiltrado para un bloque completo:
{
  hacer: async (page) => {
    await abrirFiltrado(page, '#datos-sensibles', async () => {
      await page.goto('/detalles');
      await page.click('button');
    });
  }
}
```

Invariante: **jamás se graba un dato sensible sin filtro**. Si intentas grabar contra un servidor que no sea `localhost` o `127.0.0.1`, el motor aborta con error.

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

## Invariantes

1. **Offline**: sin llamadas de red en tiempo de ejecución.
2. **Privacidad**: jamás registra datos de sistemas reales. Solo `localhost` / `127.0.0.1`.
3. **Subtítulos**: pista `mov_text` dentro del MP4 + sidecar `.vtt`.
4. **Reproducibilidad**: mismo guion + misma config = mismo MP4.
