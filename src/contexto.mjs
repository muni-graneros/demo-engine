import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Captura el "pack de contexto" de un sistema: un screenshot por pantalla declarada, para
 * alimentar generadores de tutoriales y manuales. Es el mismo motor para CUALQUIER sistema;
 * lo que cambia es la lista `config.contexto.pantallas`.
 *
 * Cada pantalla: `{ id, url?, actor?, esperaTexto?, hacer?, completa?, esperaMs? }`.
 * - `actor`: nombre de un actor de `config.actores` (usa su sesión). Omitido/null = PÚBLICO
 *   (contexto nuevo SIN sesión): landing, login, pantallas de error.
 * - `url`: ruta relativa a `config.baseURL` a la que navegar (opcional si `hacer` ya navega).
 * - `esperaTexto`: texto que confirma que la pantalla cargó antes de capturar.
 * - `hacer(page)`: interacción antes del screenshot (llenar un campo, abrir un panel, provocar
 *   un error). Mismo idioma que los guiones.
 * - `completa`: screenshot de página entera (para listas/reportes largos). Por defecto, viewport.
 *
 * Robusto: cada pantalla va en su try/catch; una que falle no aborta el resto, queda anotada en
 * el manifiesto `pantallas.json` con su error. Devuelve `{ salida, ok, fail, manifest }`.
 *
 * PII: el aislamiento (ocultar datos reales) NO vive acá; se corre por fuera con
 * `config.contexto.aislar`/`mostrar` (ver cli.mjs), para que el motor no dependa de un sistema.
 *
 * @param {object} args
 * @param {object} args.config
 * @param {Record<string,string>} args.sesiones actor → ruta del storageState
 * @param {string} args.salida carpeta del pack (se crea `pantallas/` dentro)
 */
export async function capturarContexto({ config, sesiones, salida }) {
    const cfg = config.contexto ?? {};
    const pantallas = cfg.pantallas ?? [];
    const dir = resolve(salida, 'pantallas');
    mkdirSync(dir, { recursive: true });

    const ancho = config.video?.ancho ?? 1600;
    const alto = config.video?.alto ?? 1000;

    const navegador = await chromium.launch();
    const paginas = new Map(); // clave de actor → page (una por actor, reutilizada)

    const paginaDe = async (actor) => {
        const clave = actor ?? '__publico__';
        if (paginas.has(clave)) return paginas.get(clave);
        const opciones = { baseURL: config.baseURL, viewport: { width: ancho, height: alto } };
        // Con actor: su sesión. Público: contexto nuevo, SIN storageState (no autenticado).
        if (actor) {
            if (!sesiones[actor]) throw new Error(`la pantalla usa el actor "${actor}" pero no hay sesión suya`);
            opciones.storageState = sesiones[actor];
        }
        const ctx = await navegador.newContext(opciones);
        const page = await ctx.newPage();
        paginas.set(clave, page);
        return page;
    };

    const manifest = [];
    let ok = 0;
    let fail = 0;

    for (const p of pantallas) {
        try {
            const page = await paginaDe(p.actor ?? null);
            if (p.url) {
                await page.goto(config.baseURL + p.url, { waitUntil: 'networkidle', timeout: 20000 });
            }
            if (p.esperaTexto) {
                await page.locator(`text=${p.esperaTexto}`).first().waitFor({ state: 'visible', timeout: 12000 });
            }
            if (typeof p.hacer === 'function') {
                await p.hacer(page, { config });
            }
            await page.waitForTimeout(p.esperaMs ?? 1000);
            const archivo = `${p.id}.png`;
            await page.screenshot({ path: join(dir, archivo), fullPage: p.completa ?? false });
            manifest.push({ id: p.id, url: p.url ?? null, actor: p.actor ?? null, archivo: `pantallas/${archivo}` });
            ok++;
        } catch (error) {
            manifest.push({ id: p.id, error: String(error.message).split('\n')[0].slice(0, 140) });
            fail++;
        }
    }

    await navegador.close();

    // Manifiesto de lo capturado (factual). El `mapa.json` completo —roles, estados, mensajes—
    // lo arma el análisis funcional por encima de esto (skill mapa-funcional).
    writeFileSync(
        resolve(salida, 'pantallas.json'),
        JSON.stringify({ generado_por: 'demo contexto', total: pantallas.length, ok, fail, pantallas: manifest }, null, 2),
    );

    return { salida, ok, fail, manifest };
}
