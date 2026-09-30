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

/*
 * Cursor por página: flecha de ratón (escritorio) o indicador de toque (C9 / G2-38). En una
 * app táctil la flecha no significa nada —nadie usa ratón en un teléfono— y además tapaba
 * texto («Salir», «Llegué al lugar»). El toque es un círculo translúcido centrado en el punto,
 * como el «mostrar toques» de Android. WeakMap por página por la misma razón que AVISOS_CLIC:
 * los guiones llaman `instalarCursor(page)`/`pulsar(page, …)` sin más, y el modo tiene que
 * sobrevivir a cada navegación, que se lleva el DOM y obliga a reinstalar.
 */
const MODOS_CURSOR = new WeakMap();

/** Elige el cursor de una página: `{ tactil: true }` dibuja el indicador de toque. Lo llama
 * el grabador por actor (ver `actorTactil`); un guion puede llamarlo a mano para una página
 * que abra por su cuenta. Se aplica en el próximo `instalarCursor` (lo hacen todas las
 * funciones de este módulo). */
export function configurarCursor(page, { tactil = false } = {}) {
    MODOS_CURSOR.set(page, { tactil: Boolean(tactil) });
}

/** Dibuja el cursor y el estilo de los halos. Idempotente.
 *
 * El cursor nace OCULTO (opacity:0): sin esto, cada documento nuevo (cada navegación) lo
 * instala visible en (0,0), y ahí se queda a la vista —saltando a la esquina superior
 * izquierda en el video— hasta el próximo `moverCursorA`. `moverCursorA` es quien lo hace
 * visible, justo cuando ya sabe adónde llevarlo.
 *
 * `data-tipo` dice cuál se dibuja (`flecha` o `toque`); se actualiza aunque el cursor ya
 * exista, para que `configurarCursor` valga sin recargar la página. La flecha apunta con su
 * esquina (el punto es su origen); el toque se centra en el punto con un margen negativo, así
 * que el `translate` de `moverCursorA` sirve igual para los dos.
 */
export async function instalarCursor(page) {
    const tipo = MODOS_CURSOR.get(page)?.tactil ? 'toque' : 'flecha';
    await page.evaluate(({ ms, tipo }) => {
        const existente = document.getElementById('__cursor');
        if (existente) {
            existente.dataset.tipo = tipo;
            return;
        }
        const estilo = document.createElement('style');
        estilo.textContent = `
            #__cursor { position: fixed; top: 0; left: 0; width: 22px; height: 22px; z-index: 2147483646;
                pointer-events: none; opacity: 0;
                transition: transform ${ms}ms cubic-bezier(.4,0,.2,1), opacity 120ms linear;
                background: no-repeat center/contain url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>\
<path d='M5 2l14 9-6 1.5L15 20l-3 1-2-7-5 2z' fill='%23fff' stroke='%23111' stroke-width='1.5'/></svg>"); }
            #__cursor[data-tipo="toque"] { width: 34px; height: 34px; margin: -17px 0 0 -17px; box-sizing: border-box;
                border-radius: 50%; background: rgba(255,255,255,.35); border: 3px solid rgba(17,17,17,.7);
                box-shadow: 0 0 0 2px rgba(255,255,255,.85), 0 1px 6px rgba(0,0,0,.35); }
            .__halo { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
                border: 3px solid #38bdf8; z-index: 2147483645; pointer-events: none;
                animation: __pulso 600ms ease-out forwards; }
            @keyframes __pulso { from { transform: scale(1); opacity: .9 } to { transform: scale(4); opacity: 0 } }
            html[data-demo-sin-cursor] #__cursor, html[data-demo-sin-cursor] .__halo { visibility: hidden !important; }
        `;
        document.head.appendChild(estilo);
        const cursor = document.createElement('div');
        cursor.id = '__cursor';
        cursor.dataset.tipo = tipo;
        document.documentElement.appendChild(cursor);
    }, { ms: MS_MOVIMIENTO, tipo });
}

/**
 * Corre `fn` con el cursor y los halos ocultos, y los devuelve a como estaban (aunque `fn`
 * falle). Para las capturas fijas que van al manual (`video.cursorEnCapturas: false`): en un
 * video el cursor dice dónde se toca; en una imagen quieta solo tapa texto.
 */
