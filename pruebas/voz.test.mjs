import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { crearVoz } from '../src/voz/index.mjs';
import { duracion } from '../src/ffmpeg.mjs';

test('sin ningún motor instalado, la voz se declara no disponible y no revienta', () => {
    const voz = crearVoz({ motor: 'inexistente', respaldo: 'tampoco' });
    assert.equal(voz.disponible(), false);
    assert.equal(voz.sintetizar('hola'), null);
});

test('cae al respaldo cuando el motor principal no está', () => {
    const voz = crearVoz({ motor: 'inexistente', voz: 'x', respaldo: 'piper' });
    if (!voz.disponible()) return; // sin Piper instalado, no hay nada que comprobar
    assert.equal(voz.motor, 'piper');
});

function capturarStderr(fn) {
    const escrito = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { escrito.push(String(chunk)); return true; };
    try {
        fn();
    } finally {
        process.stderr.write = original;
    }
    return escrito.join('');
}

test('si se pide voz y no hay ningún motor, avisa por stderr en vez de fallar en silencio', () => {
    const texto = capturarStderr(() => {
        const voz = crearVoz({ motor: 'inexistente', respaldo: 'tampoco' });
        assert.equal(voz.disponible(), false);
    });
    assert.match(texto, /AVISO/);
    assert.match(texto, /voz/i);
    assert.match(texto, /instalar-voces\.sh/);
});

test('con motor "ninguno" explícito, no avisa: es una degradación deseada, no un error', () => {
    const texto = capturarStderr(() => {
        crearVoz({ motor: 'ninguno', respaldo: 'ninguno' });
    });
    assert.equal(texto, '');
});

test('sintetiza un wav audible con la duración esperable para la frase', { skip: !process.env.DEMO_CON_VOZ }, () => {
    const voz = crearVoz({ motor: 'kokoro', voz: 'ef_dora', respaldo: 'piper' });
    assert.ok(voz.disponible(), 'corre con DEMO_CON_VOZ=1 solo si instalaste las voces');
    const wav = voz.sintetizar('El funcionario revisa los documentos del ciudadano.');
    assert.ok(existsSync(wav));
    const seg = duracion(wav);
    assert.ok(seg > 1.5 && seg < 12, `duración fuera de rango: ${seg}s`);
});
