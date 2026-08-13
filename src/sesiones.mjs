import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
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
export async function prepararSesiones(config, { dirSesiones }) {
    // Antes de nada: esto loguea con credenciales reales y persiste cookies de sesión a
    // disco. Solo `grabar()` pasaba por este guardián; una baseURL mal puesta acá loguearía
    // contra producción y dejaría la sesión real guardada antes de que nada aborte.
    exigirEntornoDeDesarrollo(config.baseURL);

    mkdirSync(dirSesiones, { recursive: true });
    const login = config.login ?? {};
    const navegador = await chromium.launch();
    const sesiones = {};

    try {
        for (const [actor, datos] of Object.entries(config.actores)) {
            const ctx = await navegador.newContext({ baseURL: config.baseURL });
            const page = await ctx.newPage();
            await page.goto(login.url ?? '/');
            await page.fill(login.usuario ?? 'input[name=email]', datos.email);
            await page.fill(login.clave ?? 'input[type=password]', datos.password);
            await page.click(login.enviar ?? 'button[type=submit]');
            await page.waitForLoadState('domcontentloaded');

            if (datos.totp) {
                const campo = login.codigo ?? 'input[name=code]';
                if (await page.locator(campo).count()) {
                    await page.fill(campo, totp(datos.totp));
                    await page.click(login.enviar ?? 'button[type=submit]');
                    await page.waitForLoadState('domcontentloaded');
                }
            }

            if (login.comprobar) {
                const entro = await page.locator(login.comprobar).count();
                if (!entro) {
                    throw new Error(`el actor "${actor}" no logró entrar: no apareció ${login.comprobar}`);
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
