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

/**
 * Inyecta el div opaco en el documento actual (si no está ya puesto).
 *
 * Cuando esto corre como `addInitScript`, se ejecuta apenas se crea el documento nuevo:
 * en ese instante `document.documentElement` todavía puede ser `null` (el parser HTML ni
 * siquiera creó el `<html>` todavía). Colgar el div de un `documentElement` que no existe
 * lanzaría en silencio (init scripts no propagan su error a Playwright) y el cubridor
 * jamás se pondría. Por eso se espera, con un `MutationObserver` sobre `document`, a que
 * `documentElement` exista antes de colgar el div — apenas exista, antes de que el parser
 * siga agregando el resto del body.
 */
function ponerCubridor() {
    const crear = () => {
        if (document.getElementById('__cubridor')) return;
        const el = document.createElement('div');
        el.id = '__cubridor';
        el.style.cssText = `position:fixed;inset:0;background:#0f172a;z-index:2147483647;
            pointer-events:none;display:flex;align-items:center;justify-content:center;
            color:#94a3b8;font-family:system-ui;font-size:18px`;
        el.textContent = 'Filtrando…';
        document.documentElement.appendChild(el);
    };
    if (document.documentElement) { crear(); return; }
    const obs = new MutationObserver(() => {
        if (document.documentElement) { obs.disconnect(); crear(); }
    });
    obs.observe(document, { childList: true });
}

/**
 * Quita el div opaco del documento actual, si está puesto.
 *
 * Espera a `documentElement` con el MISMO mecanismo que `ponerCubridor`: si un `cubrir()`
 * y un `descubrir()` quedan ambos registrados como initScript para la próxima navegación
 * (por ejemplo, alguien llamó cubrir() y después descubrir() sobre la misma page antes de
 * navegar), sus dos `MutationObserver` —creados en ese orden— se notifican en el MISMO
 * orden en que se registraron: la puesta corre antes que el quite, y el resultado neto es
 * el correcto (destapado). Si `quitarCubridor` actuara de inmediato en vez de esperar,
 * podría no encontrar nada que quitar (el div de `ponerCubridor` recién se agregaría
 * después) y el cubridor quedaría puesto por error.
 */
function quitarCubridor() {
    const quitar = () => document.getElementById('__cubridor')?.remove();
    if (document.documentElement) { quitar(); return; }
    const obs = new MutationObserver(() => {
        if (document.documentElement) { obs.disconnect(); quitar(); }
    });
    obs.observe(document, { childList: true });
}

/**
 * Tapa la página con un panel opaco. No bloquea a Playwright: escribe por debajo.
 *
 * Sobrevive a navegaciones: además de tapar el documento actual, registra un
 * `addInitScript` que vuelve a poner el div en CADA documento nuevo que cargue esta page,
 * ANTES de que corra cualquier script propio de la página (Playwright lo garantiza: los
 * init scripts corren apenas se crea el documento, antes de pintar nada). Por eso hay que
 * llamar a `cubrir(page)` ANTES de `page.goto()`, no después: así el cubridor ya está
 * armado cuando el documento nuevo empieza a existir, y no hay ventana sin tapar.
 *
 * `descubrir(page)` registra el gesto contrario de la misma forma, así que una secuencia
 * cubrir→descubrir→cubrir dentro de la vida de la misma `page` termina, en cada navegación
 * futura, aplicando esos gestos EN ORDEN (poner, quitar, poner…): el resultado neto es
 * siempre el de la última llamada, porque ambas operaciones son idempotentes.
 */
export async function cubrir(page) {
    await page.evaluate(ponerCubridor);
    await page.addInitScript(ponerCubridor);
}

/** Destapa la página actual y desarma la protección para navegaciones futuras. */
export async function descubrir(page) {
    await page.evaluate(quitarCubridor);
    await page.addInitScript(quitarCubridor);
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
    // Se cubre ANTES de navegar: el `addInitScript` que arma cubrir() queda registrado
    // desde antes de que exista el documento nuevo, así que lo tapa desde su primer
    // instante. Cubrir después de goto() (como estaba antes) deja una ventana entre que el
    // documento nuevo pinta y que se le pone el cubridor encima.
    await cubrir(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
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
    // No hace falta reponer el cubridor a mano: sobrevive solo a la navegación (ver cubrir()).
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
