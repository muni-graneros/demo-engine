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

test('CAPACIDADES declara sembrar como función (1.16) y exporta lo que la respalda', () => {
    // seguridad-graneros pasa `sembrar` como FUNCIÓN si ve 'sembrar-funcion' (MOTOR_ACEPTA_FUNCION).
    // Sólo se declara con su implementación y sus pruebas (sembrar.test.mjs).
    assert.ok(motor.CAPACIDADES.includes('sembrar-funcion'));
    assert.equal(typeof motor.sembrar, 'function');
});

test('CAPACIDADES declara vivo (1.16): tools/demo/vivo.sh de seguridad-graneros la exige', () => {
    // Respaldada por vivo.test.mjs: headless de punta a punta por la API y por el CLI, y con
    // ventanas reales (headed, en el escritorio o bajo xvfb-run).
    assert.ok(motor.CAPACIDADES.includes('vivo'));
    assert.equal(typeof motor.vivo, 'function');
});

test('CAPACIDADES declara acabado y musica-generada (1.18) con su API', () => {
    // Respaldadas por acabado-*.test.mjs (plan de recorte, cámara, capas y el acabado con ffmpeg real).
    assert.ok(motor.CAPACIDADES.includes('acabado'));
    assert.ok(motor.CAPACIDADES.includes('musica-generada'));
    assert.equal(typeof motor.acabar, 'function');
    assert.equal(typeof motor.generarMusica, 'function');
    assert.equal(motor.DEFECTOS_ACABADO.fps, 60);
});
