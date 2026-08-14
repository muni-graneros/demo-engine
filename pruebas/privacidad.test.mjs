import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { exigirEntornoDeDesarrollo, abrirFiltrado, abrirVerificado, cubrir, descubrir } from '../src/privacidad.mjs';

/** Solo los "Turno Demo N" están permitidos en la cola de atención de juguete. */
const esPermitido = (nombre) => /^Turno Demo \d+$/.test(nombre);

test('aborta si el entorno no es de desarrollo', () => {
    // Falla CERRADO: sin APP_ENV, manda el host de baseURL.
    assert.throws(() => exigirEntornoDeDesarrollo('https://licencias.graneros.cl', {}), /no es una dirección local/);
    assert.throws(() => exigirEntornoDeDesarrollo('http://localhost:8031', { APP_ENV: 'production' }), /APP_ENV/);

    assert.doesNotThrow(() => exigirEntornoDeDesarrollo('http://localhost:8031', {}));
    assert.doesNotThrow(() => exigirEntornoDeDesarrollo('http://127.0.0.1:9000', {}));
    assert.doesNotThrow(() => exigirEntornoDeDesarrollo('https://192.168.1.40:8443', {}));
    assert.doesNotThrow(() => exigirEntornoDeDesarrollo('https://licencias-graneros.lan', {}));

    // El escape explícito sigue existiendo, pero hay que pedirlo.
    assert.doesNotThrow(() => exigirEntornoDeDesarrollo('https://licencias.graneros.cl', { DEMO_FORZAR: '1' }));
});

test('sin APP_ENV y contra un host público, NO graba (falla cerrado)', () => {
    assert.throws(() => exigirEntornoDeDesarrollo('https://ejemplo.cl', { HOME: '/home/x' }),
        /no es una dirección local/);
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

test('cubrir sobrevive a una navegación: el cubridor sigue puesto tras goto()', async () => {
    // Repro del defecto crítico #1: cubrir() inyecta el div en el documento actual, pero
    // una navegación destruye ese DOM. Si el mecanismo es correcto, el cubridor debe
    // reaparecer SOLO por haber llamado cubrir() una vez, sin volver a llamarlo tras goto().
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ storageState: { cookies: [
        { name: 'sesion', value: 'funcionario', domain: '127.0.0.1', path: '/' },
    ], origins: [] } });
    const page = await ctx.newPage();
    try {
        await cubrir(page);
        await page.goto(`${juguete.url}/panel`, { waitUntil: 'domcontentloaded' });

        const estado = await page.evaluate(() => ({
            tapada: !!document.getElementById('__cubridor'),
            filas: document.querySelectorAll('tr.fila').length,
        }));
        assert.equal(estado.filas > 0, true, 'el panel debe traer filas reales para que el test tenga sentido');
        assert.equal(estado.tapada, true,
            'el cubridor no sobrevivió a la navegación: la tabla completa quedó a la vista');

        // Y debe seguir sobreviviendo a una SEGUNDA navegación, no solo a la primera.
        await page.goto(`${juguete.url}/detalle/11111111-1`, { waitUntil: 'domcontentloaded' });
        const tapadaOtraVez = await page.evaluate(() => !!document.getElementById('__cubridor'));
        assert.equal(tapadaOtraVez, true, 'el cubridor debe seguir puesto tras una segunda navegación');

        // descubrir() debe apagar la protección también para navegaciones FUTURAS, no solo
        // borrar el div actual.
        await descubrir(page);
        await page.goto(`${juguete.url}/panel`, { waitUntil: 'domcontentloaded' });
        const tapadaTrasDescubrir = await page.evaluate(() => !!document.getElementById('__cubridor'));
        assert.equal(tapadaTrasDescubrir, false,
            'descubrir() debe dejar de tapar incluso en navegaciones posteriores');
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
});

test('el cubridor tapa antes de pintar aunque la navegación se demore (hidratación lenta)', async () => {
    // Repro del defecto crítico #2: en el código viejo, `abrirFiltrado` llamaba
    // page.goto() y RECIÉN DESPUÉS cubrir(); con una respuesta lenta (Livewire con
    // hidratación pesada, o simplemente carga bajo presión) ese hueco alcanza para pintar
    // la tabla completa sin protección. Se fuerza un retardo artificial de 200ms en la
    // respuesta del panel para simular justo ese caso, y se vigila con muestreo agresivo
    // durante toda la navegación (no solo en los puntos de control de abrirFiltrado).
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ storageState: { cookies: [
        { name: 'sesion', value: 'funcionario', domain: '127.0.0.1', path: '/' },
    ], origins: [] } });
    const page = await ctx.newPage();
    try {
        await page.route('**/panel*', async (route) => {
            await new Promise((r) => setTimeout(r, 200));
            await route.continue();
        });

        // Vigía independiente de los puntos de control de abrirFiltrado: muestrea cada 5ms
        // durante TODA la operación, no solo en los instantes que el propio código elige
        // mirar. Si el cubridor tuviera un hueco de temporización, esto lo atraparía.
        const muestras = [];
        let vigilando = true;
        const vigilar = (async () => {
            while (vigilando) {
                try {
                    muestras.push(await page.evaluate(() => ({
                        tapada: !!document.getElementById('__cubridor'),
                        filas: document.querySelectorAll('tr.fila').length,
                    })));
                } catch { /* navegación en curso: el frame se destruyó a mitad del evaluate */ }
                await new Promise((r) => setTimeout(r, 5));
            }
        })();

        await abrirFiltrado(page, `${juguete.url}/panel`, {
            filtro: '#filtro', valor: '11111111-1', selectorFilas: 'tr.fila',
        });
        vigilando = false;
        await vigilar;

        const fuga = muestras.some((v) => !v.tapada && v.filas > 1);
        assert.equal(fuga, false, 'con retardo artificial se vio la tabla completa sin cubridor: fuga de privacidad');
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

// `abrirVerificado` protege pantallas SIN buscador (una cola de atención, por ejemplo):
// no hay nada que filtrar, así que el juez es un predicado sobre lo que quedó pintado.

test('abrirVerificado: destapa cuando el predicado ya se cumple desde el primer instante', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ storageState: { cookies: [
        { name: 'sesion', value: 'funcionario', domain: '127.0.0.1', path: '/' },
    ], origins: [] } });
    const page = await ctx.newPage();
    try {
        const visibles = [];
        const mirar = async () => visibles.push(await page.evaluate(() => ({
            tapada: !!document.getElementById('__cubridor'),
            nombres: [...document.querySelectorAll('.mt-item-nom')].map((n) => n.textContent),
        })));

        await abrirVerificado(page, `${juguete.url}/mi-turno?variante=ok`, async () => {
            const nombres = await page.locator('.mt-item-nom').allTextContents();
            return nombres.length > 0 && nombres.every(esPermitido);
        }, { alPintar: mirar });

        const final = await page.evaluate(() => !!document.getElementById('__cubridor'));
        assert.equal(final, false, 'terminó de tapar la pantalla pese a que el predicado se cumplía');
        assert.ok(visibles.some((v) => !v.tapada && v.nombres.length > 0),
            'la pantalla nunca llegó a destaparse con datos a la vista');
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
});

