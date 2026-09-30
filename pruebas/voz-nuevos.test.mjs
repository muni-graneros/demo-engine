import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crear as crearPocket } from '../src/voz/pocket.mjs';
import { crear as crearChatterbox } from '../src/voz/chatterbox.mjs';
import { MOTORES, crearVoz } from '../src/voz/index.mjs';
import { crearMotorProceso } from '../src/voz/proceso.mjs';
import { ff, duracion } from '../src/ffmpeg.mjs';

function venvFalso() {
    const dir = mkdtempSync(join(tmpdir(), 'venv-'));
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'python'), '');
    return dir;
}
// Ejecutor que escribe un .wav real de 2 s en el ÚLTIMO argumento y guarda la llamada.
function ejecutorQueEscribe(llamadas) {
    return (PY, args, opciones) => {
        llamadas.push({ PY, args, opciones });
        ff(['-y', '-f', 'lavfi', '-t', '2', '-i', 'anullsrc=r=24000:cl=mono', args.at(-1)]);
        return { status: 0, stderr: '' };
    };
}

test('pocket: texto por stdin, idioma y voz como argumentos, .wav al final', () => {
    const llamadas = [];
    const m = crearPocket({ venv: venvFalso(), voces: tmpdir(), voz: 'spanish_24l:alba', velocidad: 1, ejecutarProceso: ejecutorQueEscribe(llamadas) });
    assert.equal(m.disponible(), true);
    const wav = m.sintetizar('Hola vecina');
    assert.ok(existsSync(wav));
    const ultima = llamadas.at(-1);
    assert.equal(ultima.opciones.input, 'Hola vecina');
    assert.ok(ultima.args.includes('spanish_24l'));
    assert.ok(ultima.args.includes('alba'));
    assert.equal(ultima.args.at(-1).endsWith('.wav'), true);
});

test('pocket: la velocidad se aplica con atempo después de sintetizar', () => {
    const m = crearPocket({ venv: venvFalso(), voces: tmpdir(), voz: 'spanish:alba', velocidad: 1.25, ejecutarProceso: ejecutorQueEscribe([]) });
    const wav = m.sintetizar('Hola');
    assert.ok(Math.abs(duracion(wav) - 2 / 1.25) < 0.1);
});

test('pocket: sin venv declarado busca venv-pocket en la caché, hermano del venv de kokoro', () => {
    const anterior = process.env.XDG_CACHE_HOME;
    const cache = mkdtempSync(join(tmpdir(), 'cache-'));
    process.env.XDG_CACHE_HOME = cache;
    try {
        const m = crearPocket({ voces: tmpdir(), ejecutarProceso: ejecutorQueEscribe([]) });
        assert.equal(m.disponible(), false);
        assert.equal(m.motivo(), 'no-instalado');
        assert.ok(m.error().includes(join(cache, 'demo-engine', 'venv-pocket', 'bin', 'python')));
    } finally {
        if (anterior === undefined) delete process.env.XDG_CACHE_HOME;
        else process.env.XDG_CACHE_HOME = anterior;
    }
});

test('chatterbox sin voz de referencia no está disponible y lo dice', () => {
    const m = crearChatterbox({ venv: venvFalso(), voces: tmpdir(), ejecutarProceso: ejecutorQueEscribe([]) });
    assert.equal(m.disponible(), false);
    assert.match(m.error(), /voz de referencia/);
    assert.equal(m.motivo(), 'no-instalado');
});

test('chatterbox con una voz de referencia que no existe no está disponible', () => {
    const m = crearChatterbox({ venv: venvFalso(), voces: tmpdir(), voz: join(tmpdir(), 'no-existe-ref.wav'), ejecutarProceso: ejecutorQueEscribe([]) });
    assert.equal(m.disponible(), false);
    assert.match(m.error(), /no se encontró la voz de referencia/);
});

test('chatterbox con voz de referencia pasa language_id es y la ruta de la voz', () => {
    const ref = join(mkdtempSync(join(tmpdir(), 'ref-')), 'ref.wav');
    ff(['-y', '-f', 'lavfi', '-t', '1', '-i', 'anullsrc=r=24000:cl=mono', ref]);
    const llamadas = [];
    const m = crearChatterbox({ venv: venvFalso(), voces: tmpdir(), voz: ref, ejecutarProceso: ejecutorQueEscribe(llamadas) });
    assert.ok(m.sintetizar('Hola'));
    const ultima = llamadas.at(-1);
    assert.ok(ultima.args.includes(ref));
    assert.ok(ultima.args.some((a) => a.includes('language_id="es"')));
    assert.equal(ultima.opciones.input, 'Hola');
});

test('despues que falla convierte la síntesis en fallida (y avisa)', () => {
    const m = crearMotorProceso({ motor: 'x', archivosListos: () => null,
        comando: (d) => ({ PY: 'py', args: [d] }), ejecutarProceso: ejecutorQueEscribe([]),
        despues: () => { throw new Error('atempo roto'); } });
    const avisos = [];
    const original = console.warn;
    console.warn = (msg) => avisos.push(String(msg));
    try {
        assert.equal(m.sintetizar('hola'), null);
    } finally {
        console.warn = original;
    }
    assert.ok(avisos.some((a) => a.includes('atempo roto')), `avisos: ${avisos.join(' / ')}`);
});

