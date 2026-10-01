import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { opcionesDeLanzamiento, opcionesDeContexto, idiomaDeNavegador } from '../src/contexto-actor.mjs';
import { cargarConfig, ErrorConfig } from '../src/configurar.mjs';
import { capturarContexto } from '../src/contexto.mjs';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { declararEntornoDePruebas } from './entorno.mjs';

declararEntornoDePruebas();

// Los controles que dibuja el propio Chromium («Choose Files», `dd/mm/yyyy`) salen en el idioma
// de interfaz del navegador, no en el `locale` del contexto. Con el headless-shell de Playwright
// `--lang` no alcanza: hace falta el canal `chromium` MÁS `--lang` MÁS `locale`.

test('lanzamiento: por defecto canal chromium y --lang=es-CL, sin romper configs viejas', () => {
    assert.deepEqual(opcionesDeLanzamiento({}), { channel: 'chromium', args: ['--lang=es-CL'] });
    assert.deepEqual(opcionesDeLanzamiento(undefined), { channel: 'chromium', args: ['--lang=es-CL'] });
    // Los args del consumidor (p. ej. --host-resolver-rules) siguen llegando, detrás del --lang.
    const reglas = '--host-resolver-rules=MAP a.test 127.0.0.1';
    assert.deepEqual(opcionesDeLanzamiento({ navegador: { args: [reglas] } }).args, ['--lang=es-CL', reglas]);
});

test('lanzamiento: idioma y canal se sobreescriben; un --lang explícito en args manda', () => {
    assert.deepEqual(opcionesDeLanzamiento({ navegador: { idioma: 'en-US' } }), { channel: 'chromium', args: ['--lang=en-US'] });
    assert.deepEqual(opcionesDeLanzamiento({ navegador: { canal: 'chrome' } }).channel, 'chrome');
    assert.equal('channel' in opcionesDeLanzamiento({ navegador: { canal: null } }), false);
    assert.deepEqual(opcionesDeLanzamiento({ navegador: { idioma: 'es-CL', args: ['--lang=pt-BR'] } }).args, ['--lang=pt-BR']);
});

test('contexto: el locale sale del idioma de la config, también con dispositivo móvil', () => {
    const base = { baseURL: 'http://localhost:8031', actores: { a: {}, m: { dispositivo: 'Pixel 7' } } };
    const medidas = { ancho: 1600, alto: 1000 };
    assert.equal(opcionesDeContexto(base, 'a', {}, medidas).opciones.locale, 'es-CL');
    assert.equal(opcionesDeContexto(base, 'm', {}, medidas).opciones.locale, 'es-CL');
    const en = { ...base, navegador: { idioma: 'en-US' } };
    assert.equal(idiomaDeNavegador(en), 'en-US');
    assert.equal(opcionesDeContexto(en, 'm', {}, medidas).opciones.locale, 'en-US');
});

test('config: defaults de navegador y validación de idioma/canal', async () => {
    const proyecto = (navegador) => {
        const dir = mkdtempSync(join(tmpdir(), 'demo-idioma-'));
        mkdirSync(join(dir, 'guiones'));
        const cfg = { baseURL: 'http://localhost:8031', marca: { nombre: 'S' }, actores: { f: { email: 'f@x.cl', password: 'password' } }, guiones: './guiones', salida: './salida', ...(navegador ? { navegador } : {}) };
        writeFileSync(join(dir, 'demo.config.mjs'), `export default ${JSON.stringify(cfg)};`);
        return dir;
    };
    assert.deepEqual((await cargarConfig(proyecto())).navegador, { args: [], idioma: 'es-CL', canal: 'chromium' });
    const c = await cargarConfig(proyecto({ idioma: 'pt-BR', canal: null }));
    assert.equal(c.navegador.idioma, 'pt-BR');
    assert.equal(c.navegador.canal, null);
    for (const malo of [{ idioma: 'español' }, { idioma: '' }, { idioma: 5 }, { canal: '' }, { canal: 3 }]) {
        await assert.rejects(cargarConfig(proyecto(malo)), ErrorConfig, JSON.stringify(malo));
    }
});

test('capturarContexto lanza Chromium con channel/--lang y abre el contexto con locale', async (t) => {
    const lanzamientos = [];
    const contextos = [];
    const lanzar = chromium.launch;
    chromium.launch = async function (opciones) {
        lanzamientos.push(opciones);
        const navegador = await lanzar.call(this, opciones);
        const nuevo = navegador.newContext.bind(navegador);
        navegador.newContext = async (o) => { contextos.push(o); return nuevo(o); };
        return navegador;
    };
    const juguete = await iniciarJuguete({ puerto: 0 });
    try {
        const salida = mkdtempSync(join(tmpdir(), 'demo-idioma-'));
        const config = {
            baseURL: juguete.url, video: { ancho: 640, alto: 480 }, actores: {},
            navegador: { idioma: 'es-CL', args: [] },
            contexto: { salida, pantallas: [{ id: 'inicio', ruta: '/' }] },
        };
        await capturarContexto({ config, sesiones: {}, salida });
    } catch (error) {
        if (/process_singleton|Target page, context or browser has been closed/.test(String(error))) {
            t.skip('el Chromium completo no arranca en este sandbox (socket()): correr fuera del sandbox');
            return;
        }
        throw error;
    } finally {
        chromium.launch = lanzar;
        await juguete.cerrar();
    }
    assert.equal(lanzamientos.length, 1);
    assert.equal(lanzamientos[0].channel, 'chromium');
    assert.ok(lanzamientos[0].args.includes('--lang=es-CL'));
    // Contexto público (sin actor): también con el locale del idioma configurado.
    assert.equal(contextos.length, 1);
    assert.equal(contextos[0].locale, 'es-CL');
});

test('real: <input type=file> y <input type=date> se dibujan en español, no en inglés', async (t) => {
    const html = '<input type=file id=f><input type=date id=d>';
    const textos = async (lanzamiento, locale) => {
        const navegador = await chromium.launch(lanzamiento);
        try {
            const ctx = await navegador.newContext({ locale });
            const page = await ctx.newPage();
            await page.setContent(html);
            // Lo que el navegador DIBUJA en esos controles solo existe en el árbol de
            // accesibilidad (no en el DOM): «Choose File» / «Seleccionar archivo», dd/mm/yyyy…
            const cdp = await ctx.newCDPSession(page);
            const { nodes } = await cdp.send('Accessibility.getFullAXTree');
            return nodes.flatMap((n) => [n.name?.value, n.value?.value]).filter(Boolean).join(' | ');
        } finally {
            await navegador.close();
        }
    };
    let dibujado;
    try {
        dibujado = await textos(opcionesDeLanzamiento({}), 'es-CL');
    } catch (error) {
        if (/process_singleton|Target page, context or browser has been closed/.test(String(error))) {
            t.skip('el Chromium completo no arranca en este sandbox (socket()): correr fuera del sandbox');
            return;
        }
        throw error;
    }
    assert.doesNotMatch(dibujado, /Choose File|No file chosen|yyyy/i, dibujado);
    assert.match(dibujado, /Seleccionar archivo/, dibujado);
    assert.match(dibujado, /aaaa/, dibujado);
    // Contraprueba: el lanzamiento de antes (headless-shell, sin --lang) sigue en inglés.
    assert.match(await textos({}, 'es-CL'), /Choose File/);
});
