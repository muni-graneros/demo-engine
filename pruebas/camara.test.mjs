import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { instalarCursor, moverCursorA, pulsar, acercarA, alejar } from '../src/camara.mjs';

async function conPagina(fn) {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const page = await navegador.newPage();
    try {
        await page.goto(`${juguete.url}/`);
        await instalarCursor(page);
        await fn(page);
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
}

test('el cursor existe y queda encima de todo', async () => {
    await conPagina(async (page) => {
        const z = await page.evaluate(() => {
            const c = document.getElementById('__cursor');
            return c ? Number(getComputedStyle(c).zIndex) : null;
        });
        assert.ok(z !== null, 'no se instaló el cursor');
        assert.ok(z > 1000, `el cursor debe ir sobre el contenido, z-index=${z}`);
    });
});

test('el cursor se para sobre el centro del elemento indicado', async () => {
    await conPagina(async (page) => {
        await moverCursorA(page, '#entrar');
        const { cursor, boton } = await page.evaluate(() => {
            const c = document.getElementById('__cursor').getBoundingClientRect();
            const b = document.getElementById('entrar').getBoundingClientRect();
            return { cursor: { x: c.left, y: c.top }, boton: { x: b.x + b.width / 2, y: b.y + b.height / 2 } };
        });
        assert.ok(Math.abs(cursor.x - boton.x) < 6, `x: ${cursor.x} vs ${boton.x}`);
        assert.ok(Math.abs(cursor.y - boton.y) < 6, `y: ${cursor.y} vs ${boton.y}`);
    });
});

test('pulsar deja un halo y de verdad hace clic', async () => {
    await conPagina(async (page) => {
        await page.evaluate(() => {
            document.getElementById('entrar').addEventListener('click', (e) => {
                e.preventDefault();
                document.title = 'pulsado';
            });
        });
        const halos = [];
        await pulsar(page, '#entrar', {
            alPintar: async () => halos.push(await page.evaluate(() => !!document.querySelector('.__halo'))),
        });
        assert.equal(await page.title(), 'pulsado', 'el clic real no ocurrió');
        assert.ok(halos.includes(true), 'nunca se dibujó el halo');
    });
});

test('acercar aplica una transformación y alejar la deja limpia', async () => {
    await conPagina(async (page) => {
        await acercarA(page, '#entrar', { escala: 1.8 });
        const conZoom = await page.evaluate(() => getComputedStyle(document.documentElement).transform);
        assert.notEqual(conZoom, 'none', 'no se aplicó el zoom');

        await alejar(page);
        const sinZoom = await page.evaluate(() => getComputedStyle(document.documentElement).transform);
        assert.ok(sinZoom === 'none' || sinZoom === 'matrix(1, 0, 0, 1, 0, 0)', `quedó ${sinZoom}`);
    });
});
