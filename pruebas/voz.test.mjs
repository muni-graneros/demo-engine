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

test('sintetiza un wav audible con la duración esperable para la frase', { skip: !process.env.DEMO_CON_VOZ }, () => {
    const voz = crearVoz({ motor: 'kokoro', voz: 'ef_dora', respaldo: 'piper' });
    assert.ok(voz.disponible(), 'corre con DEMO_CON_VOZ=1 solo si instalaste las voces');
    const wav = voz.sintetizar('El funcionario revisa los documentos del ciudadano.');
    assert.ok(existsSync(wav));
    const seg = duracion(wav);
    assert.ok(seg > 1.5 && seg < 12, `duración fuera de rango: ${seg}s`);
});
