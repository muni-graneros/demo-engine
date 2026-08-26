import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright';

const MIME_POR_EXTENSION = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};

/** Incrusta una imagen como `data:` URI (portada y elenco); degrada a null si no está. */
function imagenComoDataUri(ruta) {
    if (!ruta || !existsSync(ruta)) return null;
    const mime = MIME_POR_EXTENSION[extname(ruta).toLowerCase()];
    if (!mime) return null;
    return `data:${mime};base64,${readFileSync(ruta).toString('base64')}`;
}

const escape = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const hoja = (color) => `
  @page { margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", system-ui, sans-serif; color:#1f2937; line-height:1.6;
         max-width:820px; margin:0 auto; padding:0; }
  /* Portada */
  .portada { min-height:250mm; display:flex; flex-direction:column; align-items:center; justify-content:center;
             text-align:center; gap:16px; page-break-after:always; }
  .portada .escudo { height:120px; max-width:280px; object-fit:contain; margin-bottom:8px }
  .portada h1 { border:0; font-size:40px; color:#0f172a; margin:0; line-height:1.15 }
  .portada .sub { font-size:20px; color:#475569; margin:0; max-width:60ch }
  .portada .marca { margin-top:auto; font-size:14px; color:#94a3b8; letter-spacing:.04em; text-transform:uppercase }
  .portada .rol { display:inline-block; background:${color}; color:#fff; font-size:14px; font-weight:600;
                  padding:6px 16px; border-radius:999px; margin-top:6px }
  /* Elenco */
  .elenco { page-break-after:always; padding-top:20px }
  .elenco h2 { border:0; margin:0 0 22px; color:${color}; font-size:24px }
  .cast { display:flex; flex-wrap:wrap; gap:26px; justify-content:center }
  .cast figure { margin:0; width:180px; text-align:center }
  .cast .foto { width:96px; height:96px; border-radius:50%; overflow:hidden; margin:0 auto 10px;
                background:${color}; display:flex; align-items:center; justify-content:center; color:#fff;
                font-size:40px; font-weight:700 }
  .cast .foto img { width:100%; height:100%; object-fit:cover }
  .cast figcaption .nom { font-weight:700; font-size:17px; color:#0f172a }
  .cast figcaption .rol { font-size:14px; color:#64748b }
  /* Cuerpo */
  .cuerpo h1 { display:none }
  .cuerpo h2 { color:${color}; border-top:1px solid #e5e7eb; padding-top:18px; margin-top:30px; font-size:22px;
               page-break-after:avoid }
  .cuerpo p { margin:8px 0 }
  .cuerpo img { max-width:100%; border:1px solid #e5e7eb; border-radius:10px; margin:12px 0;
                box-shadow:0 4px 14px -8px rgba(0,0,0,.25); page-break-inside:avoid }
  .cuerpo .actor { display:inline-block; font-size:11px; text-transform:uppercase; letter-spacing:.05em;
                   background:${color}1a; color:${color}; border-radius:6px; padding:3px 10px; font-weight:600 }
`;

/**
 * Genera el manual a partir de los MISMOS pasos que produjeron el video: portada con marca,
 * una página con el elenco (si el guion lo declara en `guion.elenco`), y una sección por
 * escena con su narración y su captura. Sale un `.md`, un `.html` y un `.pdf`.
 *
 * `guion.elenco` (opcional): `[{ nombre, rol, foto }]`. `guion.subtitulo` (opcional): bajada.
 */
export async function generarManual({ guion, pasos, marca = {} }, { salida }) {
    mkdirSync(salida, { recursive: true });
    const color = marca.color ?? '#1e3a8a';

    // Cuerpo en markdown: una sección por escena, igual que antes.
    const secciones = [];
    let escenaActual = null;
    for (const paso of pasos) {
        if (paso.escena !== escenaActual) {
            secciones.push(`\n## ${paso.titulo}\n`);
            escenaActual = paso.escena;
        }
        secciones.push(`<span class="actor">${escape(paso.actor)}</span>\n`);
        if (paso.narrar) secciones.push(`\n${paso.narrar}\n`);
        if (paso.captura) secciones.push(`\n![${escape(paso.titulo)}](${paso.captura})\n`);
    }
    const cuerpoMd = `# ${guion.titulo}\n${secciones.join('')}`;
    const md = resolve(salida, `${guion.id}.md`);
    writeFileSync(md, cuerpoMd);

    // Portada con marca.
    const escudo = imagenComoDataUri(marca.escudo);
    const portada = `
      <section class="portada">
        ${escudo ? `<img class="escudo" src="${escudo}" alt="" />` : ''}
        <h1>${escape(guion.titulo)}</h1>
        ${guion.subtitulo ? `<p class="sub">${escape(guion.subtitulo)}</p>` : ''}
        ${guion.rol ? `<div class="rol">${escape(guion.rol)}</div>` : ''}
        <div class="marca">${escape(marca.nombre ?? '')}</div>
      </section>`;

    // Página del elenco (si viene).
    const cast = Array.isArray(guion.elenco) ? guion.elenco : [];
    const elenco = cast.length ? `
      <section class="elenco">
        <h2>Quiénes aparecen</h2>
        <div class="cast">${cast.map((p) => {
            const foto = imagenComoDataUri(p.foto);
            const inicial = escape((String(p.nombre ?? '').trim()[0] || '?').toUpperCase());
            return `<figure>
              <div class="foto">${foto ? `<img src="${foto}" alt="" />` : inicial}</div>
              <figcaption><div class="nom">${escape(p.nombre)}</div><div class="rol">${escape(p.rol ?? '')}</div></figcaption>
            </figure>`;
        }).join('')}</div>
      </section>` : '';

    const html = resolve(salida, `${guion.id}.html`);
    writeFileSync(html, `<!doctype html><html lang="es"><head><meta charset="utf-8">
        <title>${escape(guion.titulo)}</title><style>${hoja(color)}</style></head>
        <body>${portada}${elenco}<div class="cuerpo">${marked.parse(cuerpoMd)}</div></body></html>`);

    const pdf = resolve(salida, `${guion.id}.pdf`);
    const navegador = await chromium.launch();
    try {
        const page = await navegador.newPage();
        await page.goto(`file://${html}`, { waitUntil: 'networkidle' });
        await page.pdf({ path: pdf, format: 'A4', printBackground: true,
            margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } });
    } finally {
        await navegador.close();
    }

    return { md, html, pdf };
}
