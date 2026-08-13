import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { marked } from 'marked';
import { chromium } from 'playwright';

const hoja = (color) => `
  body { font-family: system-ui, sans-serif; color:#1e293b; line-height:1.55; max-width:820px;
         margin:0 auto; padding:24px; }
  h1 { color:#0f172a; font-size:28px; margin:0 0 8px; border-bottom:2px solid #e2e8f0; padding-bottom:8px }
  h2 { color:${color}; border-top:1px dashed #e2e8f0; padding-top:18px; margin-top:34px; font-size:22px;
       page-break-after:avoid }
  img { max-width:100%; border:1px solid #e2e8f0; border-radius:8px; margin:12px 0; page-break-inside:avoid }
  .actor { display:inline-block; font-size:11px; text-transform:uppercase; letter-spacing:.04em;
           background:#eff6ff; color:#1d4ed8; border-radius:6px; padding:2px 8px }
`;

/**
 * Genera el manual a partir de los MISMOS pasos que produjeron el video: una sección por
 * escena, con su narración y su captura.
 */
export async function generarManual({ guion, pasos, marca = {} }, { salida }) {
    mkdirSync(salida, { recursive: true });

    const secciones = [];
    let escenaActual = null;
    for (const paso of pasos) {
        if (paso.escena !== escenaActual) {
            secciones.push(`\n## ${paso.titulo}\n`);
            escenaActual = paso.escena;
        }
        secciones.push(`<span class="actor">${paso.actor}</span>\n`);
        if (paso.narrar) secciones.push(`\n${paso.narrar}\n`);
        if (paso.captura) secciones.push(`\n![${paso.titulo}](${paso.captura})\n`);
    }

    const cuerpo = `# ${guion.titulo}\n${secciones.join('')}`;
    const md = resolve(salida, `${guion.id}.md`);
    writeFileSync(md, cuerpo);

    const html = resolve(salida, `${guion.id}.html`);
    writeFileSync(html, `<!doctype html><html lang="es"><head><meta charset="utf-8">
        <title>${guion.titulo}</title><style>${hoja(marca.color ?? '#1e3a8a')}</style></head>
        <body>${marked.parse(cuerpo)}</body></html>`);

    const pdf = resolve(salida, `${guion.id}.pdf`);
    const navegador = await chromium.launch();
    try {
        const page = await navegador.newPage();
        await page.goto(`file://${html}`, { waitUntil: 'networkidle' });
        await page.pdf({ path: pdf, format: 'A4', printBackground: true,
            margin: { top: '18mm', bottom: '18mm', left: '14mm', right: '14mm' } });
    } finally {
        await navegador.close();
    }

    return { md, html, pdf };
}
