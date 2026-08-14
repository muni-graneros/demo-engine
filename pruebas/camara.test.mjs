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

test('el cursor nace oculto y solo se muestra cuando algo lo mueve a su primer destino', async () => {
    // Defecto real: el cursor se instalaba visible en (0,0), así que tras cada navegación
    // (que borra el DOM y con él el cursor) aparecía un instante saltando a la esquina
    // superior izquierda, visible durante la narración, hasta el siguiente `pulsar`.
    await conPagina(async (page) => {
        const opacidadInicial = await page.evaluate(() =>
            getComputedStyle(document.getElementById('__cursor')).opacity);
        assert.equal(opacidadInicial, '0', 'el cursor no debe verse antes de que algo lo mueva');

        await moverCursorA(page, '#entrar');
        const opacidadTrasMover = await page.evaluate(() =>
            getComputedStyle(document.getElementById('__cursor')).opacity);
        assert.equal(opacidadTrasMover, '1', 'tras moverlo a su primer destino, el cursor debe hacerse visible');
    });
});

test('tras navegar, el cursor nace oculto otra vez (no aparece parqueado en la esquina)', async () => {
    await conPagina(async (page) => {
        await moverCursorA(page, '#entrar');   // ya visible en el documento viejo
        const url = page.url();
        await page.goto(url);                  // nueva página: se lleva el DOM y el cursor
        await instalarCursor(page);            // como haría el motor tras cualquier navegación

        const opacidad = await page.evaluate(() =>
            getComputedStyle(document.getElementById('__cursor')).opacity);
        assert.equal(opacidad, '0',
            'en el documento nuevo el cursor debe nacer oculto, no visible en (0,0)');
    });
});

test('el cursor sigue estando tras navegar dentro del mismo paso', async () => {
    // Caso realísimo: un guion hace page.goto(...) y luego pulsa. La navegación borra el
    // cursor instalado antes, así que pulsar tiene que reponerlo por su cuenta.
    await conPagina(async (page) => {
        const url = page.url();
        await page.goto(url);        // se lleva el DOM, y con él el cursor
        assert.equal(await page.evaluate(() => !!document.getElementById('__cursor')), false,
            'la navegación debería haber borrado el cursor; si no, este test no prueba nada');

        await pulsar(page, '#entrar');
        assert.ok(await page.evaluate(() => !!document.getElementById('__cursor')),
            'tras navegar y pulsar, el cursor tiene que estar a la vista');
    });
});

test('acercar sube la escala del viewport visual y alejar la vuelve a 1', async () => {
    await conPagina(async (page) => {
        await acercarA(page, '#entrar', { escala: 1.8 });
        const conZoom = await page.evaluate(() => window.visualViewport.scale);
        assert.ok(Math.abs(conZoom - 1.8) < 0.05, `la escala visual no subió: ${conZoom}`);

        await alejar(page);
        const sinZoom = await page.evaluate(() => window.visualViewport.scale);
        assert.ok(Math.abs(sinZoom - 1) < 0.05, `la escala visual no volvió a 1: ${sinZoom}`);
    });
});

test('acercar no desancla elementos position:fixed (barra lateral tipo panel Filament)', async () => {
    // Regresión del defecto real: transform: scale() sobre <html> convierte la raíz en
    // bloque contenedor de lo fijo, y una barra lateral fija se corre y cambia de tamaño.
    // Con el zoom vía CDP el layout no se toca, así que la barra debe quedar exactamente
    // donde estaba, en coordenadas de layout (getBoundingClientRect).
    await conPagina(async (page) => {
        await page.setContent(`<!doctype html><html><body style="margin:0">
            <div id="lateral" style="position:fixed;top:0;left:0;width:200px;height:100%;background:#111"></div>
            <div style="margin-left:220px;padding:40px">
                <button id="objetivo" style="margin-top:300px">Aprobar</button>
            </div>
        </body></html>`);
        await instalarCursor(page);

        const antes = await page.evaluate(() => {
            const r = document.getElementById('lateral').getBoundingClientRect();
            return { x: r.x, ancho: r.width };
        });

        await acercarA(page, '#objetivo', { escala: 1.6 });

        const durante = await page.evaluate(() => {
            const r = document.getElementById('lateral').getBoundingClientRect();
            return { x: r.x, ancho: r.width };
        });

        assert.equal(durante.x, antes.x, `la barra fija se corrió: x ${antes.x} → ${durante.x}`);
        assert.equal(durante.ancho, antes.ancho, `la barra fija cambió de ancho: ${antes.ancho} → ${durante.ancho}`);

        await alejar(page);
    });
});