export async function conCursorOculto(page, fn) {
    await page.evaluate(() => document.documentElement.setAttribute('data-demo-sin-cursor', ''));
    try {
        return await fn();
    } finally {
        await page.evaluate(() => document.documentElement.removeAttribute('data-demo-sin-cursor')).catch(() => {});
    }
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
const AVISOS_CLIC = new WeakMap();

/** El grabador se entera de cada pulsación (para el clic sonoro) sin que los guiones cambien.
 *
 * WeakMap por página y no un parámetro de `pulsar`: los guiones ya escritos llaman
 * `pulsar(page, selector)` a secas, y obligarlos a pasar un callback rompería todos. Así el
 * aviso viaja pegado a la página que el grabador creó, y muere con ella. */
export function alClicar(page, fn) { AVISOS_CLIC.set(page, fn); }
// Solo se registra la página que el grabador abre por actor. Una ventana emergente (popup,
// `target=_blank`) es otra página: sus clics no avisan, y tampoco se graba como pista.

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
    // Justo antes del clic y no después: si el clic navega, `click()` vuelve recién cuando la
    // página nueva cargó, y el sonido quedaría corrido cientos de ms respecto del halo.
    AVISOS_CLIC.get(page)?.(Date.now());
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

/**
 * Deja el viewport VISUAL centrado en `punto` (coordenadas de documento), a la escala actual.
 *
 * Por qué no `window.scrollTo`: en Chromium el viewport visual es "inerte" para la página —
 * `scrollTo` mueve SOLO el viewport de layout—, así que con escala > 1 el visual nunca se
 * desplazaba y el zoom quedaba anclado arriba a la izquierda. En una página que se desplaza
 * en vertical parecía andar (el layout sí bajaba), pero en un panel con barras fijas y el
 * contenido dentro de un contenedor de scroll propio (Filament 5 SPA), o en una sala de alto
 * fijo, el objetivo quedaba fuera de cuadro. `scrollIntoView` sí desplaza el viewport visual
 * (primero el visual y después, si hace falta, el de layout), así que se centra un marcador
 * de 1 px puesto en `punto` y se quita en el acto.
 *
 * En un eje donde el documento NO debe desplazarse (overflow hidden/clip en la raíz, o un
 * objetivo dentro de algo `position: fixed`, que viaja con el viewport de layout) el punto se
 * limita a lo alcanzable moviendo solo el visual dentro del layout actual: una sala de alto
 * fijo con contenido sobrante debajo se correría hacia arriba y dejaría media pantalla en
 * blanco. Si el objetivo está tan al borde que no cabe centrado, queda lo más cerca posible
 * del centro, sin mostrar nada fuera de la página.
 */
async function centrarVista(page, punto) {
    await page.evaluate(({ x, y, libreX, libreY }) => {
        const vv = window.visualViewport;
        const raiz = document.documentElement;
        const limitar = (v, min, max) => (min > max ? (min + max) / 2 : Math.min(max, Math.max(min, v)));
        const cx = libreX ? x : limitar(x, scrollX + vv.width / 2, scrollX + raiz.clientWidth - vv.width / 2);
        const cy = libreY ? y : limitar(y, scrollY + vv.height / 2, scrollY + raiz.clientHeight - vv.height / 2);
        const marca = document.createElement('div');
        // El marcador mide 1 px y `scrollIntoView` centra SU centro: se corre medio píxel para
        // que ese centro caiga justo en el punto. Sin esto, con el punto limitado al borde, el
        // encuadre se pasaba medio píxel (uno redondeado) y a escala 2 cortaba 2 px del objetivo.
        marca.style.cssText = `position:absolute;left:${cx - 0.5}px;top:${cy - 0.5}px;width:1px;height:1px;`
            + 'margin:0;padding:0;border:0;visibility:hidden;pointer-events:none';
        const antes = { x: scrollX, y: scrollY };
        raiz.appendChild(marca);
        marca.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        marca.remove();
        // Aun con el punto limitado, el redondeo subpíxel del visual puede empujar el layout
        // un par de px: en un eje que no debe desplazarse se devuelve a donde estaba (esto
        // mueve solo el layout; el visual conserva su posición relativa).
        if ((!libreX && scrollX !== antes.x) || (!libreY && scrollY !== antes.y)) {
            window.scrollTo({ left: libreX ? scrollX : antes.x, top: libreY ? scrollY : antes.y, behavior: 'instant' });
        }
    }, punto);
}

/** Recorre la escala del viewport visual en pasos pequeños para que el zoom se vea como un
 * acercamiento suave y no como un salto. Si se entrega `punto`, lo mantiene centrado en
 * cada paso (recentrar solo al final se vería como un tirón). */
async function animarEscala(page, cdp, desde, hasta, punto) {
    for (let i = 1; i <= PASOS_ZOOM; i++) {
        const escala = desde + (hasta - desde) * (i / PASOS_ZOOM);
        await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: escala });
        if (punto) await centrarVista(page, punto);
        await page.waitForTimeout(MS_ZOOM / PASOS_ZOOM);
    }
}

/** Fracción de la pantalla que puede ocupar el objetivo tras el tope de escala: deja un 4 %
 * de aire por lado para que el borde del elemento no quede pegado al borde del cuadro. Es el
 * mismo 0,92 que ya usaban los guiones que se topaban la escala a mano. */
const MARGEN_ENCUADRE = 0.92;

/**
 * La escala más cercana a la pedida con la que el objetivo entra ENTERO en pantalla, con margen.
 *
 * Con la escala fija, un elemento ancho (una franja de ancho completo, el botón de pánico fijo
 * abajo en un teléfono) quedaba más grande que el cuadro y la cámara lo cortaba justo a él. Solo
 * se BAJA una escala que cortaba —nunca se sube— y nunca por debajo de 1 (sin zoom): un objetivo
 * que no cabe ni a escala 1 se muestra como está. Una escala pedida ≤ 1 se respeta tal cual.
 */
