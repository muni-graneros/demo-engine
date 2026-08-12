/**
 * Portadas de capítulo. Se dibujan sobre `about:blank` a propósito: una portada encima de
 * una pantalla con datos dejaría esos datos en los frames de transición.
 */
export async function portada(page, { titulo, subtitulo = '', capitulo = '', marca = {}, esperaMs = 2600 }) {
    await page.goto('about:blank');
    await page.evaluate(({ titulo, subtitulo, capitulo, marca }) => {
        const escape = (t) => {
            const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
            return String(t).replace(/[&<>"']/g, (c) => m[c]);
        };
        document.body.style.margin = '0';
        document.body.innerHTML = `
        <div style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
                    background:${marca.color ?? '#1e3a8a'};color:#fff;font-family:system-ui;text-align:center;gap:14px">
          ${capitulo ? `<div style="font-size:20px;letter-spacing:.28em;opacity:.75">CAPÍTULO ${escape(capitulo)}</div>` : ''}
          <h1 style="font-size:64px;margin:0;font-weight:700">${escape(titulo)}</h1>
          ${subtitulo ? `<p style="font-size:30px;margin:0;opacity:.9">${escape(subtitulo)}</p>` : ''}
          <div style="margin-top:26px;font-size:17px;opacity:.6">${escape(marca.nombre ?? '')}</div>
        </div>`;
    }, { titulo, subtitulo, capitulo, marca });
    await page.waitForTimeout(esperaMs);
}
