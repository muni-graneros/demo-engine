import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { portada } from '../src/rotulos.mjs';

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
