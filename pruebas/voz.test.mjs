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

/**
 * Venv compartido por piper y kokoro donde solo kokoro "funciona": kokoro se invoca con
 * `-c` como primer argumento (ver src/voz/kokoro.mjs), piper con `-m` (ver
 * src/voz/piper.mjs). El script distingue por eso, no por contenido de los modelos, porque
 * ambos motores comparten el mismo venv/voces en `crearVoz` (un solo par de rutas para
 * motor+respaldo).
 */
function venvMixto({ mensajeFallaPiper = 'piper explotó al arrancar' } = {}) {
    const venv = mkdtempSync(join(tmpdir(), 'voz-venv-mixto-'));
    mkdirSync(join(venv, 'bin'), { recursive: true });
    const py = join(venv, 'bin', 'python');
    writeFileSync(py, `#!/usr/bin/env bash
destino="\${@: -1}"
if [ "$1" = "-c" ]; then
  printf 'RIFFfake' > "$destino"
  exit 0
fi
echo "${mensajeFallaPiper}" >&2
exit 1
`);
    chmodSync(py, 0o755);

    const voces = mkdtempSync(join(tmpdir(), 'voz-voces-mixto-'));
    writeFileSync(join(voces, 'x.onnx'), '');               // piper: archivo presente, pero falla al ARRANCAR
    writeFileSync(join(voces, 'kokoro-v1.0.onnx'), '');
    writeFileSync(join(voces, 'voices-v1.0.bin'), '');

    return { venv, voces };
}

test('si el motor principal cae al respaldo por un fallo de sonda, se avisa por stderr (no degrada en silencio)', () => {
    // Defecto real: crearVoz solo avisaba si NINGÚN motor respondía. Si el principal fallaba
    // (por ejemplo, la sonda de Kokoro cayendo por un fallo transitorio) y el respaldo SÍ
    // funcionaba, el curso entero se grababa con Piper sin que nadie se enterara del cambio.
    const { venv, voces } = venvMixto();
    const texto = capturarStderr(() => {
        const voz = crearVoz({ motor: 'piper', voz: 'x', respaldo: 'kokoro', venv, voces });
        assert.equal(voz.motor, 'kokoro', 'debió caer al respaldo');
        assert.equal(voz.disponible(), true);
    });
    assert.match(texto, /AVISO/);
    assert.match(texto, /piper/);
    assert.match(texto, /kokoro/);
    assert.match(texto, /piper explotó al arrancar/,
        'el aviso de la caída a respaldo debe traer el motivo concreto del fallo del principal');
});

test('el diagnóstico distingue "no instalado" de "falló al arrancar": no manda a reinstalar algo que no está roto', () => {
    // Defecto conexo: si ambos motores fallan la sonda en la misma ventana (o uno no está
    // instalado y el otro sí pero falla al arrancar), el aviso final tiene que decir CUÁL es
    // cuál. Confundirlos manda a alguien a reinstalar un motor que en realidad está bien
    // instalado y solo tropezó al arrancar.
    const venv = mkdtempSync(join(tmpdir(), 'voz-venv-ambos-'));
    mkdirSync(join(venv, 'bin'), { recursive: true });
    const py = join(venv, 'bin', 'python');
    writeFileSync(py, `#!/usr/bin/env bash\necho "kokoro no pudo arrancar" >&2\nexit 1\n`);
    chmodSync(py, 0o755);

    const voces = mkdtempSync(join(tmpdir(), 'voz-voces-ambos-'));
    // Solo deja los archivos de Kokoro: Piper queda sin modelo, "no instalado" de verdad.
    writeFileSync(join(voces, 'kokoro-v1.0.onnx'), '');
    writeFileSync(join(voces, 'voices-v1.0.bin'), '');

    const texto = capturarStderr(() => {
        const voz = crearVoz({ motor: 'piper', respaldo: 'kokoro', voz: 'x', venv, voces });
        assert.equal(voz.disponible(), false);
    });

    assert.match(texto, /piper.*no está instalado/i, 'a piper (sin modelo en disco) le corresponde "no instalado"');
    assert.match(texto, /kokoro.*falló al arrancar/i, 'a kokoro (con modelo, pero la sonda falló) le corresponde "falló al arrancar"');
    assert.match(texto, /kokoro no pudo arrancar/, 'debe traer el motivo real');
});

