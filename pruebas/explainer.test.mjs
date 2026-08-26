import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { elenco, presentar, quitarPresentacion, anotar } from '../src/explainer.mjs';

// PNG 1x1 transparente, para probar la incrustación de la foto sin depender de un asset.
const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

test('elenco pinta a cada personaje con nombre, rol y la foto incrustada', async () => {
    // La foto va DENTRO del proyecto: assets.mjs confina las lecturas al cwd (como en la vida real).
    const foto = join(process.cwd(), 'pruebas', 'tmp-carlos.png');
    writeFileSync(foto, PNG_1x1);
    const navegador = await chromium.launch();
    const page = await (await navegador.newContext()).newPage();
    try {
        await elenco(page, {
            cast: [
                { nombre: 'Carlos', rol: 'Vecino', foto },
                { nombre: 'Paula', rol: 'Funcionaria de mesón' }, // sin foto: cae a la inicial
            ],
            esperaMs: 0,
        });
        const texto = await page.locator('body').innerText();
        assert.match(texto, /Carlos/);
        assert.match(texto, /Paula/);
        assert.match(texto, /Vecino/);
        // La foto de Carlos quedó incrustada como data: URI; Paula sin foto muestra "P".
        assert.equal(await page.locator('img[src^="data:image/png"]').count(), 1);
        assert.match(texto, /P\b/);
    } finally {
        await navegador.close();
        rmSync(foto, { force: true });
    }
});

test('presentar pone el lower-third y quitarPresentacion lo saca', async () => {
    const navegador = await chromium.launch();
    const page = await (await navegador.newContext()).newPage();
    try {
        await page.goto('about:blank');
        await presentar(page, { nombre: 'Paula', rol: 'Funcionaria de mesón' });
        assert.equal(await page.locator('#demo-lower-third').count(), 1);
        assert.match(await page.locator('#demo-lower-third').innerText(), /Paula/);
        // Llamarla de nuevo reemplaza, no duplica.
        await presentar(page, { nombre: 'Diego', rol: 'Coordinador' });
        assert.equal(await page.locator('#demo-lower-third').count(), 1);
        assert.match(await page.locator('#demo-lower-third').innerText(), /Diego/);
        await quitarPresentacion(page);
        assert.equal(await page.locator('#demo-lower-third').count(), 0);
    } finally {
        await navegador.close();
    }
});

test('anotar resalta un elemento con su etiqueta, y degrada si el elemento no existe', async () => {
    const navegador = await chromium.launch();
    const page = await (await navegador.newContext()).newPage();
    try {
        await page.setContent('<button id="x" style="margin:220px">Resolver</button>');
        await anotar(page, '#x', 'Acá se resuelve', { permanecer: true });
        assert.equal(await page.locator('#demo-anotacion').count(), 1);
        assert.match(await page.locator('#demo-anotacion').innerText(), /Acá se resuelve/);
        // Elemento inexistente: no rompe y no deja nada nuevo.
        await anotar(page, '#no-existe', 'nada', { permanecer: true });
        assert.equal(await page.locator('#demo-anotacion').count(), 1);
    } finally {
        await navegador.close();
    }
});
