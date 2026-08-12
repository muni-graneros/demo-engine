import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { exigirEntornoDeDesarrollo, abrirFiltrado, cubrir } from '../src/privacidad.mjs';

test('aborta si el entorno no es de desarrollo', () => {
    assert.throws(() => exigirEntornoDeDesarrollo({ APP_ENV: 'production' }), /producción/i);
    assert.doesNotThrow(() => exigirEntornoDeDesarrollo({ APP_ENV: 'local' }));
    assert.doesNotThrow(() => exigirEntornoDeDesarrollo({ APP_ENV: 'production', DEMO_FORZAR: '1' }));
});

test('la tabla nunca queda visible sin filtrar: el cubridor está desde el primer frame', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ storageState: { cookies: [
        { name: 'sesion', value: 'funcionario', domain: '127.0.0.1', path: '/' },
    ], origins: [] } });
    const page = await ctx.newPage();
    try {
        const visibles = [];
        // Espía: en cada paso registra si la tabla estaba destapada y cuántas filas había.
        const mirar = async () => visibles.push(await page.evaluate(() => ({
            tapada: !!document.getElementById('__cubridor'),
            filas: document.querySelectorAll('tr.fila').length,
        })));

        await abrirFiltrado(page, `${juguete.url}/panel`, {
            filtro: '#filtro', valor: '11111111-1', selectorFilas: 'tr.fila', alPintar: mirar,
        });

        const destapadaConMuchasFilas = visibles.some((v) => !v.tapada && v.filas > 1);
        assert.equal(destapadaConMuchasFilas, false,
            'hubo un instante con la tabla destapada y más de una fila: eso es una fuga');
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
});

test('si el filtro no reduce a una fila, falla en vez de grabar', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ storageState: { cookies: [
        { name: 'sesion', value: 'funcionario', domain: '127.0.0.1', path: '/' },
    ], origins: [] } });
    const page = await ctx.newPage();
    try {
        await assert.rejects(() => abrirFiltrado(page, `${juguete.url}/panel`, {
            filtro: '#filtro', valor: '', selectorFilas: 'tr.fila',
        }), /no redujo/);
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
});
