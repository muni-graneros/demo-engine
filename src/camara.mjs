/**
 * Todo lo visual de la grabación ocurre DENTRO de la página, no en post-proceso: así el
 * zoom cae exactamente sobre el elemento (conocemos su bounding box) y el cursor existe,
 * cosa que el navegador headless no dibuja por su cuenta.
 */

let MS_MOVIMIENTO = 550;

/** Ajusta el ritmo del puntero desde la config del proyecto (`video.msCursor`).
 *
 * Es un valor de MONTAJE, no de comportamiento: 550 ms se ve didáctico en un
 * tutorial pausado y arrastrado en uno ágil, y hasta ahora estaba fijo en el
 * motor, así que ningún proyecto podía elegir su propio ritmo. */
export function configurarCamara({ msCursor } = {}) {
    if (Number.isFinite(msCursor) && msCursor > 0) MS_MOVIMIENTO = msCursor;
}

/** Dibuja el cursor y el estilo de los halos. Idempotente.
 *
 * El cursor nace OCULTO (opacity:0): sin esto, cada documento nuevo (cada navegación) lo
 * instala visible en (0,0), y ahí se queda a la vista —saltando a la esquina superior
 * izquierda en el video— hasta el próximo `moverCursorA`. `moverCursorA` es quien lo hace
 * visible, justo cuando ya sabe adónde llevarlo.
 */
export async function instalarCursor(page) {
    await page.evaluate((ms) => {
        if (document.getElementById('__cursor')) return;
        const estilo = document.createElement('style');
        estilo.textContent = `
            #__cursor { position: fixed; top: 0; left: 0; width: 22px; height: 22px; z-index: 2147483646;
                pointer-events: none; opacity: 0;
                transition: transform ${ms}ms cubic-bezier(.4,0,.2,1), opacity 120ms linear;
                background: no-repeat center/contain url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>\
<path d='M5 2l14 9-6 1.5L15 20l-3 1-2-7-5 2z' fill='%23fff' stroke='%23111' stroke-width='1.5'/></svg>"); }
            .__halo { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
                border: 3px solid #38bdf8; z-index: 2147483645; pointer-events: none;
                animation: __pulso 600ms ease-out forwards; }
            @keyframes __pulso { from { transform: scale(1); opacity: .9 } to { transform: scale(4); opacity: 0 } }
        `;
        document.head.appendChild(estilo);
        const cursor = document.createElement('div');
        cursor.id = '__cursor';
        document.documentElement.appendChild(cursor);
    }, MS_MOVIMIENTO);
}

/** El elemento a mirar: `dentro`, si viene, ACOTADO a `selector` (no un selector suelto de
 * página: dos filas de tabla pueden repetir la misma clase en su celda de acciones, y sin
 * acotar se apuntaría siempre a la primera de todo el documento). */
function localizadorDe(page, selector, dentro) {
    const base = page.locator(selector);
    return dentro ? base.locator(dentro).first() : base.first();
}

async function centroDe(page, selector, dentro) {
    const caja = await localizadorDe(page, selector, dentro).boundingBox();
    if (!caja) {
        const objetivo = dentro ? `"${dentro}" dentro de "${selector}"` : `"${selector}"`;
        throw new Error(`no se pudo ubicar ${objetivo} para mover el cursor`);
    }
    return { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 };
}

/** Lleva el cursor al centro del elemento, con easing, y espera a que llegue.
 *
 * `dentro`, opcional: en vez del centro geométrico de `selector` (que en un contenedor
 * ancho —una fila de tabla— puede caer sobre una celda vacía, lejos de cualquier control),
 * apunta al centro del elemento interior que de verdad importa mostrar. */
export async function moverCursorA(page, selector, dentro) {
    // Se repone el cursor por si el paso navegó: una navegación se lleva el DOM entero, y
    // un guion normal navega y DESPUÉS pulsa, dentro del mismo paso. Sin esto, el clic
    // ocurre sin puntero a la vista y el video vuelve a no mostrar dónde se toca.
    await instalarCursor(page);
    const { x, y } = await centroDe(page, selector, dentro);
    await page.evaluate(({ x, y }) => {
        const c = document.getElementById('__cursor');
        if (c) { c.style.transform = `translate(${x}px, ${y}px)`; c.style.opacity = '1'; }
    }, { x, y });
    await page.mouse.move(x, y);
    await page.waitForTimeout(MS_MOVIMIENTO + 80);
}

