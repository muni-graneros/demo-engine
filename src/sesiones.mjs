import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { exigirEntornoDeDesarrollo } from './privacidad.mjs';

/** Decodifica base32 (RFC 4648) sin dependencias. */
function base32ABuffer(secreto) {
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of secreto.replace(/=+$/, '').toUpperCase()) {
        const i = alfabeto.indexOf(c);
        if (i === -1) continue;
        bits += i.toString(2).padStart(5, '0');
    }
    const bytes = bits.match(/.{8}/g) ?? [];
    return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

/**
 * Código TOTP de 6 dígitos (RFC 6238, SHA-1, ventana de 30 s).
 * @param {string} secreto en base32
 * @param {number} [segundos] instante; por defecto, ahora
 */
export function totp(secreto, segundos = Math.floor(Date.now() / 1000)) {
    const contador = Buffer.alloc(8);
    contador.writeBigUInt64BE(BigInt(Math.floor(segundos / 30)));
    const hmac = createHmac('sha1', base32ABuffer(secreto)).update(contador).digest();
    const desplazamiento = hmac[hmac.length - 1] & 0x0f;
    const binario = hmac.readUInt32BE(desplazamiento) & 0x7fffffff;
    return String(binario % 1_000_000).padStart(6, '0');
}

/**
 * Loguea a cada actor y guarda su sesión en disco.
 * @returns {Promise<Record<string,string>>} actor → ruta del storageState
 */
/**
 * Hace click en el botón de envío del login y espera a que la URL cambie. El login de
 * Filament/Livewire NO navega con el click: resuelve por una request de fondo y redirige
 * por JS un instante después, así que `waitForLoadState('domcontentloaded')` retorna antes
 * del salto y el chequeo de sesión corría estando todavía en /login. Esperar el cambio de
 * URL cubre por igual el redirect de servidor (navegación normal) y el diferido por JS; si
 * el login falla y nada cambia, cae por timeout y el chequeo posterior lo reporta.
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
async function enviarYEsperarSalida(page, selector) {
    const urlAntes = page.url();
    await page.click(selector);
    await page.waitForFunction((u) => location.href !== u, urlAntes, { timeout: 8000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
}

export async function prepararSesiones(config, { dirSesiones }) {
    // Antes de nada: esto loguea con credenciales reales y persiste cookies de sesión a
    // disco. Solo `grabar()` pasaba por este guardián; una baseURL mal puesta acá loguearía
    // contra producción y dejaría la sesión real guardada antes de que nada aborte.
    exigirEntornoDeDesarrollo(config.baseURL);

    mkdirSync(dirSesiones, { recursive: true });
    const loginGlobal = config.login ?? {};
    const navegador = await chromium.launch();
    const sesiones = {};

    try {
        for (const [actor, datos] of Object.entries(config.actores)) {
            // Cada actor puede traer su propio bloque `login`, fusionado SOBRE el global: el
            // sistema real tiene dos superficies de autenticación (panel de personal vs.
            // portal del ciudadano), y un único `login` en la config obligaría a elegir una
            // y dejaría a los actores de la otra sin forma de entrar.
            const login = { ...loginGlobal, ...(datos.login ?? {}) };

            const ctx = await navegador.newContext({ baseURL: config.baseURL });
            const page = await ctx.newPage();
            await page.goto(login.url ?? '/');
            await page.fill(login.usuario ?? 'input[name=email]', datos.email);
            await page.fill(login.clave ?? 'input[type=password]', datos.password);
            await enviarYEsperarSalida(page, login.enviar ?? 'button[type=submit]');

            if (datos.totp) {
                const campo = login.codigo ?? 'input[name=code]';
                if (await page.locator(campo).count()) {
                    await page.fill(campo, totp(datos.totp));
                    await enviarYEsperarSalida(page, login.enviar ?? 'button[type=submit]');
                }
            }

            if (login.comprobar) {
                const entro = await page.locator(login.comprobar).count();
                if (!entro) {
                    throw new Error(`el actor "${actor}" no logró entrar: no apareció ${login.comprobar}`);
                }
            } else {
                // Sin selector de comprobación, igual verificamos algo objetivo en vez de dar
                // por bueno cualquier resultado: que quedaron cookies de sesión, y que ya no
                // estamos en la pantalla de login. Sin esto, un login que en realidad falló
                // (credenciales malas, formulario que no reaccionó) pasaba en silencio y el
                // defecto se manifestaba mucho después, como un video que empieza en el login.
                const urlLogin = new URL(login.url ?? '/', config.baseURL).href;
                const cookies = await ctx.cookies();
                if (cookies.length === 0 || page.url() === urlLogin) {
                    await ctx.close();
                    throw new Error(`el actor "${actor}" no logró entrar: sigue sin cookies de sesión o sigue en la pantalla de login (${page.url()})`);
                }
            }

            const archivo = join(dirSesiones, `${actor}.json`);
            await ctx.storageState({ path: archivo });
            sesiones[actor] = archivo;
            await ctx.close();
        }
    } finally {
        await navegador.close();
    }

    return sesiones;
}

/**
 * Comprueba si un `storageState` guardado en disco TODAVÍA sirve para entrar.
 *
 * Reutiliza el mismo criterio que ya usa `prepararSesiones` para validar un login recién
 * hecho —con `login.comprobar`, que exista ese selector; sin él, que queden cookies y que no
 * se esté en la URL de login— pero aplicado a una sesión vieja en vez de a una recién creada:
 * se navega a `login.url` cargando ese `storageState` y se mira dónde se cae. Un sistema real
 * (o el juguete de pruebas) manda lejos del login a quien ya tiene sesión viva; a quien no,
 * lo deja ahí o lo rebota de vuelta.
 *
 * @param {string} archivo ruta al storageState guardado
 * @param {object} config con `baseURL`
 * @param {object} login bloque de login YA fusionado (global + del actor)
 * @returns {Promise<boolean>}
 */
