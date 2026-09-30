import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { moverCursorA } from '../src/camara.mjs';
import { elenco, presentar, quitarPresentacion, anotar, configurarPresentacion } from '../src/explainer.mjs';

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

// ---------------------------------------------------------------------------------------------
// Ficha de `presentar` que no tapa lo importante (C3) y globo de `anotar` al lado (C8).
// ---------------------------------------------------------------------------------------------

/** Rectángulo de un selector en la página (o null). */
const rectDe = (page, sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, sel);

const seCruzan = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const dentroDe = (a, vw, vh) => a.left >= 0 && a.top >= 0 && a.right <= vw && a.bottom <= vh;

/** Espera a que la ficha termine de moverse (la reubicación corre en un intervalo de la página). */
const esperarFicha = (page) => page.waitForTimeout(700);

async function conPaginaDe(fn, { ancho = 1280, alto = 800 } = {}) {
    const navegador = await chromium.launch();
    const page = await (await navegador.newContext({ viewport: { width: ancho, height: alto } })).newPage();
    try {
        await fn(page);
    } finally {
        await navegador.close();
    }
}

// Maqueta del APK: un botón PÁNICO fijo abajo a la izquierda (G8-07) y un menú con pie.
const APK = `<body style="margin:0;font-family:system-ui">
  <main style="padding:24px"><h1>Inicio</h1><p>Texto del turno</p></main>
  <button id="panico" style="position:fixed;left:16px;bottom:16px;width:260px;height:90px;background:#b91c1c;color:#fff;font-size:28px">PÁNICO</button>
</body>`;

test('presentar en auto no tapa el botón que ocupa la esquina de siempre (PÁNICO del APK)', async () => {
    await conPaginaDe(async (page) => {
        await page.setContent(APK);
        await presentar(page, { nombre: 'Felipe', rol: 'Patrullero' });
        await esperarFicha(page);
        const ficha = await rectDe(page, '#demo-lower-third');
        const panico = await rectDe(page, '#panico');
        assert.equal(seCruzan(ficha, panico), false, `la ficha ${JSON.stringify(ficha)} tapa PÁNICO ${JSON.stringify(panico)}`);
        assert.ok(dentroDe(ficha, 1280, 800));
    });
});

test('presentar respeta una posición explícita (por llamada, por actor o por página)', async () => {
    await conPaginaDe(async (page) => {
        await page.setContent(APK);
        // posicion en el objeto del actor: se usa tal cual, aunque tape (lo pidió el guion).
        await presentar(page, { nombre: 'Felipe', posicion: 'arriba-derecha' });
        let f = await rectDe(page, '#demo-lower-third');
        assert.ok(f.top < 100 && f.right > 1180, JSON.stringify(f));
        await presentar(page, { nombre: 'Felipe', posicion: 'abajo-izquierda' });
        f = await rectDe(page, '#demo-lower-third');
        assert.ok(f.left < 100 && f.bottom > 700, JSON.stringify(f));
        // Por página (superficie): configurarPresentacion(opciones, page).
        configurarPresentacion({ posicion: 'arriba-izquierda' }, page);
        await presentar(page, { nombre: 'Felipe' });
        f = await rectDe(page, '#demo-lower-third');
        assert.ok(f.left < 100 && f.top < 100, JSON.stringify(f));
    });
});

test('una posición desconocida falla con un mensaje claro', async () => {
    await conPaginaDe(async (page) => {
        await page.setContent('<p>x</p>');
        await assert.rejects(presentar(page, { nombre: 'X', posicion: 'centro' }), /posicion/);
    });
});

