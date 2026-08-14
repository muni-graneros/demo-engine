import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearVoz } from '../src/voz/index.mjs';
import { duracion } from '../src/ffmpeg.mjs';

/** Venv falso cuyo `python` siempre falla con un mensaje reconocible, para probar que el
 * aviso por stderr de `crearVoz` propaga el motivo concreto, no solo "no disponible". */
function venvQueFalla(mensaje) {
    const venv = mkdtempSync(join(tmpdir(), 'voz-venv-falla-'));
    mkdirSync(join(venv, 'bin'), { recursive: true });
    const py = join(venv, 'bin', 'python');
    writeFileSync(py, `#!/usr/bin/env bash\necho "${mensaje}" >&2\nexit 1\n`);
    chmodSync(py, 0o755);
    const voces = mkdtempSync(join(tmpdir(), 'voz-voces-falla-'));
    writeFileSync(join(voces, 'x.onnx'), '');
    return { venv, voces };
}

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

test('si el motor principal existe pero la síntesis de prueba falla, el aviso trae el motivo concreto', () => {
    // Mismo patrón de falla silenciosa que costó un curso mudo: los archivos podían estar
    // en disco (piper "instalado") y aun así fallar al sintetizar. El aviso tiene que decir
    // POR QUÉ, no solo repetir "no disponible".
    const mensaje = 'no se pudo cargar el modelo: biblioteca nativa ausente';
    const { venv, voces } = venvQueFalla(mensaje);
    const texto = capturarStderr(() => {
        const voz = crearVoz({ motor: 'piper', voz: 'x', respaldo: 'ninguno', venv, voces });
        assert.equal(voz.disponible(), false);
    });
    assert.match(texto, /AVISO/);
    assert.match(texto, /biblioteca nativa ausente/);
});

test('sintetiza un wav audible con la duración esperable para la frase', { skip: !process.env.DEMO_CON_VOZ }, () => {
    const voz = crearVoz({ motor: 'kokoro', voz: 'ef_dora', respaldo: 'piper' });
    assert.ok(voz.disponible(), 'corre con DEMO_CON_VOZ=1 solo si instalaste las voces');
    const wav = voz.sintetizar('El funcionario revisa los documentos del ciudadano.');
    assert.ok(existsSync(wav));
    const seg = duracion(wav);
    assert.ok(seg > 1.5 && seg < 12, `duración fuera de rango: ${seg}s`);
});
