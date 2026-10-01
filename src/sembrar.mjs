import { execSync, spawn } from 'node:child_process';
import { ErrorConfig } from './configurar.mjs';

/**
 * El comando de siembra para un contexto dado, o null si no hay comando que correr.
 *
 * `config.sembrar` puede ser:
 * - un string fijo (como siempre): el comando de shell;
 * - una función `({ escena, guion }) => string | null | Promise<string | null>`. Existe por la
 *   demo en vivo: cada capítulo declara su escena (`export const escena`) y NO es monótona
 *   (c03 `apertura`, c05 `inicio`, c07 `asignado`, c09 otra vez `inicio`), así que en una
 *   misma corrida hay que sembrar distinto antes de cada capítulo. Con un string calculado al
 *   cargar la config (`process.env.DEMO_ESCENA`) eso no se puede: la config se importa una vez.
 *   La función puede ser async y puede sembrar por su cuenta: si devuelve (o resuelve a)
 *   `null`/`undefined`, el motor la espera y no ejecuta nada más.
 *
 * `grabar`/`curso`/`preparar` la llaman SIN escena (`{}`): la función decide su propio
 * defecto, que es lo que ya hacía el string. Así un sistema puede pasar a la forma función
 * sin que cambie ninguna grabación.
 *
 * @returns {Promise<string|null>}
 */
export async function comandoDeSembrado(config, contexto = {}) {
    const { sembrar: definicion } = config;
    if (definicion == null || definicion === false || definicion === '') return null;
    const comando = typeof definicion === 'function' ? await definicion(contexto) : definicion;
    if (comando == null || comando === '') return null;
    if (typeof comando !== 'string') {
        throw new ErrorConfig(`demo.config.mjs: sembrar debe ser un string o una función que devuelva un string o nada (devolvió ${typeof comando})`);
    }
    return comando;
}

/**
 * Siembra y espera a que termine: lo de siempre para grabar/curso/preparar. El comando corre
 * con `execSync` (salida heredada), igual que antes de aceptar funciones.
 *
 * @returns {Promise<string|null>} el comando que corrió, o null
 */
export async function sembrar(config, contexto = {}) {
    const comando = await comandoDeSembrado(config, contexto);
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
export async function sembrarEnSegundoPlano(config, contexto = {}, { alEscribir = null } = {}) {
    const comando = await comandoDeSembrado(config, contexto);
    if (!comando) return null;
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
