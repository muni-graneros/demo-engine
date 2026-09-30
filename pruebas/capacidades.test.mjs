import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as motor from '../src/index.mjs';

// Los consumidores preguntan qué sabe hacer el motor instalado antes de usarlo
// (seguridad-graneros: `motor.CAPACIDADES?.includes('…')` en demo.config.mjs y vivo.sh), en vez
// de comparar versiones: una capacidad declarada tiene que existir de verdad, y una que no
// existe no puede declararse, porque el consumidor cambia de camino según esta lista.
test('CAPACIDADES declara lo que trae la 1.15 y cada una tiene su API', () => {
    assert.ok(Object.isFrozen(motor.CAPACIDADES), 'un consumidor no puede modificarla');
    for (const c of ['acercar-ajustado', 'cursor-tactil', 'subtitulos-partidos', 'navegador-args',
        'planos-pantalla-completa', 'dividida-con-foco', 'ficha-sin-tapar', 'anotar-al-lado', 'sin-destellos']) {
        assert.ok(motor.CAPACIDADES.includes(c), `falta ${c}`);
    }
    assert.equal(new Set(motor.CAPACIDADES).size, motor.CAPACIDADES.length, 'sin repetidas');
    assert.equal(typeof motor.escalaQueCabe, 'function');
    assert.equal(typeof motor.configurarCursor, 'function');
    assert.equal(typeof motor.partirCue, 'function');
    assert.equal(typeof motor.esPlano, 'function');
    assert.equal(typeof motor.configurarPresentacion, 'function');
});

test('CAPACIDADES no promete lo que el motor no hace (sembrar como función, demo vivo)', () => {
    // seguridad-graneros pasa `sembrar` como FUNCIÓN si ve 'sembrar-funcion'; este motor hace
    // execSync(config.sembrar) y reventaría. Y vivo.sh exige 'vivo', un comando que no existe.
    assert.ok(!motor.CAPACIDADES.includes('sembrar-funcion'));
    assert.ok(!motor.CAPACIDADES.includes('vivo'));
});