test('cae al respaldo con la voz del motor principal: el respaldo debe quedar disponible, no "ninguno"', () => {
    // Defecto real medido en los sistemas: { motor: 'kokoro', voz: 'ef_dora', respaldo: 'piper' }
    // reenviaba 'ef_dora' (nombre de voz de Kokoro) al respaldo Piper, que la busca como
    // archivo .voces/ef_dora.onnx y nunca la encuentra. El respaldo quedaba declarado pero
    // nunca podía funcionar: si Kokoro fallaba, la voz caía en silencio a "ninguno".
    const venv = mkdtempSync(join(tmpdir(), 'voz-venv-vozrespaldo-'));
    mkdirSync(join(venv, 'bin'), { recursive: true });
    const py = join(venv, 'bin', 'python');
    // kokoro (invocado con -c) siempre falla; piper (invocado con -m) siempre "funciona".
    writeFileSync(py, `#!/usr/bin/env bash
destino="\${@: -1}"
if [ "$1" = "-c" ]; then
  echo "kokoro no pudo arrancar" >&2
  exit 1
fi
printf 'RIFFfake' > "$destino"
exit 0
`);
    chmodSync(py, 0o755);

    const voces = mkdtempSync(join(tmpdir(), 'voz-voces-vozrespaldo-'));
    writeFileSync(join(voces, 'kokoro-v1.0.onnx'), '');
    writeFileSync(join(voces, 'voices-v1.0.bin'), '');
    // Solo está el modelo POR DEFECTO de Piper: nunca 'ef_dora.onnx' (nombre de voz Kokoro).
    writeFileSync(join(voces, 'es_ES-davefx-medium.onnx'), '');

    const texto = capturarStderr(() => {
        const voz = crearVoz({ motor: 'kokoro', voz: 'ef_dora', respaldo: 'piper', venv, voces });
        assert.equal(voz.motor, 'piper', 'debió caer al respaldo');
        assert.equal(voz.disponible(), true, 'el respaldo debe quedar disponible, no "ninguno"');
    });
    assert.match(texto, /AVISO/);
});

test('vozRespaldo declarado explícitamente elige el modelo Piper correspondiente', () => {
    const venv = mkdtempSync(join(tmpdir(), 'voz-venv-vozrespaldo2-'));
    mkdirSync(join(venv, 'bin'), { recursive: true });
    const py = join(venv, 'bin', 'python');
    writeFileSync(py, `#!/usr/bin/env bash
destino="\${@: -1}"
if [ "$1" = "-c" ]; then
  echo "kokoro no pudo arrancar" >&2
  exit 1
fi
printf 'RIFFfake' > "$destino"
exit 0
`);
    chmodSync(py, 0o755);

    const voces = mkdtempSync(join(tmpdir(), 'voz-voces-vozrespaldo2-'));
    writeFileSync(join(voces, 'kokoro-v1.0.onnx'), '');
    writeFileSync(join(voces, 'voices-v1.0.bin'), '');
    // Solo está el modelo explícito, NO el de defecto: si vozRespaldo no se usara, fallaría.
    writeFileSync(join(voces, 'es_ES-carlfm-x-low.onnx'), '');

    const voz = crearVoz({
        motor: 'kokoro', voz: 'ef_dora',
        respaldo: 'piper', vozRespaldo: 'es_ES-carlfm-x-low',
        venv, voces,
    });
    assert.equal(voz.motor, 'piper');
    assert.equal(voz.disponible(), true);
});

test('sintetiza un wav audible con la duración esperable para la frase', { skip: !process.env.DEMO_CON_VOZ }, () => {
    const voz = crearVoz({ motor: 'kokoro', voz: 'ef_dora', respaldo: 'piper' });
    assert.ok(voz.disponible(), 'corre con DEMO_CON_VOZ=1 solo si instalaste las voces');
    const wav = voz.sintetizar('El funcionario revisa los documentos del ciudadano.');
    assert.ok(existsSync(wav));
    const seg = duracion(wav);
    assert.ok(seg > 1.5 && seg < 12, `duración fuera de rango: ${seg}s`);
});
