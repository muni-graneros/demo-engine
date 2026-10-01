import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { ejecutarGuion, Interrupcion, pasosEnOrden } from '../src/ejecutor.mjs';
import { declararEntornoDePruebas } from './entorno.mjs';

// El guardián de privacidad ya no infiere el entorno por la IP: hay que declararlo.
declararEntornoDePruebas();

// El ejecutor es la semántica del guion que comparten `grabar()` y `vivo()`. Las pruebas de
// grabador.test.mjs cuidan que la grabación no cambie; éstas cuidan el contrato de los ganchos,
// que es lo que usa el modo en vivo (saltar, reintentar, interrumpir, reutilizar contextos).

const configDe = (url, actores) => ({
    baseURL: url,
    actores,
    video: { ancho: 640, alto: 480, pausaMinima: 0 },
    auditoria: { patron: '(?<![\\d-])\\d{7,8}-[\\dkK](?![\\dkK])', chequeoEnVivo: true },
});

async function conNavegador(fn) {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    try {
        return await fn(juguete.url, navegador);
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
}

test('los ganchos corren en orden por paso, con el portero entre esperarNarracion y despuesDePaso', async () => {
    await conNavegador(async (url, navegador) => {
        const config = configDe(url, { a: { sesion: false }, b: { sesion: false } });
        const rastro = [];
        const ir = (ruta) => async (page) => { rastro.push(`hacer:${ruta}`); await page.goto(`${url}${ruta}`); };
        const guion = { id: 'g', escenas: [
            { id: 'e1', titulo: 'E1', pasos: [
                { actor: 'a', narrar: 'uno', hacer: ir('/') },
                { actor: 'b', narrar: 'dos', dividir: ['a', 'b'], hacer: ir('/') },
            ] },
            { id: 'e2', titulo: 'E2', pasos: [{ actor: 'a', narrar: 'tres', hacer: ir('/') }] },
        ] };
        const { actores } = await ejecutarGuion(guion, { config, navegador, ganchos: {
            alAbrirActor: (nombre, datos) => { rastro.push(`abrir:${nombre}`); datos.marca = nombre; },
            antesDePaso: ({ paso, dividir, actor }) => { rastro.push(`antes:${paso.narrar}:${JSON.stringify(dividir)}:${actor.marca}`); },
            alNarrar: ({ paso }) => { rastro.push(`narrar:${paso.narrar}`); },
            esperarNarracion: ({ paso }) => { rastro.push(`esperar:${paso.narrar}`); },
            despuesDePaso: ({ paso }) => { rastro.push(`despues:${paso.narrar}`); },
        } });
        assert.deepEqual(rastro, [
            'abrir:a', 'antes:uno:null:a', 'narrar:uno', 'hacer:/', 'esperar:uno', 'despues:uno',
            // dividir abre al otro actor ANTES del paso, en el orden del par.
            'abrir:b', 'antes:dos:["a","b"]:b', 'narrar:dos', 'hacer:/', 'esperar:dos', 'despues:dos',
            // y no cruza de escena.
            'antes:tres:null:a', 'narrar:tres', 'hacer:/', 'esperar:tres', 'despues:tres',
        ]);
        assert.deepEqual([...actores.keys()], ['a', 'b']);
    });
});

test('antesDePaso puede saltar un paso sin ejecutarlo', async () => {
    await conNavegador(async (url, navegador) => {
        const config = configDe(url, { a: { sesion: false } });
        const hechos = [];
        const guion = { id: 'g', escenas: [{ id: 'e', titulo: 'E', pasos: [
            { actor: 'a', narrar: '1', hacer: async () => { hechos.push(1); } },
            { actor: 'a', narrar: '2', hacer: async () => { hechos.push(2); } },
        ] }] };
        await ejecutarGuion(guion, { config, navegador, ganchos: {
            antesDePaso: ({ paso }) => (paso.narrar === '1' ? 'saltar' : undefined),
        } });
        assert.deepEqual(hechos, [2]);
    });
});

test('sin alFallar, el error sale envuelto con guion, escena, paso y actor', async () => {
    await conNavegador(async (url, navegador) => {
        const config = configDe(url, { a: { sesion: false } });
        const guion = { id: 'g', escenas: [{ id: 'e', titulo: 'La escena', pasos: [
            { actor: 'a', hacer: async () => {} },
            { actor: 'a', hacer: async () => { throw new Error('selector roto'); } },
        ] }] };
        await assert.rejects(() => ejecutarGuion(guion, { config, navegador }), (error) => {
            assert.match(error.message, /guion "g", escena "e" \("La escena"\), paso 2 \(actor "a"\): selector roto/);
            assert.equal(error.cause.message, 'selector roto');
            return true;
        });
    });
});

test('alFallar decide: reintentar vuelve a ejecutar el paso y saltar sigue con el siguiente', async () => {
    await conNavegador(async (url, navegador) => {
        const config = configDe(url, { a: { sesion: false } });
        let intentos = 0;
        const hechos = [];
        const guion = { id: 'g', escenas: [{ id: 'e', titulo: 'E', pasos: [
            { actor: 'a', narrar: 'frágil', hacer: async () => { intentos++; if (intentos < 3) throw new Error(`intento ${intentos}`); hechos.push('frágil'); } },
            { actor: 'a', narrar: 'roto', hacer: async () => { throw new Error('siempre'); } },
            { actor: 'a', narrar: 'final', hacer: async () => { hechos.push('final'); } },
        ] }] };
        const errores = [];
        await ejecutarGuion(guion, { config, navegador, ganchos: {
            alFallar: (error, { paso }) => {
                errores.push(error.message);
                return paso.narrar === 'frágil' ? 'reintentar' : 'saltar';
            },
        } });
        assert.equal(intentos, 3);
        assert.deepEqual(hechos, ['frágil', 'final']);
        assert.equal(errores.length, 3);
        assert.match(errores[2], /paso 2 .*siempre/);
    });
});

test('el portero falla el paso (y pasa por alFallar) cuando hay varias personas a la vista', async () => {
    await conNavegador(async (url, navegador) => {
        const config = configDe(url, { f: { email: 'f@x.cl', password: 'password' } });
        // Sesión a mano: el panel del juguete solo pide la cookie.
        const sesiones = { f: { cookies: [{ name: 'sesion', value: 'funcionario', url }], origins: [] } };
        const guion = { id: 'g', escenas: [{ id: 'e', titulo: 'E', pasos: [
            { actor: 'f', hacer: async (page) => { await page.goto(`${url}/panel`); } },
        ] }] };
        let visto = null;
        await ejecutarGuion(guion, { config, sesiones, navegador, ganchos: {
            alFallar: (error) => { visto = error.message; return 'saltar'; },
        } });
        assert.match(visto ?? '', /identificadores distintos/);
    });
});

test('una Interrupcion lanzada por un gancho sale tal cual, sin envolver ni pasar por alFallar', async () => {
    await conNavegador(async (url, navegador) => {
        const config = configDe(url, { a: { sesion: false } });
        const guion = { id: 'g', escenas: [{ id: 'e', titulo: 'E', pasos: [{ actor: 'a', hacer: async () => {} }] }] };
        let llamoAlFallar = false;
        await assert.rejects(() => ejecutarGuion(guion, { config, navegador, ganchos: {
            antesDePaso: () => { throw new Interrupcion('ir', { indice: 3 }); },
            alFallar: () => { llamoAlFallar = true; return 'saltar'; },
        } }), (error) => {
            assert.ok(error instanceof Interrupcion);
            assert.equal(error.tipo, 'ir');
            assert.equal(error.indice, 3);
            return true;
        });
        assert.equal(llamoAlFallar, false);
    });
});

test('un mapa de actores pasado desde afuera se reutiliza entre guiones: no se reabre el contexto', async () => {
    await conNavegador(async (url, navegador) => {
        const config = configDe(url, { a: { sesion: false } });
        const actores = new Map();
        let aperturas = 0;
        const ganchos = { alAbrirActor: () => { aperturas++; } };
        const guion = (id) => ({ id, escenas: [{ id: 'e', titulo: 'E', pasos: [
            { actor: 'a', hacer: async (page) => { await page.goto(`${url}/`); } },
        ] }] });
        await ejecutarGuion(guion('uno'), { config, navegador, actores, ganchos });
        const pagina = actores.get('a').page;
        await ejecutarGuion(guion('dos'), { config, navegador, actores, ganchos });
        assert.equal(aperturas, 1);
        assert.equal(actores.get('a').page, pagina);
    });
});

test('opcionesDeActor retoca las opciones del contexto antes de crearlo', async () => {
    await conNavegador(async (url, navegador) => {
        const config = configDe(url, { a: { sesion: false } });
        const guion = { id: 'g', escenas: [{ id: 'e', titulo: 'E', pasos: [{ actor: 'a', hacer: async () => {} }] }] };
        const { actores } = await ejecutarGuion(guion, { config, navegador, ganchos: {
            opcionesDeActor: (nombre, opciones) => ({ ...opciones, viewport: { width: 500, height: 400 } }),
        } });
        assert.deepEqual(actores.get('a').page.viewportSize(), { width: 500, height: 400 });
    });
});

test('pasosEnOrden aplana escenas y pasos con su posición', () => {
    const guion = { escenas: [
        { id: 'a', pasos: [{ narrar: '1' }, { narrar: '2' }] },
        { id: 'b', pasos: [{ narrar: '3' }] },
    ] };
    assert.deepEqual(pasosEnOrden(guion).map((p) => [p.escena.id, p.indiceEscena, p.indice, p.paso.narrar]),
        [['a', 0, 0, '1'], ['a', 0, 1, '2'], ['b', 1, 0, '3']]);
});
