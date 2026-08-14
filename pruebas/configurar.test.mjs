import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cargarConfig, ErrorConfig } from '../src/configurar.mjs';

function proyecto(config) {
    const dir = mkdtempSync(join(tmpdir(), 'demo-cfg-'));
    mkdirSync(join(dir, 'guiones'));
    writeFileSync(join(dir, 'demo.config.mjs'), `export default ${JSON.stringify(config)};`);
    return dir;
}

const minima = {
    baseURL: 'http://localhost:8031',
    marca: { nombre: 'Sistema' },
    actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
    guiones: './guiones',
    salida: './salida',
};

test('aplica los valores por defecto', async () => {
    const cfg = await cargarConfig(proyecto(minima));
    assert.equal(cfg.video.ancho, 1600);
    assert.equal(cfg.video.alto, 1000);
    assert.equal(cfg.video.pausaMinima, 1200);
    assert.equal(cfg.voz.motor, 'kokoro');
    assert.equal(cfg.voz.respaldo, 'piper');
    assert.equal(cfg.voz.venv, null);
    assert.equal(cfg.voz.voces, null);
    assert.equal(cfg.marca.color, '#1e3a8a');
});

test('voz.venv y voz.voces relativos se resuelven contra la raíz del proyecto', async () => {
    const dir = proyecto({ ...minima, voz: { venv: './mi-venv', voces: './mis-voces' } });
    const cfg = await cargarConfig(dir);
    assert.equal(cfg.voz.venv, resolve(dir, 'mi-venv'));
    assert.equal(cfg.voz.voces, resolve(dir, 'mis-voces'));
});

test('falla si no hay actores, diciendo cuál es el problema', async () => {
    const dir = proyecto({ ...minima, actores: {} });
    await assert.rejects(() => cargarConfig(dir), (e) => {
        assert.ok(e instanceof ErrorConfig);
        assert.match(e.message, /actores/);
        return true;
    });
});

test('falla si un actor no trae email o password', async () => {
    const dir = proyecto({ ...minima, actores: { funcionario: { email: 'f@x.cl' } } });
    await assert.rejects(() => cargarConfig(dir), /funcionario.*password/);
});

test('falla si la carpeta de guiones no existe', async () => {
    const dir = proyecto({ ...minima, guiones: './no-existe' });
    await assert.rejects(() => cargarConfig(dir), /guiones/);
});

test('falla si baseURL no es una URL', async () => {
    const dir = proyecto({ ...minima, baseURL: 'localhost:8031' });
    await assert.rejects(() => cargarConfig(dir), /baseURL/);
});
