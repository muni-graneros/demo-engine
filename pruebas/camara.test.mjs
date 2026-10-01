import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { instalarCursor, moverCursorA, pulsar, acercarA, alejar, alClicar, configurarCursor, conCursorOculto } from '../src/camara.mjs';

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

test('pulsar con "dentro" apunta al elemento interior, no al centro geométrico del contenedor ancho', async () => {
    // Caso real: una fila de tabla ancha cuyo centro geométrico cae en una celda vacía,
    // lejos del control que se quiere mostrar (p. ej. un enlace "Ver" al extremo derecho).
    await conPagina(async (page) => {
        await page.setContent(`<!doctype html><html><body style="margin:0">
            <table style="width:900px;border-collapse:collapse">
              <tr id="fila">
                <td style="width:700px">Ana Demo</td>
                <td><a href="#" id="ver">Ver</a></td>
              </tr>
            </table>
        </body></html>`);
        await instalarCursor(page);
        await page.evaluate(() => {
            document.getElementById('ver').addEventListener('click', (e) => {
                e.preventDefault();
                document.title = 'pulsado-dentro';
            });
        });

        await pulsar(page, '#fila', { dentro: '#ver' });

        assert.equal(await page.title(), 'pulsado-dentro',
            'el clic debía caer sobre el elemento interior, no en el centro geométrico de la fila');

        const { cursor, enlace } = await page.evaluate(() => {
            const c = document.getElementById('__cursor').getBoundingClientRect();
            const a = document.getElementById('ver').getBoundingClientRect();
            return { cursor: { x: c.left, y: c.top }, enlace: { x: a.x + a.width / 2, y: a.y + a.height / 2 } };
        });
        assert.ok(Math.abs(cursor.x - enlace.x) < 6, `el cursor no quedó sobre el enlace interior: ${cursor.x} vs ${enlace.x}`);
        assert.ok(Math.abs(cursor.y - enlace.y) < 6, `el cursor no quedó sobre el enlace interior: ${cursor.y} vs ${enlace.y}`);
    });
});

