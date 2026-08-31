import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { renderizarMarco } from '../src/marco.mjs';

const presentacion = {
    fondo: null, padding: 80, radio: 16, sombra: true, barra: true,
    salida: { ancho: 960, alto: 540 },
    transicion3d: { activa: true, ms: 900, gradosMax: 12 },
};

/** Devuelve el pixel RGBA en (x,y) del PNG, leyendo por ffmpeg a rawvideo. */
function pixel(png, x, y) {
    const r = spawnSync(RUTA_FFMPEG, ['-i', png, '-vf', `crop=1:1:${x}:${y}`,
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1e6 });
    return [...r.stdout.subarray(0, 4)];
}

test('el marco sale con las dimensiones de salida y el centro transparente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-marco-'));
    const png = await renderizarMarco({
        salida: dir, presentacion, marca: { color: '#1e3a8a' }, baseURL: 'http://localhost:8000',
    });
    assert.ok(existsSync(png));

    // el centro es el hueco donde va el video: alfa 0
    assert.equal(pixel(png, 480, 300)[3], 0);
    // la esquina es fondo opaco
    assert.equal(pixel(png, 4, 4)[3], 255);
});

test('la barra muestra la URL del sistema', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-marco-'));
    const texto = await renderizarMarco({
        salida: dir, presentacion, marca: { color: '#1e3a8a' },
        baseURL: 'http://localhost:8000', devolverTexto: true,
    });
    assert.match(texto, /localhost:8000/);
});
