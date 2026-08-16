import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolverVenvYVoces, RUTA_PAQUETE } from '../src/voz/resolver.mjs';

test('sin overrides, encuentra los modelos en el directorio del PAQUETE aunque el cwd sea otro', () => {
    // Este repo ES el paquete: en una máquina de desarrollo ya trae .venv/.voces instalados
    // en su raíz (ver herramientas/instalar-voces.sh) y esos ~670 MB no se instalan en CI a
    // propósito (ver pruebas/voz.test.mjs). Si no existen, se deja acá un fixture mínimo
    // —justo lo que resolverUno() mira con existsSync()— para que la prueba no dependa de
    // instalación real; si ya existían (desarrollo local), se dejan intactos y no se tocan.
    // El bug real que esto prueba era resolver contra process.cwd(), que en un sistema
    // consumidor NO es la raíz de demo-engine.
    const venvPaquete = resolve(RUTA_PAQUETE, '.venv');
    const vocesPaquete = resolve(RUTA_PAQUETE, '.voces');
    const creoVenv = !existsSync(venvPaquete);
    const creoVoces = !existsSync(vocesPaquete);
    if (creoVenv) {
        mkdirSync(join(venvPaquete, 'bin'), { recursive: true });
        writeFileSync(join(venvPaquete, 'bin', 'python'), '#!/bin/sh\n', { mode: 0o755 });
    }
    if (creoVoces) mkdirSync(vocesPaquete, { recursive: true });

    const cwdOriginal = process.cwd();
    const otro = mkdtempSync(join(tmpdir(), 'demo-otro-cwd-'));
    process.chdir(otro);
    try {
        const { venv, voces } = resolverVenvYVoces({});
        assert.equal(venv, venvPaquete);
        assert.equal(voces, vocesPaquete);
        assert.ok(existsSync(join(venv, 'bin', 'python')), 'debe resolver al venv del paquete, no al cwd');
        assert.ok(!venv.startsWith(otro), 'no puede haber resuelto contra el cwd del consumidor');
    } finally {
        process.chdir(cwdOriginal);
        if (creoVenv) rmSync(venvPaquete, { recursive: true, force: true });
        if (creoVoces) rmSync(vocesPaquete, { recursive: true, force: true });
    }
});

test('la config tiene prioridad sobre todo lo demás', () => {
    const dirConfig = mkdtempSync(join(tmpdir(), 'demo-venv-config-'));
    process.env.DEMO_VENV = '/no/existe/por-env';
    try {
        const { venv } = resolverVenvYVoces({ venv: dirConfig });
        assert.equal(venv, resolve(dirConfig));
    } finally {
        delete process.env.DEMO_VENV;
    }
});

test('sin config, usa las variables de entorno', () => {
    const dirEnv = mkdtempSync(join(tmpdir(), 'demo-venv-env-'));
    process.env.DEMO_VENV = dirEnv;
    process.env.DEMO_VOCES = dirEnv;
    try {
        const { venv, voces } = resolverVenvYVoces({});
        assert.equal(venv, resolve(dirEnv));
        assert.equal(voces, resolve(dirEnv));
    } finally {
        delete process.env.DEMO_VENV;
        delete process.env.DEMO_VOCES;
    }
});

test('las rutas relativas (de config o de env) se resuelven contra el cwd actual', () => {
    const cwdOriginal = process.cwd();
    const otro = mkdtempSync(join(tmpdir(), 'demo-relativo-cwd-'));
    process.chdir(otro);
    try {
        const { venv } = resolverVenvYVoces({ venv: './mi-venv-relativo' });
        assert.equal(venv, resolve(otro, 'mi-venv-relativo'));

        process.env.DEMO_VOCES = './mis-voces-relativas';
        const { voces } = resolverVenvYVoces({});
        assert.equal(voces, resolve(otro, 'mis-voces-relativas'));
    } finally {
        delete process.env.DEMO_VOCES;
        process.chdir(cwdOriginal);
    }
});
