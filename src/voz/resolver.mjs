import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Directorio del PAQUETE demo-engine (no el cwd del consumidor). Hasta que los modelos se
// mudaron a la caché del usuario, `herramientas/instalar-voces.sh` los dejaba acá, y hay
// que ubicarlo desde la URL del módulo para que funcione sin importar desde qué proyecto se
// invoque el CLI.
const RAIZ_PAQUETE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Raíz de la caché del usuario donde `instalar-voces.sh` deja hoy el venv y los modelos.
 *
 * Se calcula en cada llamada, no una vez al importar el módulo: si se congelara, cambiar
 * HOME o XDG_CACHE_HOME dentro del proceso (las pruebas, un runner que reescribe el
 * entorno) dejaría al resolver mirando una casa que ya no es la del usuario.
 */
function raizCache() {
    const base = process.env.XDG_CACHE_HOME;
    return base ? resolve(base, 'demo-engine') : resolve(homedir(), '.cache', 'demo-engine');
}

function resolverUno(deConfig, envVar, nombreClasico, nombreEnCache, raizPaquete) {
    if (deConfig) return resolve(deConfig);
    if (process.env[envVar]) return resolve(process.env[envVar]);

    // El paquete va ANTES que la caché a propósito: una máquina que ya tenía los ~670 MB
    // instalados dentro del repo sigue funcionando igual después de cambiar el destino por
    // omisión del instalador. Migrar esa instalación es una decisión del dueño de la
    // máquina, no un efecto colateral de actualizar el motor.
    const enPaquete = resolve(raizPaquete, nombreClasico);
    if (existsSync(enPaquete)) return enPaquete;

    const enCache = resolve(raizCache(), nombreEnCache);
    if (existsSync(enCache)) return enCache;

    return resolve(process.cwd(), nombreClasico);
}

/**
 * Resuelve dónde están el venv de Python y los modelos de voz, en este orden:
 *   1. lo que declare `demo.config.mjs` (`voz.venv` / `voz.voces`)
 *   2. las variables de entorno `DEMO_VENV` / `DEMO_VOCES`
 *   3. el directorio del propio paquete (donde los dejaban las instalaciones viejas)
 *   4. `~/.cache/demo-engine/{venv,voces}` — el destino actual de `instalar-voces.sh`,
 *      respetando `XDG_CACHE_HOME`
 *   5. el cwd del proceso, como último recurso
 *
 * Antes esto se resolvía siempre contra `process.cwd()`: cuando otro sistema instala
 * demo-engine como dependencia, ese cwd es la raíz del sistema CONSUMIDOR, no la del
 * paquete — así que `disponible()` daba `false` aunque los modelos existieran a un `cd ..`
 * de distancia, y el motor degradaba a subtítulos-sin-voz EN SILENCIO. Le costó un curso
 * entero mudo antes de notarse. El paso 4 existe por lo mismo: el instalador dejó de
 * escribir dentro del repo, y sin este paso una instalación nueva reproducía ese bug.
 *
 * `raizPaquete` es un punto de inyección para las pruebas: permite simular un paquete sin
 * modelos instalados sin tocar los que la máquina de desarrollo ya tiene en disco.
 */
export function resolverVenvYVoces({ venv, voces } = {}, { raizPaquete = RAIZ_PAQUETE } = {}) {
    return {
        venv: resolverUno(venv, 'DEMO_VENV', '.venv', 'venv', raizPaquete),
        voces: resolverUno(voces, 'DEMO_VOCES', '.voces', 'voces', raizPaquete),
    };
}

export const RUTA_PAQUETE = RAIZ_PAQUETE;
export const RUTA_CACHE = raizCache;