test('la ficha se corre si el objetivo del paso (anotar/resaltar/evitar/cursor) cae debajo', async () => {
    await conPaginaDe(async (page) => {
        await page.setContent(`<body style="margin:0">
          <button id="a" style="position:fixed;left:40px;bottom:40px;width:120px;height:40px">Abajo izq</button>
          <button id="b" style="position:fixed;right:40px;bottom:40px;width:120px;height:40px">Abajo der</button>
          <button id="c" style="position:fixed;right:40px;top:40px;width:120px;height:40px">Arriba der</button>
          <button id="d" style="position:fixed;left:40px;top:40px;width:120px;height:40px">Arriba izq</button>
        </body>`);
        await presentar(page, { nombre: 'Camila', rol: 'Operadora', posicion: 'abajo-izquierda' });
        // anotar sobre lo que la ficha tapa: la ficha se corre (aunque su posición fuera fija,
        // el objetivo manda) y el anillo queda a la vista.
        await anotar(page, '#a', 'Acá', { permanecer: true });
        await esperarFicha(page);
        let ficha = await rectDe(page, '#demo-lower-third');
        assert.equal(seCruzan(ficha, await rectDe(page, '#a')), false, 'anotar: la ficha sigue sobre #a');
        await page.evaluate(() => document.getElementById('demo-anotacion')?.remove());

        // Un resalte ajeno al motor que marca su objetivo con [data-demo-objetivo].
        const donde = await rectDe(page, '#demo-lower-third');
        const bajo = await page.evaluate((r) => {
            const el = [...document.querySelectorAll('button')].find((b) => {
                const q = b.getBoundingClientRect();
                return q.left < r.right && r.left < q.right && q.top < r.bottom && r.top < q.bottom;
            }) ?? document.elementFromPoint(r.left + 5, r.top + 5);
            el.setAttribute('data-demo-objetivo', '');
            return '#' + el.id;
        }, donde);
        await esperarFicha(page);
        ficha = await rectDe(page, '#demo-lower-third');
        assert.equal(seCruzan(ficha, await rectDe(page, bajo)), false, `[data-demo-objetivo]: la ficha sigue sobre ${bajo}`);
    });
});

test('la ficha se corre cuando el cursor del motor va a un elemento que tapa', async () => {
    await conPaginaDe(async (page) => {
        await page.setContent(APK);
        await presentar(page, { nombre: 'Felipe', posicion: 'abajo-izquierda' });
        // El cursor del motor llega al botón: es lo que se va a pulsar.
        await moverCursorA(page, '#panico');
        await esperarFicha(page);
        const ficha = await rectDe(page, '#demo-lower-third');
        assert.equal(seCruzan(ficha, await rectDe(page, '#panico')), false, JSON.stringify(ficha));
    });
});

test('presentar con evitar no se pone sobre esos selectores', async () => {
    await conPaginaDe(async (page) => {
        await page.setContent(`<body style="margin:0"><div id="pie" style="position:fixed;left:0;bottom:0;width:100%;height:120px;background:#eee"></div>
          <div id="tarjeta" style="position:fixed;right:0;top:0;width:50%;height:200px"></div></body>`);
        await presentar(page, { nombre: 'Camila', evitar: ['#pie', '#tarjeta'] });
        await esperarFicha(page);
        const ficha = await rectDe(page, '#demo-lower-third');
        assert.equal(seCruzan(ficha, await rectDe(page, '#pie')), false);
        assert.equal(seCruzan(ficha, await rectDe(page, '#tarjeta')), false);
    });
});

test('quitarPresentacion también suelta el vigilante de la ficha', async () => {
    await conPaginaDe(async (page) => {
        await page.setContent(APK);
        await presentar(page, { nombre: 'Felipe' });
        await quitarPresentacion(page);
        assert.equal(await page.evaluate(() => typeof window.__demoFichaVigilante), 'undefined');
    });
});

/** Globo (etiqueta) y anillo de la anotación vigente. */
const globoDe = (page) => rectDe(page, '#demo-anotacion [data-demo-globo]');