export function escalaQueCabe(escala, { ancho, alto, vistaAncho, vistaAlto }, margen = MARGEN_ENCUADRE) {
    if (!(escala > 1) || !(ancho > 0) || !(alto > 0) || !(vistaAncho > 0) || !(vistaAlto > 0)) return escala;
    const tope = Math.min((margen * vistaAncho) / ancho, (margen * vistaAlto) / alto);
    return Math.max(1, Math.min(escala, tope));
}

/**
 * Acerca la vista sobre un elemento, dejándolo centrado.
 *
 * `escala` es un MÁXIMO: si a esa escala el objetivo no cabe entero (con `margen`, la fracción
 * del cuadro que puede ocupar; 0,92 por defecto), se baja lo justo para que quepa (ver
 * `escalaQueCabe`). `ajustar: false` vuelve al comportamiento anterior a 1.15 (escala exacta,
 * aunque corte). Cerca de un borde, el encuadre no se centra más allá de la página: se detiene
 * en el borde del viewport y el objetivo queda entero, descentrado hacia ese lado.
 *
 * Usa el zoom real del navegador (CDP `Emulation.setPageScaleFactor`, el mismo mecanismo
 * del pellizco en el móvil) y NO `transform: scale()` sobre `<html>`. Ese transform convierte
 * la raíz en bloque contenedor de todo lo `position: fixed`, así que una barra lateral o
 * superior fija —como las de un panel Filament— se desancla del viewport en vez de quedar
 * a la vista. El zoom vía CDP deja el layout intacto: los elementos fijos siguen fijos.
 *
 * Antes de acercar, el elemento se centra dentro de cada contenedor con scroll propio que lo
 * contenga (la lista de un panel, la columna de una sala), moviendo SOLO esos contenedores:
 * es lo que haría una persona para mostrarlo, y sin eso el objetivo puede estar fuera de
 * cuadro aunque la cámara apunte bien. Esos contenedores no se restauran al `alejar`
 * (restaurarlos daría un salto en el video sin nada que contar); el documento sí.
 */
export async function acercarA(page, selector, { escala = 1.6, ajustar = true, margen = MARGEN_ENCUADRE } = {}) {
    // la hoja de estilos del cursor viaja con la cámara
    await instalarCursor(page);
    // centroDe falla con un mensaje claro si el objetivo no existe
    await centroDe(page, selector);
    const sesion = await sesionDe(page);
    // se guarda el desplazamiento original solo la primera vez: si ya estábamos con zoom
    // (dos acercarA seguidos sin alejar), no hay que perder el punto de partida real.
    if (!sesion.origen) {
        sesion.origen = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    }
    const punto = await localizadorDe(page, selector).evaluate((el) => {
        const desplaza = (v) => /(auto|scroll)/.test(v);
        for (let padre = el.parentElement; padre && padre !== document.body && padre !== document.documentElement;
            padre = padre.parentElement) {
            const estilo = getComputedStyle(padre);
            const enY = desplaza(estilo.overflowY) && padre.scrollHeight > padre.clientHeight;
            const enX = desplaza(estilo.overflowX) && padre.scrollWidth > padre.clientWidth;
            if (!enY && !enX) continue;
            const caja = el.getBoundingClientRect();
            const marco = padre.getBoundingClientRect();
            padre.scrollTo({
                top: padre.scrollTop + (enY ? (caja.top + caja.height / 2) - (marco.top + padre.clientTop + padre.clientHeight / 2) : 0),
                left: padre.scrollLeft + (enX ? (caja.left + caja.width / 2) - (marco.left + padre.clientLeft + padre.clientWidth / 2) : 0),
                behavior: 'instant',
            });
        }
        let fijo = false;
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
            if (getComputedStyle(n).position === 'fixed') { fijo = true; break; }
        }
        // overflow de la raíz: el de <html>, o el de <body> si <html> lo deja en visible
        // (el navegador propaga el de body al viewport en ese caso).
        const raizEl = document.documentElement;
        const raiz = getComputedStyle(raizEl);
        const cuerpo = document.body ? getComputedStyle(document.body) : raiz;
        const libre = (eje) => {
            const v = raiz[eje] !== 'visible' ? raiz[eje] : cuerpo[eje];
            return !fijo && !/(hidden|clip)/.test(v);
        };
        const r = el.getBoundingClientRect();
        return {
            x: r.left + r.width / 2 + window.scrollX,
            y: r.top + r.height / 2 + window.scrollY,
            libreX: libre('overflowX'),
            libreY: libre('overflowY'),
            ancho: r.width,
            alto: r.height,
            vistaAncho: raizEl.clientWidth,
            vistaAlto: raizEl.clientHeight,
        };
    });
    const destino = ajustar ? escalaQueCabe(escala, punto, margen) : escala;
    const escalaActual = await page.evaluate(() => window.visualViewport.scale);
    await animarEscala(page, sesion.cdp, escalaActual, destino, punto);
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
