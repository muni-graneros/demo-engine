/**
 * Recursos de "explainer" corporativo: presentar al elenco, poner el lower-third del
 * personaje que actúa y anotar/resaltar un elemento en pantalla. Con estos, un tutorial se
 * sigue como una presentación —"ahora llega Carlos… Paula lo registra"— en vez de como una
 * captura de pantalla cruda.
 *
 * Mismo criterio que `rotulos.mjs`: las imágenes se incrustan como `data:` URI (una ruta de
 * archivo no carga dentro de `about:blank` ni de una página ajena), y todo degrada en
 * silencio: una foto que falta no tumba la grabación.
 */

import { imagenComoDataUri } from './assets.mjs';

/**
 * Carta de presentación del elenco: cada personaje con su foto, nombre y rol, sobre
 * `about:blank` (como la portada, nunca sobre datos reales). `cast` es una lista de
 * `{ nombre, rol, foto }`; `foto` es una ruta de archivo que se incrusta.
 */
export async function elenco(page, { cast = [], titulo = 'Quiénes lo usan', marca = {}, esperaMs = 3400 }) {
    const conFoto = cast.map((p) => ({
        nombre: String(p.nombre ?? ''),
        rol: String(p.rol ?? ''),
        foto: imagenComoDataUri(p.foto),
    }));
    await page.goto('about:blank');
    await page.evaluate(({ cast, titulo, marca }) => {
        const escape = (t) => {
            const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return String(t).replace(/[&<>"']/g, (c) => m[c]);
        };
        const inicial = (n) => escape((n.trim()[0] || '?').toUpperCase());
        const tarjetas = cast.map((p) => `
            <figure style="margin:0;display:flex;flex-direction:column;align-items:center;gap:10px;width:200px">
              <div style="width:120px;height:120px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.18);
                          display:flex;align-items:center;justify-content:center;border:3px solid rgba(255,255,255,.55)">
                ${p.foto
                    ? `<img src="${p.foto}" alt="" style="width:100%;height:100%;object-fit:cover" />`
                    : `<span style="font-size:52px;font-weight:700;color:#fff">${inicial(p.nombre)}</span>`}
              </div>
              <figcaption style="text-align:center">
                <div style="font-size:22px;font-weight:700">${escape(p.nombre)}</div>
                <div style="font-size:16px;opacity:.82">${escape(p.rol)}</div>
              </figcaption>
            </figure>`).join('');
        document.body.style.margin = '0';
        document.body.innerHTML = `
        <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
                    background:${marca.color ?? '#1e3a8a'};color:#fff;font-family:system-ui;text-align:center;gap:40px">
          <h1 style="font-size:46px;margin:0;font-weight:700">${escape(titulo)}</h1>
          <div style="display:flex;flex-wrap:wrap;gap:44px;justify-content:center;max-width:1200px">${tarjetas}</div>
          <div style="font-size:16px;opacity:.6">${escape(marca.nombre ?? '')}</div>
        </div>`;
    }, { cast: conFoto, titulo, marca });
    await page.waitForTimeout(esperaMs);
}

/**
 * Posiciones válidas de la ficha de `presentar`. `auto` (el defecto) elige la esquina con
 * menos cosas debajo; las otras cuatro la fijan, salvo que el objetivo del paso caiga debajo.
 */
export const POSICIONES_FICHA = ['auto', 'abajo-izquierda', 'abajo-derecha', 'arriba-izquierda', 'arriba-derecha'];

const DEFECTO_FICHA = { posicion: 'auto', evitar: [], margen: 28 };
let fichaGlobal = { ...DEFECTO_FICHA };
const fichaPorPagina = new WeakMap();

function validarPosicion(posicion) {
    if (posicion !== undefined && !POSICIONES_FICHA.includes(posicion)) {
        throw new Error(`presentar: posicion "${posicion}" no existe; usá una de ${POSICIONES_FICHA.join(', ')}`);
    }
}

/**
 * Configura dónde va la ficha de `presentar`. Sin `page`, cambia el defecto de todo el
 * proceso; con `page`, sólo el de esa página (una superficie: el APK del patrullero quiere la
 * ficha arriba porque abajo vive PÁNICO). Las opciones de cada llamada a `presentar` (o las
 * que traiga el objeto del actor) mandan sobre ambas.
 *
 * - `posicion`: una de `POSICIONES_FICHA`.
 * - `evitar`: selectores que la ficha no debe tapar nunca (se suman a los objetivos).
 * - `margen`: distancia al borde de la pantalla, en px.
 */
export function configurarPresentacion(opciones = {}, page = null) {
    validarPosicion(opciones.posicion);
    if (page) fichaPorPagina.set(page, { ...(fichaPorPagina.get(page) ?? {}), ...opciones });
    else fichaGlobal = { ...DEFECTO_FICHA, ...opciones };
}

/**
 * Instala en la página las ayudas de medición que comparten la ficha y el globo. Idempotente
 * y dentro de `page.evaluate` (vía CDP): un `new Function` en la página chocaría con la CSP
 * de los sistemas grabados, y una navegación se lleva todo, así que se repone en cada uso.
 */
async function instalarMedidor(page) {
    await page.evaluate(() => {
        if (window.__demoMedidor) return;
        // Lo que dibuja el motor (o el guion) encima de la página no cuenta como contenido.
        const NUESTRO = '#demo-lower-third,#demo-anotacion,#demo-resalte,#__cursor,.__halo';
        const INTERACTIVO = 'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],'
            + '[role=menuitem],[role=checkbox],[role=switch],[onclick],[tabindex]:not([tabindex="-1"])';
        const cruza = (a, b, holgura = 0) => a.left < b.right + holgura && b.left < a.right + holgura
            && a.top < b.bottom + holgura && b.top < a.bottom + holgura;
        const area = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
            * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const visible = (el) => {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) return false;
            const cs = getComputedStyle(el);
            return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
        };
        const tieneContenido = (el) => {
            if (/^(IMG|SVG|CANVAS|VIDEO|svg|path|INPUT|SELECT|TEXTAREA|BUTTON)$/.test(el.tagName)) return true;
            for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
            const cs = getComputedStyle(el);
            // Un bloque con fondo propio (tarjeta, franja, botón fijo) también es algo a la vista.
            return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && el !== document.body && el !== document.documentElement;
        };
        /**
         * Cuánto se tapa si algo se pone en `r`: muestrea una grilla con elementFromPoint
         * (lo de arriba de todo, sin contar las capas del motor) —interactivo pesa 3, contenido
         * 1— y suma 2 por cada control visible cuya caja cruza la zona.
         */
        const ocupacion = (r) => {
            let total = 0;
            const cols = 6, filas = 4;
            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < filas; j++) {
                    const x = r.left + (r.right - r.left) * (i + 0.5) / cols;
                    const y = r.top + (r.bottom - r.top) * (j + 0.5) / filas;
                    const el = document.elementsFromPoint(x, y).find((n) => !n.closest(NUESTRO));
                    if (!el) continue;
                    if (el.closest(INTERACTIVO)) total += 3;
                    else if (tieneContenido(el)) total += 1;
                }
            }
            for (const el of document.querySelectorAll(INTERACTIVO)) {
                if (el.closest(NUESTRO)) continue;
                const c = el.getBoundingClientRect();
                if (cruza(c, r) && visible(el)) total += 2;
            }
            return total;
        };
        /**
         * Rectángulos de lo que el paso actual quiere mostrar: el anillo de `anotar`, el de un
         * resalte del guion (`#demo-resalte`), lo marcado con `data-demo-objetivo` o
         * `data-demo-senal`, los selectores `evitar` y la punta del cursor del motor (adonde va,
         * no por dónde pasa: se lee del transform final, no de la caja en plena transición).
         */
        const objetivos = (evitar = []) => {
            const rects = [];
            const agregar = (el) => { if (el && visible(el)) rects.push(el.getBoundingClientRect()); };
            agregar(document.querySelector('#demo-anotacion [data-demo-anillo]'));
            agregar(document.querySelector('#demo-resalte > :first-child'));
            document.querySelectorAll('[data-demo-objetivo],[data-demo-senal]').forEach(agregar);
            for (const sel of evitar) {
                try { document.querySelectorAll(sel).forEach(agregar); } catch { /* selector inválido: se ignora */ }
            }
            const cursor = document.getElementById('__cursor');
            if (cursor && getComputedStyle(cursor).opacity !== '0' && cursor.style.opacity !== '0') {
                const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(cursor.style.transform || '');
                const c = cursor.getBoundingClientRect();
                const x = m ? parseFloat(m[1]) : c.left;
                const y = m ? parseFloat(m[2]) : c.top;
                rects.push({ left: x - 12, top: y - 12, right: x + 12, bottom: y + 12 });
            }
            return rects;
        };
        window.__demoMedidor = { cruza, area, ocupacion, objetivos };
    });
}

