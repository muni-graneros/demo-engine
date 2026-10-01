import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { comandoDeSembrado, sembrar, sembrarEnSegundoPlano } from '../src/sembrar.mjs';
import * as motor from '../src/index.mjs';
import { cargarConfig, ErrorConfig } from '../src/configurar.mjs';

test('sembrar como string se usa tal cual, con o sin escena', async () => {
    const config = { sembrar: 'npm run seed' };
    assert.equal(await comandoDeSembrado(config), 'npm run seed');
    assert.equal(await comandoDeSembrado(config, { escena: 'asignado' }), 'npm run seed');
});

test('sembrar como función recibe la escena y decide su propio defecto sin ella', async () => {
    const config = { sembrar: ({ escena = 'inicio' } = {}) => `seed --escena=${escena}` };
    assert.equal(await comandoDeSembrado(config), 'seed --escena=inicio');
    assert.equal(await comandoDeSembrado(config, { escena: 'asignado' }), 'seed --escena=asignado');
});

test('sin siembra (null, vacío o función que devuelve null) no hay comando', async () => {
    assert.equal(await comandoDeSembrado({ sembrar: null }), null);
    assert.equal(await comandoDeSembrado({ sembrar: '' }), null);
    assert.equal(await comandoDeSembrado({ sembrar: () => null }), null);
});

test('una función que no devuelve un string es un error de configuración', async () => {
    await assert.rejects(() => comandoDeSembrado({ sembrar: () => 42 }), ErrorConfig);
    await assert.rejects(() => comandoDeSembrado({ sembrar: async () => ({}) }), ErrorConfig);
});

test('sembrar como función async: se espera, y si devuelve un comando se ejecuta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sembrar-async-'));
    const rastro = join(dir, 'rastro.txt');
    const config = {
        sembrar: async ({ escena = 'inicio' } = {}) => {
            await new Promise((r) => setTimeout(r, 20));
            return `echo ${escena} >> ${rastro}`;
        },
    };
    assert.equal(await sembrar(config), `echo inicio >> ${rastro}`);
    await sembrar(config, { escena: 'asignado' });
    assert.deepEqual(readFileSync(rastro, 'utf8').trim().split('\n'), ['inicio', 'asignado']);
});

test('sembrar como función async que siembra por su cuenta (devuelve nada): se espera y no se ejecuta ningún comando', async () => {
    const llamadas = [];
    let terminada = false;
    const config = {
        sembrar: async (contexto) => {
            llamadas.push(contexto);
            await new Promise((r) => setTimeout(r, 30));
            terminada = true;
        },
    };
    assert.equal(await sembrar(config, { escena: 'resuelto', guion: 'c09' }), null);
    assert.ok(terminada, 'sembrar() volvió antes de que terminara la función del sistema');
    assert.deepEqual(llamadas, [{ escena: 'resuelto', guion: 'c09' }]);
    // Igual en segundo plano (la demo en vivo).
    assert.equal(await sembrarEnSegundoPlano(config, { escena: 'inicio' }), null);
    assert.equal(llamadas.length, 2);
});

test('si la función de sembrar falla, el error sale con el motivo', async () => {
    await assert.rejects(() => sembrar({ sembrar: async () => { throw new Error('docker caído'); } }), /docker caído/);
    await assert.rejects(() => sembrar({ sembrar: 'exit 4' }));
});

test('CAPACIDADES declara sembrar-funcion: el consumidor la consulta en MOTOR_ACEPTA_FUNCION', () => {
    assert.ok(motor.CAPACIDADES.includes('sembrar-funcion'));
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
    assert.equal(await comandoDeSembrado(config, { escena: 'x' }), 'seed x');
    assert.deepEqual(config.vivo.pantalla, { x: 0, y: 0, ancho: 1920, alto: 1080 });

    const otro = mkdtempSync(join(tmpdir(), 'sembrar-cfg-'));
    writeFileSync(join(otro, 'demo.config.mjs'), `export default {
        baseURL: 'http://127.0.0.1:1', marca: { nombre: 'X' }, guiones: '.',
        actores: { a: { sesion: false } }, sembrar: 42,
    };`);
    await assert.rejects(() => cargarConfig(otro), /sembrar debe ser un string o una función/);
});