test('abrirVerificado: si el predicado nunca se cumple, no destapa NUNCA y lanza (falla cerrado)', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ storageState: { cookies: [
        { name: 'sesion', value: 'funcionario', domain: '127.0.0.1', path: '/' },
    ], origins: [] } });
    const page = await ctx.newPage();
    try {
        // Vigía independiente, igual que en el test de hidratación lenta de abrirFiltrado:
        // muestrea todo el tiempo, no solo en los puntos de control del propio código.
        const muestras = [];
        let vigilando = true;
        const vigilar = (async () => {
            while (vigilando) {
                try {
                    muestras.push(await page.evaluate(() => ({
                        tapada: !!document.getElementById('__cubridor'),
                        nombres: [...document.querySelectorAll('.mt-item-nom')].map((n) => n.textContent),
                    })));
                } catch { /* navegación en curso */ }
                await new Promise((r) => setTimeout(r, 20));
            }
        })();

        await assert.rejects(() => abrirVerificado(page, `${juguete.url}/mi-turno?variante=malo`, async () => {
            const nombres = await page.locator('.mt-item-nom').allTextContents();
            return nombres.length > 0 && nombres.every(esPermitido);
        }, { esperaMs: 1000 }), /no se cumplió de forma estable/);

        vigilando = false;
        await vigilar;

        const fuga = muestras.some((v) => !v.tapada && v.nombres.some((n) => !esPermitido(n)));
        assert.equal(fuga, false, 'se vio un nombre no permitido sin el cubridor puesto: fuga de privacidad');

        const siguioTapada = await page.evaluate(() => !!document.getElementById('__cubridor'));
        assert.equal(siguioTapada, true, 'tras fallar, la pantalla debe quedar tapada');
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
});

test('abrirVerificado: espera a que el predicado se estabilice antes de destapar (asentamiento tardío)', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ storageState: { cookies: [
        { name: 'sesion', value: 'funcionario', domain: '127.0.0.1', path: '/' },
    ], origins: [] } });
    const page = await ctx.newPage();
    try {
        const muestras = [];
        let vigilando = true;
        const vigilar = (async () => {
            while (vigilando) {
                try {
                    muestras.push(await page.evaluate(() => ({
                        tapada: !!document.getElementById('__cubridor'),
                        nombres: [...document.querySelectorAll('.mt-item-nom')].map((n) => n.textContent),
                    })));
                } catch { /* navegación en curso */ }
                await new Promise((r) => setTimeout(r, 5));
            }
        })();

        await abrirVerificado(page, `${juguete.url}/mi-turno?variante=tarde`, async () => {
            const nombres = await page.locator('.mt-item-nom').allTextContents();
            return nombres.length > 0 && nombres.every(esPermitido);
        });

        vigilando = false;
        await vigilar;

        const fuga = muestras.some((v) => !v.tapada && v.nombres.some((n) => !esPermitido(n)));
        assert.equal(fuga, false, 'se vio el nombre no permitido antes de que se reemplazara: fuga de privacidad');

        const final = await page.evaluate(() => !!document.getElementById('__cubridor'));
        assert.equal(final, false, 'una vez asentado en un estado permitido, debe terminar destapada');
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
});
