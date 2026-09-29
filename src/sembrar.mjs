import { execSync, spawn } from 'node:child_process';
import { ErrorConfig } from './configurar.mjs';

/**
 * El comando de siembra para un contexto dado, o null si no hay siembra.
 *
 * `config.sembrar` puede ser un string fijo (como siempre) o una función
 * `({ escena, guion }) => string`. La función existe por la demo en vivo: cada capítulo
 * declara su escena (`export const escena`) y NO es monótona (c03 `apertura`, c05 `inicio`,
 * c07 `asignado`, c09 otra vez `inicio`), así que en una misma corrida hay que sembrar
 * distinto antes de cada capítulo. Con un string calculado al cargar la config
 * (`process.env.DEMO_ESCENA`) eso no se puede: la config se importa una sola vez.
 *
 * `grabar`/`curso`/`preparar` la llaman SIN escena (`{}`): la función decide su propio
 * defecto, que es lo que ya hacía el string. Así un sistema puede pasar a la forma función
 * sin que cambie ninguna grabación.
 */
export function comandoDeSembrado(config, contexto = {}) {
    const { sembrar } = config;
    if (sembrar == null || sembrar === false || sembrar === '') return null;
    const comando = typeof sembrar === 'function' ? sembrar(contexto) : sembrar;
    if (comando == null || comando === '') return null;
    if (typeof comando !== 'string') {
        throw new ErrorConfig(`demo.config.mjs: sembrar debe ser un string o una función que devuelva un string (devolvió ${typeof comando})`);
    }
    return comando;
}

/** Siembra en el acto, bloqueando: lo de siempre para grabar/curso/preparar. */
export function sembrarSincronico(config, contexto = {}) {
    const comando = comandoDeSembrado(config, contexto);
    if (comando) execSync(comando, { stdio: 'inherit' });
    return comando;
}

/**
 * Siembra sin bloquear el proceso. La demo en vivo la necesita así: la siembra de un sistema
 * real tarda decenas de segundos (docker exec + sesiones) y, con `execSync`, la consola del
 * presentador —un servidor HTTP en este mismo proceso— dejaría de responder mientras tanto.
 *
 * @param {(linea: string) => void} [alEscribir] recibe la salida del comando, línea a línea
 * @returns {Promise<string|null>} el comando que corrió
 */
export function sembrarEnSegundoPlano(config, contexto = {}, { alEscribir = null } = {}) {
    const comando = comandoDeSembrado(config, contexto);
    if (!comando) return Promise.resolve(null);
    return new Promise((resolver, rechazar) => {
        const hijo = spawn(comando, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const pasar = (flujo, destino) => flujo.on('data', (d) => {
            destino.write(d);
            if (alEscribir) for (const linea of String(d).split('\n')) if (linea.trim()) alEscribir(linea);
        });
        pasar(hijo.stdout, process.stdout);
        pasar(hijo.stderr, process.stderr);
        hijo.on('error', rechazar);
        hijo.on('close', (codigo) => (codigo === 0
            ? resolver(comando)
            : rechazar(new Error(`la siembra terminó con código ${codigo}: ${comando}`))));
    });
}
