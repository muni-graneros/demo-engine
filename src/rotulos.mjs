/**
 * Portadas de capítulo. Se dibujan sobre `about:blank` a propósito: una portada encima de
 * una pantalla con datos dejaría esos datos en los frames de transición.
 */

import { imagenComoDataUri } from './assets.mjs';

// El escudo se incrusta como `data:` URI (la portada se dibuja sobre `about:blank`, donde una
// ruta de archivo no carga) y CONFINADO al proyecto (ver `assets.mjs`). Un escudo ausente, mal
// declarado o fuera del proyecto devuelve null y la portada sigue igual, sin escudo.
const escudoComoDataUri = imagenComoDataUri;

/**
 * Atributo con el que una portada o un cierre se declaran «plano»: una tarjeta del video y no
 * una página del sistema. El grabador lo lee al terminar cada paso (`esPlano`) y el montaje
 * saca ese tramo a pantalla completa, sin la ventana del navegador, la barra con la URL ni el
 * chip de la superficie (con marco parecía una página más del sistema). Vive en el DOM y no en
 * una variable del motor a propósito: una navegación lo borra sola, así que un paso que pone
 * la portada y después abre el sistema ya no cuenta como plano.
 */
const ATRIBUTO_PLANO = 'data-demo-plano';

/** 'portada' | 'cierre' si la página muestra un rótulo plano, o null. Nunca falla. */
export async function esPlano(page) {
    return page.evaluate((a) => document.documentElement?.getAttribute(a) || null, ATRIBUTO_PLANO).catch(() => null);
}

/**
 * Portada de capítulo. `marca.escudo` es opcional: si viene y el archivo existe, se pinta
 * sobre el título a un tamaño que se lea sin dominar la pantalla.
 */
export async function portada(page, { titulo, subtitulo = '', capitulo = '', marca = {}, esperaMs = 2600 }) {
    await page.goto('about:blank');
    const escudo = escudoComoDataUri(marca.escudo);
    await page.evaluate(({ titulo, subtitulo, capitulo, marca, escudo, atributo }) => {
        const escape = (t) => {
            const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return String(t).replace(/[&<>"']/g, (c) => m[c]);
        };
        document.body.style.margin = '0';
        document.documentElement.setAttribute(atributo, 'portada');
        document.body.innerHTML = `
        <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
                    background:${marca.color ?? '#1e3a8a'};color:#fff;font-family:system-ui;text-align:center;gap:14px">
          ${escudo ? `<img src="${escudo}" alt="" style="height:96px;max-width:260px;object-fit:contain" />` : ''}
          ${capitulo ? `<div style="font-size:20px;letter-spacing:.28em;opacity:.75">CAPÍTULO ${escape(capitulo)}</div>` : ''}
          <h1 style="font-size:64px;margin:0;font-weight:700">${escape(titulo)}</h1>
          ${subtitulo ? `<p style="font-size:30px;margin:0;opacity:.9">${escape(subtitulo)}</p>` : ''}
          <div style="margin-top:26px;font-size:17px;opacity:.6">${escape(marca.nombre ?? '')}</div>
        </div>`;
    }, { titulo, subtitulo, capitulo, marca, escudo, atributo: ATRIBUTO_PLANO });
    await page.waitForTimeout(esperaMs);
}

/**
 * Cierre de capítulo, simétrico a `portada`: mismo criterio, se dibuja sobre `about:blank`,
 * nunca sobre datos, y pinta el mismo escudo si `marca.escudo` viene.
 */
export async function cierre(page, { mensaje, marca = {}, esperaMs = 2200 }) {
    await page.goto('about:blank');
    const escudo = escudoComoDataUri(marca.escudo);
    await page.evaluate(({ mensaje, marca, escudo, atributo }) => {
        const escape = (t) => {
            const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return String(t).replace(/[&<>"']/g, (c) => m[c]);
        };
        document.body.style.margin = '0';
        document.documentElement.setAttribute(atributo, 'cierre');
        document.body.innerHTML = `
        <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
                    background:${marca.color ?? '#1e3a8a'};color:#fff;font-family:system-ui;text-align:center;gap:14px">
          ${escudo ? `<img src="${escudo}" alt="" style="height:72px;max-width:220px;object-fit:contain" />` : ''}
          <h1 style="font-size:48px;margin:0;font-weight:700">${escape(mensaje)}</h1>
          <div style="margin-top:26px;font-size:17px;opacity:.6">${escape(marca.nombre ?? '')}</div>
        </div>`;
    }, { mensaje, marca, escudo, atributo: ATRIBUTO_PLANO });
    await page.waitForTimeout(esperaMs);
}
