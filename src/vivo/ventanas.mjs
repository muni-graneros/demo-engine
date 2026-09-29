/**
 * Dónde va la ventana de cada actor en la pantalla del proyector (modo A del diseño: ventanas
 * reales de Chromium, ordenadas por el motor).
 *
 * `disposicionVentanas` es PURA: recibe el rectángulo de la pantalla y los paneles visibles
 * (uno, o dos en un tramo con `dividir`) y devuelve los bounds de cada ventana. Las ventanas
 * se mueven por CDP (`Browser.setWindowBounds`) en `ubicarVentanas`.
 *
 * Reglas:
 * - un escritorio solo ocupa la pantalla entera: en vivo su viewport lo manda la ventana
 *   (ver `opcionesDeActor` en index.mjs), así que la app se acomoda al proyector;
 * - un teléfono tiene viewport FIJO (el descriptor de Playwright, Pixel 7: 412×839): su
 *   ventana mide eso más el marco del navegador, centrada. Si la pantalla es más baja, se
 *   recorta al alto disponible (verificar en el proyector: Chromium no escala el viewport);
 * - dos paneles van lado a lado en el orden de `dividir`: los teléfonos con su ancho fijo y
 *   los escritorios repartiéndose el resto; el grupo queda centrado.
 */

/** Alto aproximado del marco de una ventana de Chromium (pestañas + barra de dirección). */
export const ALTO_CROMO = 88;
/** Ancho mínimo que Chromium acepta para una ventana normal (por debajo, la agranda solo). */
export const ANCHO_MINIMO = 500;
const SEPARACION = 8;

/**
 * @param {{ pantalla: {x:number,y:number,ancho:number,alto:number},
 *           paneles: Array<{ nombre: string, tipo: 'telefono'|'escritorio', ancho?: number, alto?: number }> }} p
 * @returns {Array<{ nombre: string, left: number, top: number, width: number, height: number }>}
 */
export function disposicionVentanas({ pantalla, paneles }) {
    if (!Array.isArray(paneles) || paneles.length < 1 || paneles.length > 2) {
        throw new Error(`disposicionVentanas: se esperan 1 o 2 paneles, llegaron ${paneles?.length}`);
    }
    const alto = pantalla.alto;
    const fijo = (p) => p.tipo === 'telefono';
    const anchoFijo = (p) => Math.min(pantalla.ancho, Math.max(ANCHO_MINIMO, p.ancho ?? 412));
    const altoDe = (p) => (fijo(p) ? Math.min(alto, (p.alto ?? 839) + ALTO_CROMO) : alto);

    const separaciones = SEPARACION * (paneles.length - 1);
    const ocupadoFijo = paneles.filter(fijo).reduce((s, p) => s + anchoFijo(p), 0);
    const flexibles = paneles.filter((p) => !fijo(p)).length;
    const anchoFlexible = flexibles ? Math.max(ANCHO_MINIMO, Math.floor((pantalla.ancho - ocupadoFijo - separaciones) / flexibles)) : 0;
    const anchos = paneles.map((p) => (fijo(p) ? anchoFijo(p) : anchoFlexible));
    const total = anchos.reduce((s, a) => s + a, 0) + separaciones;

    let cursor = pantalla.x + Math.max(0, Math.floor((pantalla.ancho - total) / 2));
    return paneles.map((p, i) => {
        const h = altoDe(p);
        const ventana = {
            nombre: p.nombre,
            left: Math.round(cursor),
            top: Math.round(pantalla.y + (alto - h) / 2),
            width: anchos[i],
            height: h,
        };
        cursor += anchos[i] + SEPARACION;
        return ventana;
    });
}

/** El id de ventana de CDP de un actor, cacheado en sus datos. */
async function ventanaDe(datos) {
    if (!datos.cdp) datos.cdp = await datos.ctx.newCDPSession(datos.page);
    if (datos.idVentana == null) ({ windowId: datos.idVentana } = await datos.cdp.send('Browser.getWindowForTarget'));
    return datos.idVentana;
}

/**
 * Aplica una disposición: las ventanas visibles, restauradas y en su lugar; las demás,
 * minimizadas. CDP no deja combinar `windowState` con posición, así que primero se pasa a
 * `normal` y después se mueve.
 *
 * @param {Map<string, object>} actores los datos de cada actor abierto (ctx, page)
 * @param {ReturnType<typeof disposicionVentanas>} disposicion
 */
export async function ubicarVentanas(actores, disposicion) {
    const visibles = new Set(disposicion.map((v) => v.nombre));
    for (const [nombre, datos] of actores) {
        if (visibles.has(nombre)) continue;
        const id = await ventanaDe(datos);
        await datos.cdp.send('Browser.setWindowBounds', { windowId: id, bounds: { windowState: 'minimized' } });
    }
    for (const v of disposicion) {
        const datos = actores.get(v.nombre);
        const id = await ventanaDe(datos);
        await datos.cdp.send('Browser.setWindowBounds', { windowId: id, bounds: { windowState: 'normal' } });
        await datos.cdp.send('Browser.setWindowBounds', {
            windowId: id, bounds: { left: v.left, top: v.top, width: v.width, height: v.height },
        });
        await datos.page.bringToFront();
    }
}