for (const [caso, estilo] of [
    ['al centro', 'left:560px;top:380px'],
    ['pegado arriba', 'left:560px;top:6px'],
    ['pegado abajo', 'left:560px;top:760px'],
    ['pegado a la derecha', 'right:4px;top:380px'],
    ['pegado a la izquierda', 'left:4px;top:380px'],
    ['bajo la etiqueta de su campo (G7-02)', 'left:300px;top:120px'],
]) {
    test(`anotar pone el globo al lado del objetivo sin taparlo ni salirse (${caso})`, async () => {
        await conPaginaDe(async (page) => {
            await page.setContent(`<body style="margin:0"><input id="x" style="position:fixed;${estilo};width:160px;height:34px"></body>`);
            // Texto largo: con el desplazamiento fijo de antes, dos líneas caían sobre el campo.
            await anotar(page, '#x', 'La fecha de la cita, que el vecino eligió en el portal y la central confirma', { permanecer: true });
            const globo = await globoDe(page);
            const objetivo = await rectDe(page, '#x');
            assert.ok(globo, 'no hay globo');
            assert.equal(seCruzan(globo, objetivo), false, `globo ${JSON.stringify(globo)} tapa ${JSON.stringify(objetivo)}`);
            assert.ok(dentroDe(globo, 1280, 800), `globo fuera de pantalla ${JSON.stringify(globo)}`);
            // Lleva flecha hacia el objetivo.
            assert.equal(await page.locator('#demo-anotacion [data-demo-flecha]').count(), 1);
        });
    });
}

test('anotar acepta un lado pedido y cae a otro si no cabe', async () => {
    await conPaginaDe(async (page) => {
        await page.setContent('<body style="margin:0"><button id="x" style="position:fixed;left:560px;top:380px;width:120px;height:40px">Ir</button></body>');
        await anotar(page, '#x', 'A la derecha', { permanecer: true, lado: 'derecha' });
        let g = await globoDe(page);
        const o = await rectDe(page, '#x');
        assert.ok(g.left >= o.right, JSON.stringify(g));
        await anotar(page, '#x', 'Abajo', { permanecer: true, lado: 'abajo' });
        g = await globoDe(page);
        assert.ok(g.top >= o.bottom, JSON.stringify(g));
        // Arriba no cabe si el objetivo está pegado al borde superior: se usa otro lado.
        await page.evaluate(() => { document.getElementById('x').style.top = '2px'; });
        await anotar(page, '#x', 'Arriba', { permanecer: true, lado: 'arriba' });
        g = await globoDe(page);
        assert.equal(seCruzan(g, await rectDe(page, '#x')), false);
        assert.ok(dentroDe(g, 1280, 800));
    });
});

test('anotar no pone el globo sobre la etiqueta del campo si hay lugar libre (G7-02)', async () => {
    await conPaginaDe(async (page) => {
        await page.setContent(`<body style="margin:0;font:16px system-ui">
          <label id="et" for="f" style="position:fixed;left:300px;top:190px">Fecha de la cita</label>
          <input id="f" style="position:fixed;left:300px;top:215px;width:220px;height:34px"></body>`);
        await anotar(page, '#f', 'Acá va la fecha', { permanecer: true });
        const g = await globoDe(page);
        assert.equal(seCruzan(g, await rectDe(page, '#et')), false, `el globo ${JSON.stringify(g)} tapa la etiqueta`);
        assert.equal(seCruzan(g, await rectDe(page, '#f')), false);
    });
});

test('en un teléfono el globo de un texto largo no se sale de la pantalla (412 px)', async () => {
    // max-width descontaba el borde pero no el padding (content-box): en 412 px de ancho el globo
    // medía 424 y se cortaba 20 px por la derecha. Visto en la demo integrada de la 1.15.
    await conPaginaDe(async (page) => {
        await page.setContent(`<body style="margin:0"><label for="x" style="display:block;margin:200px 12px 4px">Nota del turno</label>
            <input id="x" style="margin:0 12px;width:200px"></body>`);
        await anotar(page, '#x', 'La nota queda en el traspaso de turno para la sala', { permanecer: true });
        const globo = await globoDe(page);
        assert.ok(dentroDe(globo, 412, 839), `globo fuera de pantalla ${JSON.stringify(globo)}`);
        assert.equal(seCruzan(globo, await rectDe(page, '#x')), false);
    }, { ancho: 412, alto: 839 });
});
