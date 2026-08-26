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

import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

const MIME_POR_EXTENSION = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
};

function imagenComoDataUri(ruta) {
    if (!ruta || !existsSync(ruta)) return null;
    const mime = MIME_POR_EXTENSION[extname(ruta).toLowerCase()];
    if (!mime) return null;
    return `data:${mime};base64,${readFileSync(ruta).toString('base64')}`;
}

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
 * Lower-third del personaje que está actuando: una tarjeta fija abajo a la izquierda con su
 * foto, nombre y rol, SOBRE la pantalla del sistema (no borra lo que hay debajo). Se queda
 * hasta que la página navegue o hasta `quitarPresentacion`. Para saber quién opera en cada
 * momento, como en un explainer.
 */
export async function presentar(page, { nombre, rol = '', foto, esperaMs = 0 }) {
    const dataUri = imagenComoDataUri(foto);
    await page.evaluate(({ nombre, rol, dataUri }) => {
        const escape = (t) => {
            const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return String(t).replace(/[&<>"']/g, (c) => m[c]);
        };
        document.getElementById('demo-lower-third')?.remove();
        const inicial = escape((String(nombre).trim()[0] || '?').toUpperCase());
        const el = document.createElement('div');
        el.id = 'demo-lower-third';
        el.style.cssText = `position:fixed;left:28px;bottom:28px;z-index:2147483000;display:flex;align-items:center;
            gap:14px;padding:12px 20px 12px 12px;border-radius:16px;background:rgba(15,23,42,.92);color:#fff;
            font-family:system-ui;box-shadow:0 12px 40px -12px rgba(0,0,0,.6);opacity:0;transition:opacity .35s`;
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
        requestAnimationFrame(() => { el.style.opacity = '1'; });
    }, { nombre: String(nombre ?? ''), rol, dataUri });
    if (esperaMs > 0) await page.waitForTimeout(esperaMs);
}

/** Quita el lower-third puesto por `presentar` (si sigue en pantalla). */
export async function quitarPresentacion(page) {
    await page.evaluate(() => document.getElementById('demo-lower-third')?.remove());
}

/**
 * Anota/resalta un elemento: le dibuja un anillo y una etiqueta que lo apunta, para dirigir
 * la mirada ("acá está el plazo legal"). Si el elemento no está, no hace nada (degrada). La
 * anotación se quita sola tras `esperaMs`, salvo `permanecer: true`.
 */
export async function anotar(page, selector, texto, { esperaMs = 2200, permanecer = false } = {}) {
    const caja = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, selector).catch(() => null);
    if (!caja) return;

    await page.evaluate(({ caja, texto }) => {
        document.getElementById('demo-anotacion')?.remove();
        const cont = document.createElement('div');
        cont.id = 'demo-anotacion';
        cont.style.cssText = 'position:fixed;inset:0;z-index:2147482000;pointer-events:none';
        const pad = 6;
        const ring = document.createElement('div');
        ring.style.cssText = `position:absolute;left:${caja.x - pad}px;top:${caja.y - pad}px;
            width:${caja.w + pad * 2}px;height:${caja.h + pad * 2}px;border:3px solid #f59e0b;border-radius:12px;
            box-shadow:0 0 0 9999px rgba(15,23,42,.28);transition:opacity .25s`;
        cont.appendChild(ring);
        if (texto) {
            const label = document.createElement('div');
            const arriba = caja.y > 120;
            label.style.cssText = `position:absolute;left:${caja.x - pad}px;
                ${arriba ? `top:${caja.y - pad - 44}px` : `top:${caja.y + caja.h + pad + 12}px`};
                max-width:${Math.max(220, caja.w)}px;background:#f59e0b;color:#1f2937;font-family:system-ui;
                font-size:16px;font-weight:600;padding:8px 14px;border-radius:10px;
                box-shadow:0 8px 24px -10px rgba(0,0,0,.5)`;
            label.textContent = texto;  // textContent = a prueba de XSS, no necesita escape
            cont.appendChild(label);
        }
        document.body.appendChild(cont);
    }, { caja, texto: String(texto ?? '') });

    if (!permanecer) {
        await page.waitForTimeout(esperaMs);
        await page.evaluate(() => document.getElementById('demo-anotacion')?.remove());
    }
}