/**
 * Lower-third del personaje que está actuando: una tarjeta con su foto, nombre y rol, SOBRE
 * la pantalla del sistema (no borra lo que hay debajo). Se queda hasta que la página navegue
 * o hasta `quitarPresentacion`. Para saber quién opera en cada momento, como en un explainer.
 *
 * Dónde va (`posicion`, también desde el objeto del actor o `configurarPresentacion`):
 * - `auto` (defecto): la esquina con menos controles y contenido visibles debajo. Antes iba
 *   siempre abajo a la izquierda y tapaba PÁNICO en el APK, tarjetas de la sala y el pie del
 *   menú del panel.
 * - una esquina fija (`abajo-izquierda` es la de siempre).
 * En ambos casos, mientras está en pantalla vigila el objetivo del paso (anillo de `anotar`,
 * `#demo-resalte`, `[data-demo-objetivo]`, `evitar` y el cursor del motor): si cae debajo,
 * se corre a la mejor esquina libre; con posición fija vuelve a la suya cuando se despeja.
 */
export async function presentar(page, { nombre, rol = '', foto, esperaMs = 0, posicion, evitar, margen } = {}) {
    validarPosicion(posicion);
    const deLaPagina = fichaPorPagina.get(page) ?? {};
    const opciones = {
        posicion: posicion ?? deLaPagina.posicion ?? fichaGlobal.posicion,
        evitar: [...(fichaGlobal.evitar ?? []), ...(deLaPagina.evitar ?? []), ...(evitar ?? [])],
        margen: margen ?? deLaPagina.margen ?? fichaGlobal.margen,
    };
    const dataUri = imagenComoDataUri(foto);
    await instalarMedidor(page);
    await page.evaluate(({ nombre, rol, dataUri, opciones }) => {
        const escape = (t) => {
            const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return String(t).replace(/[&<>"']/g, (c) => m[c]);
        };
        window.__demoFichaLimpiar?.();
        document.getElementById('demo-lower-third')?.remove();
        const inicial = escape((String(nombre).trim()[0] || '?').toUpperCase());
        const el = document.createElement('div');
        el.id = 'demo-lower-third';
        el.style.cssText = `position:fixed;left:0;top:0;z-index:2147483000;display:flex;align-items:center;
            gap:14px;padding:12px 20px 12px 12px;border-radius:16px;background:rgba(15,23,42,.92);color:#fff;
            font-family:system-ui;box-shadow:0 12px 40px -12px rgba(0,0,0,.6);opacity:0;visibility:hidden;
            pointer-events:none`;
        el.innerHTML = `
          <div style="width:56px;height:56px;border-radius:50%;overflow:hidden;background:#334155;flex:0 0 auto;
                      display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.5)">
            ${dataUri ? `<img src="${dataUri}" alt="" style="width:100%;height:100%;object-fit:cover" />`
                      : `<span style="font-size:26px;font-weight:700">${inicial}</span>`}
          </div>
          <div>
            <div style="font-size:19px;font-weight:700;line-height:1.15">${escape(nombre)}</div>
            <div style="font-size:14px;opacity:.8">${escape(rol)}</div>
          </div>`;
        document.body.appendChild(el);

        const { cruza, area, ocupacion, objetivos } = window.__demoMedidor;
        const m = opciones.margen;
        const ORDEN = ['abajo-izquierda', 'abajo-derecha', 'arriba-izquierda', 'arriba-derecha'];
        const rectEn = (esquina) => {
            const w = el.offsetWidth, h = el.offsetHeight;
            const vw = document.documentElement.clientWidth, vh = window.innerHeight;
            const left = esquina.endsWith('izquierda') ? m : vw - m - w;
            const top = esquina.startsWith('arriba') ? m : vh - m - h;
            return { left, top, right: left + w, bottom: top + h };
        };
        const tapa = (r, objs) => objs.reduce((t, o) => t + (cruza(r, o, 8) ? 1 + area(r, o) : 0), 0);
        /** La mejor esquina: primero la que no tapa objetivos, después la menos ocupada. */
        const mejor = (objs) => ORDEN
            .map((e, i) => { const r = rectEn(e); return { e, i, tapa: tapa(r, objs), ocupa: ocupacion(r) }; })
            .sort((a, b) => a.tapa - b.tapa || a.ocupa - b.ocupa || a.i - b.i)[0].e;

        let actual = opciones.posicion === 'auto' ? mejor(objetivos(opciones.evitar)) : opciones.posicion;
        const colocar = (esquina) => {
            const r = rectEn(esquina);
            el.style.left = r.left + 'px';
            el.style.top = r.top + 'px';
            el.dataset.posicion = esquina;
        };
        colocar(actual);
        // Se fuerza el cálculo de estilo ANTES de activar la transición: si no, la primera
        // colocación se anima desde (0,0) y la ficha cruza la pantalla al aparecer.
        void el.getBoundingClientRect();
        el.style.visibility = 'visible';
        requestAnimationFrame(() => {
            el.style.transition = 'opacity .35s, left .3s cubic-bezier(.4,0,.2,1), top .3s cubic-bezier(.4,0,.2,1)';
            el.style.opacity = '1';
        });

        // Vigilante: reacciona al instante cuando el cursor o un marcador cambian (un observador
        // de mutaciones) y, por si el diseño se movió sin mutar nada que miremos, cada 250 ms.
        let pendiente = false;
        const revisar = () => {
            pendiente = false;
            if (!el.isConnected) return;
            const objs = objetivos(opciones.evitar);
            // Con posición fija se vuelve a la pedida apenas deja de tapar; en auto se queda
            // donde está mientras no tape (saltar de esquina sin motivo distrae).
            const preferida = opciones.posicion === 'auto' ? actual : opciones.posicion;
            let destino = preferida;
            if (tapa(rectEn(preferida), objs) > 0) destino = mejor(objs);
            if (destino !== actual || el.dataset.posicion !== destino) {
                actual = destino;
                colocar(destino);
            } else {
                colocar(actual);  // la ventana pudo cambiar de tamaño
            }
        };
        const pedir = () => { if (!pendiente) { pendiente = true; queueMicrotask(revisar); } };
        const observador = new MutationObserver((cambios) => {
            if (cambios.every((c) => c.target === el || el.contains(c.target))) return;
            pedir();
        });
        observador.observe(document.documentElement, {
            subtree: true, childList: true, attributes: true,
            attributeFilter: ['style', 'class', 'data-demo-objetivo', 'data-demo-senal', 'open', 'hidden'],
        });
        window.__demoFichaVigilante = setInterval(pedir, 250);
        window.__demoFichaLimpiar = () => {
            observador.disconnect();
            clearInterval(window.__demoFichaVigilante);
            delete window.__demoFichaVigilante;
            delete window.__demoFichaLimpiar;
        };
    }, { nombre: String(nombre ?? ''), rol, dataUri, opciones });
    if (esperaMs > 0) await page.waitForTimeout(esperaMs);
}

/** Quita el lower-third puesto por `presentar` (si sigue en pantalla) y su vigilante. */
export async function quitarPresentacion(page) {
    await page.evaluate(() => {
        window.__demoFichaLimpiar?.();
        document.getElementById('demo-lower-third')?.remove();
    });
}

/**
 * Anota/resalta un elemento: le dibuja un anillo y, al LADO, un globo con flecha que lo
 * apunta, para dirigir la mirada ("acá está el plazo legal"). Si el elemento no está, no hace
 * nada (degrada). La anotación se quita sola tras `esperaMs`, salvo `permanecer: true`.
 *
 * El globo se mide ya renderizado y se prueba arriba, abajo, a la derecha y a la izquierda:
 * gana el lado donde cabe entero en pantalla, no cruza la ficha de `presentar` y tapa menos
 * contenido (así no cae sobre la etiqueta del campo si abajo está libre). Antes iba a una
 * distancia fija por encima, y con dos líneas de texto caía sobre el propio objetivo (G7-02).
 * `lado` (`arriba`/`abajo`/`izquierda`/`derecha`) lo fuerza mientras quepa.
 */
export async function anotar(page, selector, texto, { esperaMs = 2200, permanecer = false, lado = 'auto' } = {}) {
    const LADOS = ['auto', 'arriba', 'abajo', 'derecha', 'izquierda'];
    if (!LADOS.includes(lado)) throw new Error(`anotar: lado "${lado}" no existe; usá uno de ${LADOS.join(', ')}`);
    const hay = await page.evaluate((sel) => !!document.querySelector(sel), selector).catch(() => false);
    if (!hay) return;
    await instalarMedidor(page);

    await page.evaluate(({ sel, texto, lado }) => {
        const objetivo = document.querySelector(sel);
        const r = objetivo.getBoundingClientRect();
        const caja = { x: r.left, y: r.top, w: r.width, h: r.height };
        document.getElementById('demo-anotacion')?.remove();
        const cont = document.createElement('div');
        cont.id = 'demo-anotacion';
        cont.style.cssText = 'position:fixed;inset:0;z-index:2147482000;pointer-events:none';
        const pad = 6;
        const ring = document.createElement('div');
        ring.dataset.demoAnillo = '';
        ring.style.cssText = `position:absolute;left:${caja.x - pad}px;top:${caja.y - pad}px;
            width:${caja.w + pad * 2}px;height:${caja.h + pad * 2}px;border:3px solid #f59e0b;border-radius:12px;
            box-shadow:0 0 0 9999px rgba(15,23,42,.28);transition:opacity .25s`;
        cont.appendChild(ring);
        document.body.appendChild(cont);
        if (!texto) return;

        const vw = document.documentElement.clientWidth, vh = window.innerHeight;
        const borde = 8;       // aire mínimo contra el borde de la pantalla
        const punta = 9;       // lo que sobresale la flecha
        const sep = pad + 3 + punta + 4;  // del objetivo al globo: anillo + flecha + aire
        const label = document.createElement('div');
        label.dataset.demoGlobo = '';
        label.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;
            max-width:${Math.min(420, vw - borde * 2)}px;width:max-content;background:#f59e0b;color:#1f2937;
            font-family:system-ui;font-size:16px;font-weight:600;line-height:1.3;padding:8px 14px;border-radius:10px;
            box-shadow:0 8px 24px -10px rgba(0,0,0,.5)`;
        label.textContent = texto;  // textContent = a prueba de XSS, no necesita escape
        cont.appendChild(label);
        const w = label.offsetWidth, h = label.offsetHeight;

        const t = { left: caja.x - pad, top: caja.y - pad, right: caja.x + caja.w + pad, bottom: caja.y + caja.h + pad };
        const cx = caja.x + caja.w / 2, cy = caja.y + caja.h / 2;
        const acotar = (v, min, max) => Math.max(min, Math.min(max, v));
        const posiciones = {
            arriba: () => ({ left: acotar(cx - w / 2, borde, vw - borde - w), top: t.top - sep + pad - h }),
            abajo: () => ({ left: acotar(cx - w / 2, borde, vw - borde - w), top: t.bottom + sep - pad }),
            derecha: () => ({ left: t.right + sep - pad, top: acotar(cy - h / 2, borde, vh - borde - h) }),
            izquierda: () => ({ left: t.left - sep + pad - w, top: acotar(cy - h / 2, borde, vh - borde - h) }),
        };
        const { cruza, ocupacion } = window.__demoMedidor;
        const ficha = document.getElementById('demo-lower-third')?.getBoundingClientRect();
        const candidatos = Object.entries(posiciones).map(([nombre, f], i) => {
            const p = f();
            const rect = { left: p.left, top: p.top, right: p.left + w, bottom: p.top + h };
            const cabe = rect.left >= borde - 0.5 && rect.top >= borde - 0.5
                && rect.right <= vw - borde + 0.5 && rect.bottom <= vh - borde + 0.5;
            return { nombre, i, rect, cabe, tapaObjetivo: cruza(rect, t), tapaFicha: !!ficha && cruza(rect, ficha),
                ocupa: cabe ? ocupacion(rect) : Infinity, pedido: nombre === lado };
        });
        const elegido = candidatos.sort((a, b) =>
            (b.cabe - a.cabe) || (a.tapaObjetivo - b.tapaObjetivo) || (b.pedido - a.pedido)
            || (a.tapaFicha - b.tapaFicha) || (a.ocupa - b.ocupa) || (a.i - b.i))[0];
        let { left, top } = elegido.rect;
        if (!elegido.cabe) {
            // No cabe de ningún lado (objetivo casi a pantalla completa): adentro de la pantalla
            // pesa más que no tocar el objetivo, porque un globo cortado no se lee.
            left = acotar(left, borde, vw - borde - w);
            top = acotar(top, borde, vh - borde - h);
        }
        label.style.left = left + 'px';
        label.style.top = top + 'px';
        label.style.visibility = 'visible';
        label.dataset.lado = elegido.nombre;

        // Flecha: un cuadrado girado del color del globo, en el borde que mira al objetivo y
        // alineado con el centro del objetivo (acotado para no salirse de las esquinas redondas).
        const flecha = document.createElement('div');
        flecha.dataset.demoFlecha = '';
        const s = punta * 2 * 0.7071;  // lado del cuadrado cuya diagonal/2 = punta
        let fx, fy;
        if (elegido.nombre === 'arriba' || elegido.nombre === 'abajo') {
            fx = acotar(cx - left, 16, w - 16) - s / 2;
            fy = elegido.nombre === 'arriba' ? h - s / 2 : -s / 2;
        } else {
            fy = acotar(cy - top, 14, h - 14) - s / 2;
            fx = elegido.nombre === 'izquierda' ? w - s / 2 : -s / 2;
        }
        flecha.style.cssText = `position:absolute;left:${fx}px;top:${fy}px;width:${s}px;height:${s}px;
            background:#f59e0b;transform:rotate(45deg);border-radius:2px`;
        // El texto va encima de la flecha: el cuadrado entra en el globo por la mitad.
        label.insertBefore(flecha, label.firstChild);
        label.style.overflow = 'visible';
        const textoEl = document.createElement('span');
        textoEl.style.cssText = 'position:relative';
        textoEl.textContent = texto;
        label.lastChild.remove();  // el nodo de texto original
        label.appendChild(textoEl);
    }, { sel: selector, texto: String(texto ?? ''), lado });

    if (!permanecer) {
        await page.waitForTimeout(esperaMs);
        await page.evaluate(() => document.getElementById('demo-anotacion')?.remove());
    }
}
