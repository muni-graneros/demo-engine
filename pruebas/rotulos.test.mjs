import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { portada, cierre } from '../src/rotulos.mjs';

// PNG 1x1 real (no un archivo vacío): así el test ejercita la ruta de lectura+codificación
// tal como pasaría con un escudo institucional de verdad.
const PNG_1X1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

// El escudo va DENTRO del proyecto: assets.mjs confina las lecturas al cwd (como en la vida
// real, donde el escudo institucional vive en el repo). Un tmpdir quedaría fuera y daría null.
const RUTA_ESCUDO = join(process.cwd(), 'pruebas', 'tmp-escudo.png');
function escudoDePrueba() {
    writeFileSync(RUTA_ESCUDO, PNG_1X1);
    return RUTA_ESCUDO;
}
after(() => rmSync(RUTA_ESCUDO, { force: true }));

test('la portada se dibuja sobre about:blank, nunca sobre datos', async () => {
    const navegador = await chromium.launch();
    const page = await navegador.newPage();
    try {
        await page.goto('https://example.com');
        await portada(page, { titulo: 'Capítulo 2', subtitulo: 'El municipio revisa',
            capitulo: '2', marca: { nombre: 'Sistema', color: '#1e3a8a' }, esperaMs: 10 });
        assert.equal(page.url(), 'about:blank', 'la portada debe navegar a about:blank primero');
        assert.match(await page.textContent('body'), /El municipio revisa/);
    } finally {
        await navegador.close();
    }
});

test('el cierre se dibuja sobre about:blank, nunca sobre datos, simétrico a la portada', async () => {
    const navegador = await chromium.launch();
    const page = await navegador.newPage();
    try {
        await page.goto('https://example.com');
        await cierre(page, { mensaje: 'Gracias por ver el recorrido',
            marca: { nombre: 'Sistema', color: '#1e3a8a' }, esperaMs: 10 });
        assert.equal(page.url(), 'about:blank', 'el cierre debe navegar a about:blank primero');
        assert.match(await page.textContent('body'), /Gracias por ver el recorrido/);
        assert.match(await page.textContent('body'), /Sistema/);
    } finally {
        await navegador.close();
    }
});

test('la portada dibuja el escudo cuando marca.escudo existe: se incrusta como data: URI porque about:blank no carga rutas de archivo', async () => {
    const navegador = await chromium.launch();
    const page = await navegador.newPage();
    try {
        await portada(page, { titulo: 'Capítulo 2', marca: { nombre: 'Sistema', escudo: escudoDePrueba() }, esperaMs: 10 });
        const src = await page.getAttribute('img', 'src');
        assert.ok(src, 'la portada debe traer un <img> cuando marca.escudo existe');
        assert.match(src, /^data:image\/png;base64,/, 'el escudo debe incrustarse como data: URI, no como ruta de archivo');
    } finally {
        await navegador.close();
    }
});

test('la portada sigue igual que hoy si marca.escudo no viene o el archivo no existe', async () => {
    const navegador = await chromium.launch();
    const page = await navegador.newPage();
    try {
        await portada(page, { titulo: 'Sin escudo', marca: { nombre: 'Sistema' }, esperaMs: 10 });
        assert.equal(await page.locator('img').count(), 0, 'sin marca.escudo no debe haber <img>');

        await portada(page, { titulo: 'Escudo inexistente', marca: { nombre: 'Sistema', escudo: '/no/existe.png' }, esperaMs: 10 });
        assert.equal(await page.locator('img').count(), 0, 'un escudo que no existe no debe reventar ni dibujarse');
        assert.match(await page.textContent('body'), /Escudo inexistente/, 'la portada debe seguir funcionando igual');
    } finally {
        await navegador.close();
    }
});

test('el cierre también dibuja el escudo cuando marca.escudo existe, simétrico a la portada', async () => {
    const navegador = await chromium.launch();
    const page = await navegador.newPage();
    try {
        await cierre(page, { mensaje: 'Gracias', marca: { nombre: 'Sistema', escudo: escudoDePrueba() }, esperaMs: 10 });
        const src = await page.getAttribute('img', 'src');
        assert.match(src, /^data:image\/png;base64,/);
    } finally {
        await navegador.close();
    }
});