test('pulsar sin "dentro" se sigue comportando exactamente igual que hoy', async () => {
    await conPagina(async (page) => {
        await page.evaluate(() => {
            document.getElementById('entrar').addEventListener('click', (e) => {
                e.preventDefault();
                document.title = 'pulsado-sin-dentro';
            });
        });
        await pulsar(page, '#entrar');
        assert.equal(await page.title(), 'pulsado-sin-dentro');
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

test('alClicar avisa de cada pulsar con la hora justo antes del clic, sin que el guion cambie', async () => {
    await conPagina(async (page) => {
        const avisos = [];
        alClicar(page, (t) => avisos.push({ t, url: page.url() }));
        const antes = Date.now();
        await pulsar(page, '#entrar');
        assert.equal(avisos.length, 1, 'un pulsar, un aviso');
        assert.ok(avisos[0].t >= antes && avisos[0].t <= Date.now(), 'el aviso lleva Date.now()');
        assert.ok(!avisos[0].url.includes('/panel'), 'el aviso llega ANTES del clic, no después de navegar');
    });
});

test('pulsar sin nadie registrado con alClicar funciona igual que siempre', async () => {
    await conPagina(async (page) => {
        await pulsar(page, '#entrar');
        await page.waitForURL(/\/panel/);
    });
});

// acercarA en layouts reales (v1.14.1). Defecto: el zoom se hacía con
// Emulation.setPageScaleFactor + window.scrollTo, pero en Chromium window.scrollTo mueve SOLO
// el viewport de layout (el visual es "inerte"): con escala > 1 el viewport visual nunca se
// desplazaba y quedaba anclado arriba a la izquierda. En una página simple parecía funcionar
// porque el documento sí se desplazaba en vertical; en un panel con contenedor de scroll
// propio o en una sala de alto fijo, el objetivo quedaba fuera de cuadro.

/** Centro del objetivo en PANTALLA (lo que se ve en el video), desde la geometría del DOM. */
async function centroEnPantalla(page, selector) {
    return page.evaluate((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        const vv = window.visualViewport;
        return {
            x: (r.x + r.width / 2 - vv.offsetLeft) * vv.scale,
            y: (r.y + r.height / 2 - vv.offsetTop) * vv.scale,
            ancho: innerWidth, alto: innerHeight, escala: vv.scale, scrollY,
        };
    }, selector);
}

/** Centro de los píxeles magenta (#ff00ff) de una captura, decodificada en un canvas. */
async function centroMagenta(navegador, png) {
    const lienzo = await navegador.newPage();
    try {
        return await lienzo.evaluate(async (b64) => {
            const img = new Image();
            img.src = `data:image/png;base64,${b64}`;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const { data } = ctx.getImageData(0, 0, c.width, c.height);
            let sx = 0, sy = 0, n = 0;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] > 240 && data[i + 1] < 20 && data[i + 2] > 240) {
                    const p = i / 4;
                    sx += p % c.width; sy += Math.floor(p / c.width); n++;
                }
            }
            return n ? { x: sx / n, y: sy / n, n, ancho: c.width, alto: c.height } : null;
        }, png.toString('base64'));
    } finally {
        await lienzo.close();
    }
}

async function conPaginaDeCamara(ruta, fn) {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const page = await navegador.newPage();
    try {
        await page.goto(`${juguete.url}${ruta}`);
        await instalarCursor(page);
        await fn(page, navegador);
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
}

async function exigirCentrado(page, navegador) {
    const dom = await centroEnPantalla(page, '#objetivo');
    assert.ok(Math.abs(dom.escala - 1.6) < 0.05, `la escala no subió: ${dom.escala}`);
    assert.ok(Math.abs(dom.x - dom.ancho / 2) < 20, `x del objetivo en pantalla ${dom.x}, centro ${dom.ancho / 2}`);
    assert.ok(Math.abs(dom.y - dom.alto / 2) < 20, `y del objetivo en pantalla ${dom.y}, centro ${dom.alto / 2}`);

    const pixeles = await centroMagenta(navegador, await page.screenshot());
    assert.ok(pixeles, 'el objetivo (magenta) no aparece en la captura: quedó fuera de cuadro');
    assert.ok(Math.abs(pixeles.x - pixeles.ancho / 2) < 20, `por píxel, x ${pixeles.x} vs centro ${pixeles.ancho / 2}`);
    assert.ok(Math.abs(pixeles.y - pixeles.alto / 2) < 20, `por píxel, y ${pixeles.y} vs centro ${pixeles.alto / 2}`);
    return dom;
}

test('acercarA centra el objetivo en un panel cuyo contenido se desplaza dentro de un contenedor (tipo Filament)', async () => {
    await conPaginaDeCamara('/camara/contenedor', async (page, navegador) => {
        await acercarA(page, '#objetivo', { escala: 1.6 });
        await exigirCentrado(page, navegador);

        await alejar(page);
        const despues = await centroEnPantalla(page, '#objetivo');
        assert.ok(Math.abs(despues.escala - 1) < 0.05, `alejar debe volver a escala 1: ${despues.escala}`);
    });
});

test('acercarA centra el objetivo en una sala de alto fijo sin desplazar el documento (sin franja vacía)', async () => {
    await conPaginaDeCamara('/camara/fija', async (page, navegador) => {
        await acercarA(page, '#objetivo', { escala: 1.6 });
        const dom = await exigirCentrado(page, navegador);
        assert.equal(dom.scrollY, 0,
            'el documento de una sala de alto fijo no debe desplazarse: correrlo deja una franja vacía abajo');

        await alejar(page);
        const despues = await centroEnPantalla(page, '#objetivo');
        assert.ok(Math.abs(despues.escala - 1) < 0.05);
        assert.equal(despues.scrollY, 0);
    });
});

test('acercarA en una página simple que se desplaza también centra en horizontal (no solo en vertical)', async () => {
    await conPagina(async (page) => {
        await page.setContent(`<!doctype html><html><body style="margin:0;height:3000px">
            <button id="objetivo" style="position:absolute;left:760px;top:1400px;width:120px;height:60px;background:#ff00ff;border:0">Ir</button>
        </body></html>`);
        await instalarCursor(page);
        const scrollAntes = await page.evaluate(() => scrollY);
        await acercarA(page, '#objetivo', { escala: 1.6 });
        const dom = await centroEnPantalla(page, '#objetivo');
        assert.ok(Math.abs(dom.x - dom.ancho / 2) < 20, `x ${dom.x} vs ${dom.ancho / 2}`);
        assert.ok(Math.abs(dom.y - dom.alto / 2) < 20, `y ${dom.y} vs ${dom.alto / 2}`);

        await alejar(page);
        assert.equal(await page.evaluate(() => scrollY), scrollAntes,'alejar restaura el desplazamiento original');
    });
});

// C7 (G8-08/09, G3-09): acercarA no recortaba en los bordes. Con un elemento ancho o fijo al
// borde (el botón PÁNICO del APK, «Estado de la patrulla»), la escala pedida lo dejaba más
// grande que la pantalla y el objetivo salía cortado. Ahora la escala se topa para que el
// objetivo entre entero con margen, y el encuadre se ajusta a los bordes del viewport.

/** Caja del objetivo en PANTALLA (lo que se ve en el video) y el tamaño de la pantalla. */
async function cajaEnPantalla(page, selector) {
    return page.evaluate((sel) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        const vv = window.visualViewport;
        return {
            izq: (r.left - vv.offsetLeft) * vv.scale,
            der: (r.right - vv.offsetLeft) * vv.scale,
            arr: (r.top - vv.offsetTop) * vv.scale,
            aba: (r.bottom - vv.offsetTop) * vv.scale,
            ancho: document.documentElement.clientWidth,
            alto: document.documentElement.clientHeight,
            escala: vv.scale,
        };
    }, selector);
}

function exigirEntero(c, tolerancia = 1) {
    assert.ok(c.izq >= -tolerancia, `el objetivo se corta por la izquierda: ${c.izq}`);
    assert.ok(c.arr >= -tolerancia, `el objetivo se corta por arriba: ${c.arr}`);
    assert.ok(c.der <= c.ancho + tolerancia, `el objetivo se corta por la derecha: ${c.der} > ${c.ancho}`);
    assert.ok(c.aba <= c.alto + tolerancia, `el objetivo se corta por abajo: ${c.aba} > ${c.alto}`);
}

/** Cuántos píxeles magenta hay en una captura (el objetivo se pinta #ff00ff). */
async function pixelesMagenta(navegador, png) {
    const r = await centroMagenta(navegador, png);
    return r?.n ?? 0;
}

async function conTelefono(html, fn) {
    const navegador = await chromium.launch();
    const ctx = await navegador.newContext({ viewport: { width: 412, height: 839 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    try {
        await page.setContent(html);
        await instalarCursor(page);
        await fn(page, navegador);
    } finally {
        await navegador.close();
    }
}

test('acercarA topa la escala: un botón fijo abajo, casi de ancho completo, entra entero (PÁNICO del APK)', async () => {
    await conTelefono(`<!doctype html><html><head><meta name="viewport" content="width=device-width"></head>
        <body style="margin:0;height:2000px">
            <p style="padding:16px">Inicio del turno</p>
            <button id="objetivo" style="position:fixed;left:16px;right:16px;bottom:16px;height:72px;background:#ff00ff;border:0">PÁNICO</button>
        </body></html>`, async (page, navegador) => {
        const antes = await pixelesMagenta(navegador, await page.screenshot());
        await acercarA(page, '#objetivo', { escala: 1.4 });
        const c = await cajaEnPantalla(page, '#objetivo');
        exigirEntero(c);
        // por píxel: el botón completo sigue a la vista (con escala ≥ 1, nunca menos área)
        const despues = await pixelesMagenta(navegador, await page.screenshot());
        assert.ok(despues >= antes * 0.98, `se ven ${despues} px del botón, antes ${antes}`);
        await alejar(page);
    });
});

test('acercarA topa la escala con margen: el objetivo ocupa a lo más `margen` de la pantalla', async () => {
    await conPagina(async (page) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.setContent(`<!doctype html><html><body style="margin:0">
            <div id="objetivo" style="position:absolute;left:100px;top:200px;width:1000px;height:120px;background:#ff00ff"></div>
        </body></html>`);
        await instalarCursor(page);
        await acercarA(page, '#objetivo', { escala: 1.8 });
        const c = await cajaEnPantalla(page, '#objetivo');
        exigirEntero(c);
        const esperado = (0.92 * 1280) / 1000;
        assert.ok(Math.abs(c.escala - esperado) < 0.03, `escala ${c.escala}, esperada ≈ ${esperado.toFixed(3)}`);
        await alejar(page);
    });
});

test('acercarA respeta la escala pedida cuando el objetivo ya cabe (no cambia lo que funcionaba)', async () => {
    await conPagina(async (page) => {
        await acercarA(page, '#entrar', { escala: 1.8 });
        const escala = await page.evaluate(() => window.visualViewport.scale);
        assert.ok(Math.abs(escala - 1.8) < 0.05, `escala ${escala}`);
        await alejar(page);
    });
});

test('acercarA con ajustar:false conserva la escala pedida aunque corte (compatibilidad explícita)', async () => {
    await conPagina(async (page) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.setContent(`<!doctype html><html><body style="margin:0">
            <div id="objetivo" style="position:absolute;left:100px;top:200px;width:1000px;height:120px;background:#ff00ff"></div>
        </body></html>`);
        await instalarCursor(page);
        await acercarA(page, '#objetivo', { escala: 1.8, ajustar: false });
        const escala = await page.evaluate(() => window.visualViewport.scale);
        assert.ok(Math.abs(escala - 1.8) < 0.05, `escala ${escala}`);
        await alejar(page);
    });
});

test('acercarA sobre un objetivo pegado a la esquina (fijo o no) lo deja entero: el encuadre se ajusta al borde', async () => {
    for (const posicion of ['fixed', 'absolute']) {
        await conPagina(async (page) => {
            await page.setViewportSize({ width: 1280, height: 720 });
            await page.setContent(`<!doctype html><html><body style="margin:0;height:3000px;overflow-x:hidden">
                <p>contenido</p>
                <button id="objetivo" style="position:${posicion};right:0;top:0;width:220px;height:48px;background:#ff00ff;border:0">Salir</button>
                <button id="abajo" style="position:${posicion};left:0;${posicion === 'fixed' ? 'bottom:0' : 'top:2952px'};width:220px;height:48px;background:#00ff00;border:0">Abajo</button>
            </body></html>`);
            await instalarCursor(page);
            await acercarA(page, '#objetivo', { escala: 2 });
            exigirEntero(await cajaEnPantalla(page, '#objetivo'));
            await alejar(page);
            await acercarA(page, '#abajo', { escala: 2 });
            exigirEntero(await cajaEnPantalla(page, '#abajo'));
            await alejar(page);
        });
    }
});

// C9 (G2-38): en una app táctil se veía la flecha del ratón, que además tapaba texto. En
// una superficie táctil el cursor es un indicador de toque (círculo centrado en el punto),
// y las capturas que van al manual pueden salir sin cursor.

test('en una página táctil el cursor es un círculo centrado en el punto, no una flecha', async () => {
    await conTelefono(`<!doctype html><html><body style="margin:0">
        <button id="objetivo" style="margin:200px 100px;width:120px;height:60px">Llegué</button>
    </body></html>`, async (page) => {
        configurarCursor(page, { tactil: true });
        await instalarCursor(page);
        await moverCursorA(page, '#objetivo');
        const r = await page.evaluate(() => {
            const c = document.getElementById('__cursor');
            const cc = c.getBoundingClientRect();
            const b = document.getElementById('objetivo').getBoundingClientRect();
            const e = getComputedStyle(c);
            return {
                tipo: c.dataset.tipo, radio: e.borderRadius, fondo: e.backgroundImage,
                centro: { x: cc.left + cc.width / 2, y: cc.top + cc.height / 2 },
                boton: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, ancho: cc.width,
            };
        });
        assert.equal(r.tipo, 'toque');
        assert.equal(r.radio, '50%');
        assert.equal(r.fondo, 'none', 'sin la flecha de fondo');
        assert.ok(r.ancho >= 24, `el indicador debe verse (≥ 24 px): ${r.ancho}`);
        assert.ok(Math.abs(r.centro.x - r.boton.x) < 3, `x: ${r.centro.x} vs ${r.boton.x}`);
        assert.ok(Math.abs(r.centro.y - r.boton.y) < 3, `y: ${r.centro.y} vs ${r.boton.y}`);
    });
});

test('el modo táctil sobrevive a una navegación (instalarCursor lo repone igual)', async () => {
    await conPagina(async (page) => {
        configurarCursor(page, { tactil: true });
        await page.goto(page.url());
        await pulsar(page, '#entrar').catch(() => {});
        assert.equal(await page.evaluate(() => document.getElementById('__cursor')?.dataset.tipo), 'toque');
    });
});

test('sin configurar, el cursor sigue siendo la flecha de siempre', async () => {
    await conPagina(async (page) => {
        const r = await page.evaluate(() => {
            const c = document.getElementById('__cursor');
            return { tipo: c.dataset.tipo, fondo: getComputedStyle(c).backgroundImage };
        });
        assert.equal(r.tipo, 'flecha');
        assert.match(r.fondo, /svg/);
    });
});

test('conCursorOculto esconde cursor y halo solo mientras corre la captura', async () => {
    await conPagina(async (page) => {
        await moverCursorA(page, '#entrar');
        await page.evaluate(() => {
            const h = document.createElement('div'); h.className = '__halo'; h.id = 'halo';
            document.documentElement.appendChild(h);
        });
        const visible = () => page.evaluate(() => [getComputedStyle(document.getElementById('__cursor')).visibility,
            getComputedStyle(document.getElementById('halo')).visibility]);
        const durante = await conCursorOculto(page, visible);
        assert.deepEqual(durante, ['hidden', 'hidden']);
        assert.deepEqual(await visible(), ['visible', 'visible'], 'después vuelve a verse');
    });
});

// 1.16: en el APK (teléfono) `acercarA` centra el objetivo dentro del contenedor con scroll
// propio (`.marco__contenido`) y `alejar` no lo devolvía: tras el acercamiento la pantalla
// quedaba corrida ~40 px y el encabezado de la tarjeta casi cortado en el resto del paso.
test('en un teléfono, acercarA + alejar deja la pantalla como estaba (también el contenedor con scroll propio)', async () => {
    const css = `html,body{height:100%;margin:0}body{overflow:hidden}
        .marco{display:flex;flex-direction:column;height:100vh;height:100dvh;overflow:hidden}
        header{flex:none;height:56px;background:#355a63}
        .marco__contenido{flex:1 1 auto;min-height:0;overflow-y:auto}
        section{margin:12px;padding:12px;border:1px solid #ccc}
        #cabeza{background:#ff00ff;margin:0;height:40px}`;
    await conTelefono(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
        <body><div class="marco"><header>Turno</header><main class="marco__contenido">
            <section><h2 id="cabeza">Incidente asignado</h2>${'<p>linea</p>'.repeat(12)}
            <p id="objetivo" style="width:180px">1,8 km · 4 min</p></section>${'<p>mas</p>'.repeat(20)}
        </main></div></body></html>`, async (page, navegador) => {
        const medir = () => page.evaluate(() => ({
            contenedor: document.querySelector('.marco__contenido').scrollTop,
            cabeza: document.getElementById('cabeza').getBoundingClientRect().top,
            scrollY, escala: visualViewport.scale, offset: visualViewport.offsetTop,
        }));
        const antes = await medir();
        const pixelesAntes = await centroMagenta(navegador, await page.screenshot());
        await acercarA(page, '#objetivo', { escala: 1.5 });
        const cerca = await medir();
        assert.ok(cerca.contenedor > 20, `el contenedor no se movió para centrar (${cerca.contenedor}): la prueba no ejercita el caso`);
        await alejar(page);
        const despues = await medir();
        assert.equal(despues.escala, 1);
        assert.equal(despues.contenedor, antes.contenedor, 'el contenedor con scroll propio quedó corrido tras alejar');
        assert.equal(despues.cabeza, antes.cabeza, `el encabezado de la tarjeta quedó corrido ${antes.cabeza - despues.cabeza} px`);
        const pixelesDespues = await centroMagenta(navegador, await page.screenshot());
        assert.ok(Math.abs(pixelesDespues.y - pixelesAntes.y) < 1, `por píxel, el encabezado pasó de y=${pixelesAntes.y} a y=${pixelesDespues.y}`);
    });
});
