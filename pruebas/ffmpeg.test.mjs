import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';

const require = createRequire(import.meta.url);

test('usa un ffmpeg 7 o superior, no el build de 2018', () => {
    const { execFileSync } = require('node:child_process');
    const salida = execFileSync(RUTA_FFMPEG, ['-version'], { encoding: 'utf8' });
    const version = salida.match(/ffmpeg version (\d+)/);
    assert.ok(version, 'no se pudo leer la versión de ffmpeg');
    assert.ok(Number(version[1]) >= 7, `se esperaba ffmpeg >= 7, hay ${version[1]}`);
});

test('genera un archivo y mide su duración', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-ff-'));
    const archivo = join(dir, 'prueba.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=3', '-c:v', 'libx264', archivo]);
    assert.ok(Math.abs(duracion(archivo) - 3) < 0.2, 'la duración medida debe rondar los 3 s');
});

test('un comando inválido lanza un error con la causa, no un stderr entero', () => {
    assert.throws(() => ff(['-y', '-i', '/no/existe.mp4', '/tmp/x.mp4']), /ffmpeg falló/);
});
