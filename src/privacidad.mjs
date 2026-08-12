/**
 * El video se muestra fuera del municipio: no puede contener datos de personas reales
 * (Ley 19.628 / 21.719). Este módulo es el que lo garantiza.
 */

/**
 * Aborta si hay cualquier señal de que esto no es un entorno de desarrollo.
 *
 * Falla CERRADO a propósito. `APP_ENV` casi nunca está en el entorno del proceso Node —lo
 * lee PHP de su .env, no nosotros—, así que confiar en su ausencia sería permitir grabar
 * contra producción por omisión. Por eso la señal principal es el HOST de baseURL, que el
 * motor sí conoce siempre: solo se graba contra la máquina propia o la red privada.
 *
 * @param {string} baseURL destino de la grabación
 * @param {NodeJS.ProcessEnv} [env]
 */
export function exigirEntornoDeDesarrollo(baseURL, env = process.env) {
    if (env.DEMO_FORZAR === '1') return;

    if (env.APP_ENV && !['local', 'testing', 'development'].includes(env.APP_ENV)) {
        throw new Error(`APP_ENV="${env.APP_ENV}" no es un entorno de desarrollo; grabar ahí expondría datos reales (usa DEMO_FORZAR=1 si sabes lo que haces)`);
    }

    let host;
    try {
        host = new URL(baseURL).hostname;
    } catch {
        throw new Error(`baseURL inválida para decidir si el entorno es seguro: "${baseURL}"`);
    }

    const local = host === 'localhost' || host === '::1' || host.endsWith('.lan') ||
        host.endsWith('.local') || host.endsWith('.test') ||
        /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host);

    if (!local) {
        throw new Error(`"${host}" no es una dirección local ni de red privada: grabar ahí expondría datos reales (usa DEMO_FORZAR=1 si sabes lo que haces)`);
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
export async function abrirFiltrado(page, url, { filtro, valor, selectorFilas, alPintar, esperaMs = 5000 }) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await cubrir(page);
    if (alPintar) await alPintar();

    await page.fill(filtro, valor);
    // `waitForLoadState` por sí solo puede resolver con el documento VIEJO y devolver el
    // control antes de que la navegación ocurra. Se espera la navegación explícitamente, y
    // si el filtro no navega (paneles tipo Livewire, que filtran en el mismo documento) se
    // sigue de largo sin fallar.
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
        page.keyboard.press('Enter'),
    ]);
    await cubrir(page);              // una navegación se lleva el cubridor: se repone antes de mirar
    if (alPintar) await alPintar();

    // El filtro puede tardar en aplicarse (Livewire pinta la tabla completa y recién
    // después la reduce). Se espera a que el conteo llegue a una fila Y SE QUEDE ahí: mirar
    // una sola vez dejaría pasar el instante en que todavía no filtró, o el repintado que
    // vuelve a traer filas justo después de la comprobación.
    const cuenta = () => page.locator(selectorFilas).count();
    const limite = Date.now() + esperaMs;
    let estable = 0;
    while (Date.now() < limite && estable < 3) {
        estable = (await cuenta()) === 1 ? estable + 1 : 0;
        await page.waitForTimeout(150);
    }
    if (estable < 3) {
        throw new Error(`el filtro no redujo la tabla a una fila estable (quedaron ${await cuenta()}): no se graba`);
    }

    await descubrir(page);
    if (alPintar) await alPintar();

    // Última comprobación DESPUÉS de destapar: si algo repintó la tabla en ese instante,
    // se vuelve a tapar y se falla, en vez de dejar datos a la vista en los frames.
    if ((await cuenta()) !== 1) {
        await cubrir(page);
        throw new Error('la tabla volvió a mostrar más de una fila justo al destapar: no se graba');
    }
}
