/**
 * Portadas de capítulo. Se dibujan sobre `about:blank` a propósito: una portada encima de
 * una pantalla con datos dejaría esos datos en los frames de transición.
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

const MIME_POR_EXTENSION = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
};

/**
 * Incrusta el escudo como `data:` URI. La portada se dibuja sobre `about:blank` (ver
 * arriba), y ahí una ruta de archivo relativa —o incluso absoluta— del sistema de archivos
 * NO carga: hay que llevar los bytes adentro del propio HTML. Si no viene ruta, el archivo
 * no existe o la extensión no se reconoce, devuelve `null` y la portada sigue funcionando
 * exactamente como sin escudo (degradación silenciosa a propósito: un escudo mal declarado
 * no debe tumbar la grabación).
 */
function escudoComoDataUri(ruta) {
    if (!ruta || !existsSync(ruta)) return null;
    const mime = MIME_POR_EXTENSION[extname(ruta).toLowerCase()];
    if (!mime) return null;
    return `data:${mime};base64,${readFileSync(ruta).toString('base64')}`;
}

/**
 * Portada de capítulo. `marca.escudo` es opcional: si viene y el archivo existe, se pinta
 * sobre el título a un tamaño que se lea sin dominar la pantalla.
 */
export async function portada(page, { titulo, subtitulo = '', capitulo = '', marca = {}, esperaMs = 2600 }) {
    await page.goto('about:blank');
    const escudo = escudoComoDataUri(marca.escudo);
    await page.evaluate(({ titulo, subtitulo, capitulo, marca, escudo }) => {
        const escape = (t) => {
            const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return String(t).replace(/[&<>"']/g, (c) => m[c]);
        };
        document.body.style.margin = '0';
        document.body.innerHTML = `
        <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
                    background:${marca.color ?? '#1e3a8a'};color:#fff;font-family:system-ui;text-align:center;gap:14px">
          ${escudo ? `<img src="${escudo}" alt="" style="height:96px;max-width:260px;object-fit:contain" />` : ''}
          ${capitulo ? `<div style="font-size:20px;letter-spacing:.28em;opacity:.75">CAPÍTULO ${escape(capitulo)}</div>` : ''}
          <h1 style="font-size:64px;margin:0;font-weight:700">${escape(titulo)}</h1>
          ${subtitulo ? `<p style="font-size:30px;margin:0;opacity:.9">${escape(subtitulo)}</p>` : ''}
          <div style="margin-top:26px;font-size:17px;opacity:.6">${escape(marca.nombre ?? '')}</div>
        </div>`;
    }, { titulo, subtitulo, capitulo, marca, escudo });
    await page.waitForTimeout(esperaMs);
}

/**
 * Cierre de capítulo, simétrico a `portada`: mismo criterio, se dibuja sobre `about:blank`,
 * nunca sobre datos, y pinta el mismo escudo si `marca.escudo` viene.
 */
export async function cierre(page, { mensaje, marca = {}, esperaMs = 2200 }) {
    await page.goto('about:blank');
    const escudo = escudoComoDataUri(marca.escudo);
    await page.evaluate(({ mensaje, marca, escudo }) => {
        const escape = (t) => {
            const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return String(t).replace(/[&<>"']/g, (c) => m[c]);
        };
        document.body.style.margin = '0';
        document.body.innerHTML = `
        <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
                    background:${marca.color ?? '#1e3a8a'};color:#fff;font-family:system-ui;text-align:center;gap:14px">
          ${escudo ? `<img src="${escudo}" alt="" style="height:72px;max-width:220px;object-fit:contain" />` : ''}
          <h1 style="font-size:48px;margin:0;font-weight:700">${escape(mensaje)}</h1>
          <div style="margin-top:26px;font-size:17px;opacity:.6">${escape(marca.nombre ?? '')}</div>
        </div>`;
    }, { mensaje, marca, escudo });
    await page.waitForTimeout(esperaMs);
}
