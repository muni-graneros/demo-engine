import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as piper from '../src/voz/piper.mjs';
import * as kokoro from '../src/voz/kokoro.mjs';

/**
 * Arma un venv falso con un `bin/python` controlable: cuenta cuántas veces lo invocan (para
 * probar el cacheo de `disponible()`) y puede simular éxito o fallo con un mensaje concreto
 * (para probar que el aviso de error no se queda en "no disponible").
 *
 * No importa qué argumentos reciba (piper y kokoro invocan Python distinto): siempre trata
 * el ÚLTIMO argumento como la ruta de destino del .wav, que es donde ambos motores reales
 * escriben el archivo.
 */
function venvFalso({ modo = 'ok', mensaje = 'fallo simulado del motor' } = {}) {
    const venv = mkdtempSync(join(tmpdir(), 'voz-venv-'));
    mkdirSync(join(venv, 'bin'), { recursive: true });
    const contador = join(venv, 'contador.txt');
    writeFileSync(contador, '');
    const script = `#!/usr/bin/env bash
echo x >> "${contador}"
destino="\${@: -1}"
if [ "${modo}" = "fallar" ]; then
  echo "${mensaje}" >&2
  exit 1
fi
printf 'RIFFfake' > "$destino"
exit 0
`;
    const py = join(venv, 'bin', 'python');
    writeFileSync(py, script);
    chmodSync(py, 0o755);
    return { venv, contador };
}

function invocaciones(contador) {
    return readFileSync(contador, 'utf8').split('\n').filter(Boolean).length;
}

function vocesPiperFalsas() {
    const voces = mkdtempSync(join(tmpdir(), 'voz-voces-'));
    writeFileSync(join(voces, 'x.onnx'), '');
    return voces;
}

function vocesKokoroFalsas() {
    const voces = mkdtempSync(join(tmpdir(), 'voz-voces-'));
    writeFileSync(join(voces, 'kokoro-v1.0.onnx'), '');
    writeFileSync(join(voces, 'voices-v1.0.bin'), '');
    return voces;
}

for (const [nombre, motor, vocesFalsas] of [['piper', piper, vocesPiperFalsas], ['kokoro', kokoro, vocesKokoroFalsas]]) {
    test(`${nombre}: disponible() sintetiza de verdad una vez y cachea el resultado`, () => {
        const { venv, contador } = venvFalso({ modo: 'ok' });
        const voces = vocesFalsas();
        const instancia = motor.crear({ voz: 'x', venv, voces });

        assert.equal(instancia.disponible(), true);
        assert.equal(instancia.disponible(), true);
        assert.equal(instancia.disponible(), true);

        assert.equal(invocaciones(contador), 1,
            'la sonda de disponibilidad debe correr una sola vez, no en cada llamada a disponible()');
    });

    test(`${nombre}: si la síntesis de prueba falla, el error concreto queda disponible (no un "no disponible" genérico)`, () => {
        const mensaje = 'no se pudo cargar el modelo: memoria insuficiente';
        const { venv } = venvFalso({ modo: 'fallar', mensaje });
        const voces = vocesFalsas();
        const instancia = motor.crear({ voz: 'x', venv, voces });

        assert.equal(instancia.disponible(), false);
        assert.match(instancia.error(), /memoria insuficiente/);
    });

    test(`${nombre}: si el ejecutable o el modelo no existen, ni siquiera intenta invocar nada`, () => {
        const instancia = motor.crear({ voz: 'x', venv: '/no/existe-venv', voces: '/no/existe-voces' });
        assert.equal(instancia.disponible(), false);
        assert.match(instancia.error(), /no se encontró/);
    });

    test(`${nombre}: todas las locuciones de una corrida viven en el mismo directorio temporal`, () => {
        const { venv } = venvFalso({ modo: 'ok' });
        const voces = vocesFalsas();
        const instancia = motor.crear({ voz: 'x', venv, voces });

        const a = instancia.sintetizar('primera frase');
        const b = instancia.sintetizar('segunda frase');

        assert.ok(a && b, 'ambas síntesis deben devolver una ruta');
        assert.equal(dirname(a), dirname(b), 'las locuciones de una misma corrida deben compartir directorio');
    });

    test(`${nombre}: limpiar() borra el directorio de la corrida, no antes de que se pida`, () => {
        const { venv } = venvFalso({ modo: 'ok' });
        const voces = vocesFalsas();
        const instancia = motor.crear({ voz: 'x', venv, voces });

        const wav = instancia.sintetizar('una frase');
        assert.ok(existsSync(wav), 'el montaje reutiliza esta ruta: tiene que existir hasta que se pida limpiar');

        instancia.limpiar();
        assert.equal(existsSync(wav), false, 'tras limpiar(), el .wav ya no debe estar');
        assert.equal(existsSync(dirname(wav)), false, 'tras limpiar(), el directorio de la corrida ya no debe estar');
    });
}

test('una locución perdida avisa por stderr en vez de quedar muda en silencio', () => {
    // El fallo silencioso es el patrón que ya costó un curso entero sin voz: si la síntesis
    // no sale, tiene que notarse en el momento, no al mirar el video terminado.
    const { venv } = venvFalso({ modo: 'fallar', mensaje: 'el motor explotó' });
    const voces = vocesPiperFalsas();
    const instancia = piper.crear({ voz: 'x', venv, voces });

    const avisos = [];
    const original = console.warn;
    console.warn = (m) => avisos.push(String(m));
    try {
        assert.equal(instancia.sintetizar('una frase que se va a perder'), null);
    } finally {
        console.warn = original;
    }

    assert.equal(avisos.length, 1, 'debe avisar exactamente una vez');
    assert.match(avisos[0], /locución perdida/);
    assert.match(avisos[0], /el motor explotó/, 'el aviso debe traer la causa concreta');
    assert.match(avisos[0], /una frase que se va a perder/, 'y qué texto se perdió');
});
