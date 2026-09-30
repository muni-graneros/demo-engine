import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conPagina } from '../src/render-web.mjs';

test('sirve un archivo local y lo deja leer desde la página', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-web-'));
    const txt = join(dir, 'dato.txt');
    writeFileSync(txt, 'hola');

    const leido = await conPagina({ '/dato.txt': txt }, async (page) => {
        return page.evaluate(async () => (await fetch('/dato.txt')).text());
    });
    assert.equal(leido, 'hola');
});

test('sirve three desde node_modules, sin CDN', async () => {
    const ok = await conPagina({}, async (page) => {
        return page.evaluate(async () => {
            const m = await import('/three.module.js');
            return typeof m.Scene === 'function' && typeof m.VideoTexture === 'function';
        });
    });
    assert.equal(ok, true);
});

test('cierra el servidor al terminar', async () => {
    let base = null;
    await conPagina({}, async (_page, baseUrl) => { base = baseUrl; });
    await assert.rejects(fetch(base + '/'), /fetch failed|ECONNREFUSED/);
});