test('pocket: voz null (sin declarar en la config) usa su voz por omisión', () => {
    const llamadas = [];
    const m = crearPocket({ venv: venvFalso(), voces: tmpdir(), voz: null, ejecutarProceso: ejecutorQueEscribe(llamadas) });
    assert.ok(m.sintetizar('Hola'));
    assert.ok(llamadas.at(-1).args.includes('spanish'));
    assert.ok(llamadas.at(-1).args.includes('alba'));
});

// Corre crearVoz con una caché temporal y devuelve lo que escribió por stderr (el aviso de
// avisarSinVoz lista el motivo concreto de cada motor, con la ruta que miró).
function crearVozCapturando(opciones, prepararCache = () => {}) {
    const anterior = process.env.XDG_CACHE_HOME;
    const cache = mkdtempSync(join(tmpdir(), 'cache-'));
    prepararCache(join(cache, 'demo-engine'));
    process.env.XDG_CACHE_HOME = cache;
    const salida = [];
    const escribir = process.stderr.write;
    process.stderr.write = (t) => { salida.push(String(t)); return true; };
    try {
        crearVoz(opciones);
    } finally {
        process.stderr.write = escribir;
        if (anterior === undefined) delete process.env.XDG_CACHE_HOME;
        else process.env.XDG_CACHE_HOME = anterior;
    }
    return { cache, texto: salida.join('') };
}

test('crearVoz no le pasa a pocket el voz.venv de kokoro: busca su propio venv-pocket', () => {
    const { cache, texto } = crearVozCapturando({ motor: 'pocket', venv: '/x', respaldo: 'ninguno' });
    assert.ok(texto.includes(join(cache, 'demo-engine', 'venv-pocket', 'bin', 'python')), texto);
    assert.ok(!texto.includes('/x/bin/python'), texto);
});

test('crearVoz no le pasa a chatterbox la voz por omisión de kokoro (ef_dora)', () => {
    const conPython = (raiz) => {
        mkdirSync(join(raiz, 'venv-chatterbox', 'bin'), { recursive: true });
        writeFileSync(join(raiz, 'venv-chatterbox', 'bin', 'python'), '');
    };
    const { texto } = crearVozCapturando({ motor: 'chatterbox', voz: 'ef_dora', venv: '/x', respaldo: 'ninguno' }, conPython);
    assert.match(texto, /chatterbox necesita una voz de referencia/);
    assert.doesNotMatch(texto, /voz de referencia en .*ef_dora/);
});

// crearVoz con un venv falso cae al stub "ninguno" (el python vacío no arranca), así que
// se comprueba el registro directamente sobre MOTORES.
test('crearVoz conoce los motores pocket y chatterbox', () => {
    assert.equal(typeof MOTORES.pocket?.crear, 'function');
    assert.equal(typeof MOTORES.chatterbox?.crear, 'function');
    assert.ok(MOTORES.kokoro && MOTORES.piper);
});

test('pocket y chatterbox graban sin red: HF_HUB_OFFLINE y sin telemetría', () => {
    const ref = join(mkdtempSync(join(tmpdir(), 'ref-')), 'ref.wav');
    ff(['-y', '-f', 'lavfi', '-t', '1', '-i', 'anullsrc=r=24000:cl=mono', ref]);
    for (const crear of [
        (e) => crearPocket({ venv: venvFalso(), voces: tmpdir(), ejecutarProceso: e }),
        (e) => crearChatterbox({ venv: venvFalso(), voces: tmpdir(), voz: ref, ejecutarProceso: e }),
    ]) {
        const llamadas = [];
        const m = crear(ejecutorQueEscribe(llamadas));
        assert.equal(m.disponible(), true);
        const { env } = llamadas.at(-1).opciones;
        assert.equal(env.HF_HUB_OFFLINE, '1');
        assert.equal(env.HF_HUB_DISABLE_TELEMETRY, '1');
    }
});

test('pocket sin los pesos en caché: la sonda falla y apunta a instalar-voces.sh', () => {
    const m = crearPocket({ venv: venvFalso(), voces: tmpdir(),
        ejecutarProceso: () => ({ status: 1, stderr: 'OSError: We have no connection or you passed local_files_only' }) });
    assert.equal(m.disponible(), false);
    assert.match(m.error(), /no connection/);
    assert.match(m.error(), /instalar-voces\.sh --pocket/);
});

test('chatterbox sin los pesos en caché: la sonda falla y apunta a instalar-voces.sh', () => {
    const ref = join(mkdtempSync(join(tmpdir(), 'ref-')), 'ref.wav');
    ff(['-y', '-f', 'lavfi', '-t', '1', '-i', 'anullsrc=r=24000:cl=mono', ref]);
    const m = crearChatterbox({ venv: venvFalso(), voces: tmpdir(), voz: ref,
        ejecutarProceso: () => ({ status: 1, stderr: 'LocalEntryNotFoundError' }) });
    assert.equal(m.disponible(), false);
    assert.match(m.error(), /instalar-voces\.sh --chatterbox/);
});
