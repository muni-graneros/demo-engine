/**
 * Todo lo visual de la grabación ocurre DENTRO de la página, no en post-proceso: así el
 * zoom cae exactamente sobre el elemento (conocemos su bounding box) y el cursor existe,
 * cosa que el navegador headless no dibuja por su cuenta.
 */

const MS_MOVIMIENTO = 550;

/** Dibuja el cursor y el estilo de los halos. Idempotente. */
export async function instalarCursor(page) {
    await page.evaluate((ms) => {
        if (document.getElementById('__cursor')) return;
        const estilo = document.createElement('style');
        estilo.textContent = `
            #__cursor { position: fixed; top: 0; left: 0; width: 22px; height: 22px; z-index: 2147483646;
                pointer-events: none; transition: transform ${ms}ms cubic-bezier(.4,0,.2,1);
                background: no-repeat center/contain url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>\
<path d='M5 2l14 9-6 1.5L15 20l-3 1-2-7-5 2z' fill='%23fff' stroke='%23111' stroke-width='1.5'/></svg>"); }
            .__halo { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
                border: 3px solid #38bdf8; z-index: 2147483645; pointer-events: none;
                animation: __pulso 600ms ease-out forwards; }
            @keyframes __pulso { from { transform: scale(1); opacity: .9 } to { transform: scale(4); opacity: 0 } }
            html.__zoom { transition: transform 700ms cubic-bezier(.4,0,.2,1); }
        `;
        document.head.appendChild(estilo);
        const cursor = document.createElement('div');
        cursor.id = '__cursor';
        document.documentElement.appendChild(cursor);
    }, MS_MOVIMIENTO);
}

async function centroDe(page, selector) {
    const caja = await page.locator(selector).first().boundingBox();
    if (!caja) throw new Error(`no se pudo ubicar "${selector}" para mover el cursor`);
    return { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 };
}

/** Lleva el cursor al centro del elemento, con easing, y espera a que llegue. */
export async function moverCursorA(page, selector) {
    // Se repone el cursor por si el paso navegó: una navegación se lleva el DOM entero, y
    // un guion normal navega y DESPUÉS pulsa, dentro del mismo paso. Sin esto, el clic
    // ocurre sin puntero a la vista y el video vuelve a no mostrar dónde se toca.
    await instalarCursor(page);
    const { x, y } = await centroDe(page, selector);
    await page.evaluate(({ x, y }) => {
        const c = document.getElementById('__cursor');
        if (c) c.style.transform = `translate(${x}px, ${y}px)`;
    }, { x, y });
    await page.mouse.move(x, y);
    await page.waitForTimeout(MS_MOVIMIENTO + 80);
}

/** Mueve el cursor, dibuja el halo y hace el clic real. */
export async function pulsar(page, selector, { alPintar } = {}) {
    await moverCursorA(page, selector);
    const { x, y } = await centroDe(page, selector);
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
    await page.locator(selector).first().click();
    // si el clic navegó, el cursor desapareció; reponerlo es idempotente
    await instalarCursor(page);
}

/** Acerca la vista sobre un elemento, dejándolo centrado. */
export async function acercarA(page, selector, { escala = 1.6 } = {}) {
    // la hoja de estilos del zoom viaja con el cursor
    await instalarCursor(page);
    const { x, y } = await centroDe(page, selector);
    await page.evaluate(({ x, y, escala }) => {
        const html = document.documentElement;
        html.classList.add('__zoom');
        html.style.transformOrigin = `${x}px ${y}px`;
        html.style.transform = `scale(${escala})`;
    }, { x, y, escala });
    await page.waitForTimeout(750);
}

export async function alejar(page) {
    await page.evaluate(() => {
        const html = document.documentElement;
        html.style.transform = '';
        html.style.transformOrigin = '';
    });
    await page.waitForTimeout(750);
}