export async function sesionSigueViva(archivo, config, login = {}) {
    // Mismo guardián que prepararSesiones (commit 6d4dfec): esto navega con cookies de
    // sesión reales contra config.baseURL. Esta función se agregó DESPUÉS de aquel arreglo y
    // quedó fuera — sin esto, una baseURL mal puesta abría un navegador real y navegaba hacia
    // ese host antes de que nada abortara.
    exigirEntornoDeDesarrollo(config.baseURL);

    const navegador = await chromium.launch();
    try {
        const ctx = await navegador.newContext({ baseURL: config.baseURL, storageState: archivo });
        try {
            const page = await ctx.newPage();
            const urlLogin = new URL(login.url ?? '/', config.baseURL).href;
            await page.goto(login.url ?? '/');
            await page.waitForLoadState('domcontentloaded');

            if (login.comprobar) {
                return Boolean(await page.locator(login.comprobar).count());
            }
            const cookies = await ctx.cookies();
            return cookies.length > 0 && page.url() !== urlLogin;
        } finally {
            await ctx.close();
        }
    } finally {
        await navegador.close();
    }
}

/** Actores que un guion usa de verdad, recorriendo sus escenas y pasos. */
export function actoresDeGuion(guion) {
    const actores = new Set();
    for (const escena of guion.escenas ?? []) {
        for (const paso of escena.pasos ?? []) {
            actores.add(paso.actor);
        }
    }
    return [...actores];
}

/**
 * Prepara sesiones para grabar UN guion en concreto: reutiliza los `storageState` que ya
 * estén en disco y solo loguea a los actores que el guion usa y que todavía no tienen
 * sesión guardada.
 *
 * Este es el camino que usan `grabar`/`curso`/`manual` desde el CLI. Relogear a los cuatro
 * actores de la config (dos de ellos con MFA) para grabar un guion que usa uno solo es caro
 * y no aporta nada; con un sistema real esa relogueada de más fue buena parte de los 45
 * segundos que tardó una grabación de 29 segundos de video.
 *
 * `preparar` (el comando del CLI) sigue llamando a `prepararSesiones` directo con TODOS los
 * actores de la config: su trabajo es justamente dejar lista la sesión de todo el mundo de
 * una vez, por adelantado.
 */
export async function prepararSesionesParaGuion(guion, config, { dirSesiones }) {
    const necesarios = actoresDeGuion(guion);
    const loginGlobal = config.login ?? {};
    const sesiones = {};
    const faltantes = [];

    for (const actor of necesarios) {
        const archivo = join(dirSesiones, `${actor}.json`);
        // No basta con que el archivo EXISTA: la sesión pudo haber caducado del lado del
        // servidor entre una grabación y la siguiente (pasa de verdad). Reutilizarla a
        // ciegas hace que el fallo aparezca a mitad de la grabación siguiente, confuso, en
        // vez de acá, claro y resuelto solo con un relogueo transparente.
        const login = { ...loginGlobal, ...(config.actores?.[actor]?.login ?? {}) };
        if (existsSync(archivo) && await sesionSigueViva(archivo, config, login)) {
            sesiones[actor] = archivo;
        } else {
            faltantes.push(actor);
        }
    }

    // Un actor que el guion usa pero que no está en la config: no lo preparamos acá (no hay
    // con qué loguearlo). `grabar()` es quien falla con un mensaje claro al llegar a ese paso.
    const porLoguear = faltantes.filter((actor) => config.actores?.[actor]);
    if (porLoguear.length) {
        const actoresFiltrados = Object.fromEntries(
            porLoguear.map((actor) => [actor, config.actores[actor]]));
        const nuevas = await prepararSesiones({ ...config, actores: actoresFiltrados }, { dirSesiones });
        Object.assign(sesiones, nuevas);
    }

    return sesiones;
}
