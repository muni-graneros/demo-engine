import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { extname, dirname, join } from 'node:path';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);

const TIPOS = {
    '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html',
};

/**
 * Abre una página de Chromium con `archivos` servidos por HTTP local y ejecuta `tarea`.
 *
 * El servidor no es un lujo: Chromium rechaza cargar un `<video src="file://...">` con
 * `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`, así que el MP4 tiene que
 * viajar por HTTP sí o sí. Y `three` se sirve desde `node_modules` en vez de un CDN porque
 * el motor tiene que funcionar sin red.
 *
 * @param {Record<string,string>} archivos mapa `/ruta-en-la-web` → ruta en disco
 * @param {(page: import('playwright').Page, baseUrl: string) => Promise<any>} tarea
 */
export async function conPagina(archivos, tarea) {
    const three = require.resolve('three');
    const dirThree = join(dirname(three), '..');
    const dirBuildThree = join(dirThree, 'build');
    const mapa = { ...archivos, '/three.module.js': join(dirBuildThree, 'three.module.js') };

    const servidor = createServer((req, res) => {
        const ruta = req.url.split('?')[0];
        if (ruta === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end('<!doctype html><html><body style="margin:0"></body></html>');
        }
        let archivo = mapa[ruta];
        // Si la ruta no está en el mapa y es un archivo de three, intenta servirlo desde el directorio build
        if (!archivo && ruta.startsWith('/three.')) {
            archivo = join(dirBuildThree, ruta.substring(1));
        }
        if (!archivo) { res.writeHead(404); return res.end(); }
        const cuerpo = readFileSync(archivo);
        res.writeHead(200, {
            'Content-Type': TIPOS[extname(archivo)] ?? 'application/octet-stream',
            'Content-Length': cuerpo.length,
            'Accept-Ranges': 'bytes',
        });
        res.end(cuerpo);
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    const baseUrl = `http://127.0.0.1:${servidor.address().port}`;

    const navegador = await chromium.launch();
    try {
        const page = await navegador.newPage();
        await page.goto(baseUrl + '/');
        return await tarea(page, baseUrl);
    } finally {
        await navegador.close();
        await new Promise((ok) => servidor.close(ok));
    }
}
