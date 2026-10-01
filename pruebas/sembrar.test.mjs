import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comandoDeSembrado, sembrarEnSegundoPlano } from '../src/sembrar.mjs';
import { cargarConfig, ErrorConfig } from '../src/configurar.mjs';

test('sembrar como string se usa tal cual, con o sin escena', () => {
    const config = { sembrar: 'npm run seed' };
    assert.equal(comandoDeSembrado(config), 'npm run seed');
    assert.equal(comandoDeSembrado(config, { escena: 'asignado' }), 'npm run seed');
});

test('sembrar como función recibe la escena y decide su propio defecto sin ella', () => {
    const config = { sembrar: ({ escena = 'inicio' } = {}) => `seed --escena=${escena}` };
    assert.equal(comandoDeSembrado(config), 'seed --escena=inicio');
    assert.equal(comandoDeSembrado(config, { escena: 'asignado' }), 'seed --escena=asignado');
});

test('sin siembra (null, vacío o función que devuelve null) no hay comando', () => {
    assert.equal(comandoDeSembrado({ sembrar: null }), null);
    assert.equal(comandoDeSembrado({ sembrar: '' }), null);
    assert.equal(comandoDeSembrado({ sembrar: () => null }), null);
});

test('una función que no devuelve un string es un error de configuración', () => {
    assert.throws(() => comandoDeSembrado({ sembrar: () => 42 }), ErrorConfig);
});

test('sembrarEnSegundoPlano corre el comando sin bloquear y falla con el código de salida', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sembrar-'));
    const rastro = join(dir, 'rastro.txt');
    const lineas = [];
    const comando = await sembrarEnSegundoPlano(
        { sembrar: ({ escena }) => `echo ${escena} > ${rastro} && echo listo` }, { escena: 'resuelto' },
        { alEscribir: (l) => lineas.push(l) });
    assert.match(comando, /echo resuelto/);
    assert.equal(readFileSync(rastro, 'utf8').trim(), 'resuelto');
    assert.deepEqual(lineas, ['listo']);
    await assert.rejects(() => sembrarEnSegundoPlano({ sembrar: 'exit 3' }), /código 3/);
});

test('la config acepta sembrar como función y rechaza otro tipo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sembrar-cfg-'));
    const escribir = (sembrar) => writeFileSync(join(dir, 'demo.config.mjs'), `export default {
        baseURL: 'http://127.0.0.1:1', marca: { nombre: 'X' }, guiones: '.',
        actores: { a: { sesion: false } }, sembrar: ${sembrar},
    };`);
    escribir('({ escena = "inicio" } = {}) => "seed " + escena');
    // Import con caché: cada variante va en su propio directorio.
    const config = await cargarConfig(dir);
    assert.equal(comandoDeSembrado(config, { escena: 'x' }), 'seed x');
    assert.deepEqual(config.vivo.pantalla, { x: 0, y: 0, ancho: 1920, alto: 1080 });

    const otro = mkdtempSync(join(tmpdir(), 'sembrar-cfg-'));
    writeFileSync(join(otro, 'demo.config.mjs'), `export default {
        baseURL: 'http://127.0.0.1:1', marca: { nombre: 'X' }, guiones: '.',
        actores: { a: { sesion: false } }, sembrar: 42,
    };`);
    await assert.rejects(() => cargarConfig(otro), /sembrar debe ser un string o una función/);
});
