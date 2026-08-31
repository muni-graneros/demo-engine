import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { renderizarTransicion } from '../src/escenario3d.mjs';

const presentacion = {
    fondo: '#0f172a', padding: 40, radio: 16, sombra: true, barra: false,
    salida: { ancho: 480, alto: 270 },
    transicion3d: { activa: true, ms: 400, gradosMax: 12 },
};

function pixelCentro(mp4, seg) {
    // exact=1: sin esto, el filtro crop redondea w/h al múltiplo de 2 más cercano (por el
    // subsampling de chroma) y un crop de 1x1 se convierte en 0x0, abortando ffmpeg. Es un
    // detalle de este build de ffmpeg-static, no de la escena que se está verificando.
    //
    // La coordenada x=375 (no el centro geométrico x=240) es deliberada: la cámara mira
    // siempre a (0,0,0) y el plano rota sobre su propio origen, así que el píxel del centro
    // exacto de la imagen es un punto fijo de esa rotación+dolly y NUNCA cambia, sin importar
    // si la cámara se mueve o no — probarlo ahí daría un falso negativo con cualquier
    // implementación. x=375 cae sobre el borde del plano, que el dolly-zoom sí desplaza.
    const r = spawnSync(RUTA_FFMPEG, ['-ss', String(seg), '-i', mp4, '-frames:v', '1',
        '-vf', 'crop=1:1:375:135:exact=1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { maxBuffer: 1e6 });
    return [...r.stdout.subarray(0, 3)];
}

test('produce un clip con la duración de la transición', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-3d-'));
    const mp4 = join(dir, 'cap.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'testsrc=size=640x400:rate=25', '-t', '3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);

    const clip = await renderizarTransicion({ mp4, desdeSeg: 0, salida: dir, presentacion, fps: 25 });
    assert.ok(existsSync(clip));
    // 400 ms a 25 fps son 10 frames
    assert.ok(Math.abs(duracion(clip) - 0.4) < 0.12, `duración ${duracion(clip)}`);
});

test('la cámara efectivamente se mueve: el primer frame difiere del último', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-3d-'));
    const mp4 = join(dir, 'cap.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=white:s=640x400', '-t', '3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);

    const clip = await renderizarTransicion({ mp4, desdeSeg: 0, salida: dir, presentacion, fps: 25 });
    const primero = pixelCentro(clip, 0);
    const ultimo = pixelCentro(clip, 0.35);
    assert.notDeepEqual(primero, ultimo, 'si no cambia, la cámara no se movió');
});