/** Mueve el cursor, dibuja el halo y hace el clic real.
 *
 * `dentro`, opcional: el cursor apunta y el clic ocurre sobre ESE elemento interior (acotado
 * a `selector`), en vez del centro geométrico de `selector`. Sin `dentro`, se comporta
 * exactamente igual que siempre. */
export async function pulsar(page, selector, { alPintar, dentro } = {}) {
    await moverCursorA(page, selector, dentro);
    const { x, y } = await centroDe(page, selector, dentro);
    await page.evaluate(({ x, y }) => {
        const halo = document.createElement('div');
        halo.className = '__halo';
        halo.style.left = `${x}px`;
        halo.style.top = `${y}px`;
        document.documentElement.appendChild(halo);
        setTimeout(() => halo.remove(), 700);
    }, { x, y });
    if (alPintar) await alPintar();
    await page.waitForTimeout(180);
    await localizadorDe(page, selector, dentro).click();
    // si el clic navegó, el cursor desapareció; reponerlo es idempotente
    await instalarCursor(page);
}

// Sesión CDP cacheada por página: abrir una sesión nueva en cada llamada es caro y las
// va acumulando. Una por página alcanza para toda la grabación.
const SESIONES_CDP = new WeakMap();

const PASOS_ZOOM = 20;
const MS_ZOOM = 600;

async function sesionDe(page) {
    let sesion = SESIONES_CDP.get(page);
    if (!sesion) {
        sesion = { cdp: await page.context().newCDPSession(page), origen: null };
        SESIONES_CDP.set(page, sesion);
    }
    return sesion;
}

/** Recorre la escala del viewport visual en pasos pequeños para que el zoom se vea como un
 * acercamiento suave y no como un salto. Si se entrega `punto`, lo mantiene centrado en
 * cada paso (recentrar solo al final se vería como un tirón). */
async function animarEscala(page, cdp, desde, hasta, punto) {
    for (let i = 1; i <= PASOS_ZOOM; i++) {
        const escala = desde + (hasta - desde) * (i / PASOS_ZOOM);
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: escala });
        if (punto) {
            await page.evaluate(({ x, y }) => {
                const vv = window.visualViewport;
                window.scrollTo(x - vv.width / 2, y - vv.height / 2);
            }, punto);
        }
        await page.waitForTimeout(MS_ZOOM / PASOS_ZOOM);
    }
}

/**
 * Acerca la vista sobre un elemento, dejándolo centrado.
 *
 * Usa el zoom real del navegador (CDP `Emulation.setPageScaleFactor`, el mismo mecanismo
 * del pellizco en el móvil) y NO `transform: scale()` sobre `<html>`. Ese transform convierte
 * la raíz en bloque contenedor de todo lo `position: fixed`, así que una barra lateral o
 * superior fija —como las de un panel Filament— se desancla del viewport en vez de quedar
 * a la vista. El zoom vía CDP deja el layout intacto: los elementos fijos siguen fijos.
 */
export async function acercarA(page, selector, { escala = 1.6 } = {}) {
    // la hoja de estilos del cursor viaja con la cámara
    await instalarCursor(page);
    const { x, y } = await centroDe(page, selector);
    const sesion = await sesionDe(page);
    // se guarda el desplazamiento original solo la primera vez: si ya estábamos con zoom
    // (dos acercarA seguidos sin alejar), no hay que perder el punto de partida real.
    if (!sesion.origen) {
        sesion.origen = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    }
    const escalaActual = await page.evaluate(() => window.visualViewport.scale);
    await animarEscala(page, sesion.cdp, escalaActual, escala, { x, y });
}

/** Devuelve la escala a 1 y restaura el desplazamiento que había antes del acercamiento. */
export async function alejar(page) {
    const sesion = await sesionDe(page);
    const escalaActual = await page.evaluate(() => window.visualViewport.scale);
    await animarEscala(page, sesion.cdp, escalaActual, 1, null);
    if (sesion.origen) {
        await page.evaluate(({ x, y }) => window.scrollTo(x, y), sesion.origen);
        sesion.origen = null;
    }
}
