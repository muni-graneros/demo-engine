/**
 * El video se muestra fuera del municipio: no puede contener datos de personas reales
 * (Ley 19.628 / 21.719). Este módulo es el que lo garantiza.
 */

/** Aborta si no estamos en un entorno de desarrollo. `DEMO_FORZAR=1` lo salta a propósito. */
export function exigirEntornoDeDesarrollo(env = process.env) {
    if (env.DEMO_FORZAR === '1') return;
    const entorno = env.APP_ENV ?? 'local';
    if (!['local', 'testing', 'development'].includes(entorno)) {
        throw new Error(`grabar en "${entorno}" expondría datos de producción; usa DEMO_FORZAR=1 si sabes lo que haces`);
    }
}

/** Tapa la página con un panel opaco. No bloquea a Playwright: escribe por debajo. */
export async function cubrir(page) {
    await page.evaluate(() => {
        if (document.getElementById('__cubridor')) return;
        const el = document.createElement('div');
        el.id = '__cubridor';
        el.style.cssText = `position:fixed;inset:0;background:#0f172a;z-index:2147483647;
            pointer-events:none;display:flex;align-items:center;justify-content:center;
            color:#94a3b8;font-family:system-ui;font-size:18px`;
        el.textContent = 'Filtrando…';
        document.documentElement.appendChild(el);
    });
}

export async function descubrir(page) {
    await page.evaluate(() => document.getElementById('__cubridor')?.remove());
}

/**
 * Abre una pantalla con datos SIN mostrarla hasta que quedó filtrada a una sola fila.
 * Si el filtro no reduce, lanza: mejor un hueco en el video que una fuga.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {{filtro:string, valor:string, selectorFilas:string, alPintar?:Function}} opciones
 */
export async function abrirFiltrado(page, url, { filtro, valor, selectorFilas, alPintar }) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await cubrir(page);
    if (alPintar) await alPintar();

    await page.fill(filtro, valor);
    // waitForLoadState no sirve aquí: si se llama después de press('Enter') puede resolver
    // de inmediato usando el estado del documento VIEJO (que ya estaba domcontentloaded desde
    // el goto), sin esperar la navegación real. Por eso se registra la espera de la navegación
    // ANTES del Enter, en paralelo.
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.keyboard.press('Enter'),
    ]);
    await cubrir(page);                // la navegación tira el cubridor: se repone antes de mirar
    if (alPintar) await alPintar();

    const filas = await page.locator(selectorFilas).count();
    if (filas !== 1) {
        throw new Error(`el filtro no redujo la tabla a una fila (quedaron ${filas}): no se graba`);
    }

    await descubrir(page);
    if (alPintar) await alPintar();
}
