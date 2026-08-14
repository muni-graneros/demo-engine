import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Directorio del PAQUETE demo-engine (no el cwd del consumidor). `herramientas/instalar-voces.sh`
// deja los modelos ahí, y hay que ubicarlo desde la URL del módulo para que funcione sin
// importar desde qué proyecto se invoque el CLI.
const RAIZ_PAQUETE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function resolverUno(deConfig, envVar, subcarpeta) {
    if (deConfig) return resolve(deConfig);
    if (process.env[envVar]) return resolve(process.env[envVar]);
    const enPaquete = resolve(RAIZ_PAQUETE, subcarpeta);
    if (existsSync(enPaquete)) return enPaquete;
    return resolve(process.cwd(), subcarpeta);
}

/**
 * Resuelve dónde están el venv de Python y los modelos de voz, en este orden:
 *   1. lo que declare `demo.config.mjs` (`voz.venv` / `voz.voces`)
 *   2. las variables de entorno `DEMO_VENV` / `DEMO_VOCES`
 *   3. el directorio del propio paquete (ahí es donde `instalar-voces.sh` los deja)
 *   4. el cwd del proceso, como último recurso
 *
 * Antes esto se resolvía siempre contra `process.cwd()`: cuando otro sistema instala
 * demo-engine como dependencia, ese cwd es la raíz del sistema CONSUMIDOR, no la del
 * paquete — así que `disponible()` daba `false` aunque los modelos existieran a un `cd ..`
 * de distancia, y el motor degradaba a subtítulos-sin-voz EN SILENCIO. Le costó un curso
 * entero mudo antes de notarse.
 */
export function resolverVenvYVoces({ venv, voces } = {}) {
    return {
        venv: resolverUno(venv, 'DEMO_VENV', '.venv'),
        voces: resolverUno(voces, 'DEMO_VOCES', '.voces'),
    };
}

export const RUTA_PAQUETE = RAIZ_PAQUETE;
