import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff, duracion } from '../src/ffmpeg.mjs';
import { cadenaDePresentacion, componer } from '../src/presentacion.mjs';

const presentacion = {
    fondo: null, padding: 80, radio: 16, sombra: true, barra: true,
    salida: { ancho: 960, alto: 540 },
    transicion3d: { activa: true, ms: 900, gradosMax: 12 },
};

test('la cadena escala el video al hueco y superpone el marco encima', () => {
    const c = cadenaDePresentacion(presentacion);
    // hueco = 960-160 de ancho, 540-160-38 de alto
    assert.match(c, /scale=800:342/);
    // el video va primero y el marco después: el marco tapa el sobrante de las esquinas
    assert.ok(c.indexOf('[video]') < c.indexOf('[marco]'), 'el marco debe superponerse último');
    assert.match(c, /overlay=80:118/);   // x=padding, y=padding+altoBarra
});

test('sin barra, el hueco ocupa todo el alto disponible', () => {
    const c = cadenaDePresentacion({ ...presentacion, barra: false });
    assert.match(c, /scale=800:380/);
    assert.match(c, /overlay=80:80/);
});

test('compone preservando la duración y con las dimensiones de salida', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-pres-'));
    const entrada = join(dir, 'crudo.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x400:rate=25', '-t', '2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', entrada]);
    const marco = join(dir, 'marco.png');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=960x540,format=rgba', '-frames:v', '1', marco]);

    const salida = componer(entrada, marco, join(dir, 'listo.mp4'), presentacion);
    assert.ok(existsSync(salida));
    assert.ok(Math.abs(duracion(salida) - 2) < 0.2, `duración ${duracion(salida)}`);
});
