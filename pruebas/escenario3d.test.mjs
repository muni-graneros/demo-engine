import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { renderizarTransicion } from '../src/escenario3d.mjs';
import { renderizarMarco } from '../src/marco.mjs';

/** Píxel RGB de un PNG (el marco), para compararlo contra el de la transición. */
function pixelPng(png, x, y) {
    const r = spawnSync(RUTA_FFMPEG, ['-i', png, '-vf', `crop=1:1:${x}:${y}:exact=1`,
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e6 });
    return [...r.stdout.subarray(0, 3)];
}

const presentacion = {
    fondo: '#0f172a', padding: 40, radio: 16, sombra: true, barra: false,
    salida: { ancho: 480, alto: 270 },
    transicion3d: { activa: true, ms: 400, gradosMax: 12 },
};

function pixel(mp4, x, y, seg) {
    // exact=1: sin esto, el filtro crop redondea w/h al múltiplo de 2 más cercano (por el
    // subsampling de chroma) y un crop de 1x1 se convierte en 0x0, abortando ffmpeg. Es un
    // detalle de este build de ffmpeg-static, no de la escena que se está verificando.
    const r = spawnSync(RUTA_FFMPEG, ['-ss', String(seg), '-i', mp4, '-frames:v', '1',
        '-vf', `crop=1:1:${x}:${y}:exact=1`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        { maxBuffer: 1e6 });
    return [...r.stdout.subarray(0, 3)];
}

// El píxel de sonda es el BORDE IZQUIERDO a media altura, no el centro geométrico: la cámara
// mira siempre a (0,0,0) y el plano rota sobre su propio origen, así que el centro exacto es
// un punto fijo del dolly y nunca cambia. Antes se sondeaba x=375, pero desde que la cámara
// aterriza justo donde el plano LLENA el cuadro, x=375 cae sobre el plano en los dos extremos
// de la transición y ya no discrimina; el borde sí: arranca mostrando fondo y termina tapado.
const pixelSonda = (mp4, seg) => pixel(mp4, 2, 135, seg);

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
    const primero = pixelSonda(clip, 0);
    const ultimo = pixelSonda(clip, 0.35);
    assert.notDeepEqual(primero, ultimo, 'si no cambia, la cámara no se movió');
});

test('la transición aterriza en el encuadre del capítulo: el plano llena el cuadro', async () => {
    // Antes la cámara terminaba a una distancia fija (z=2.35) y el plano ocupaba ~61%x67% del
    // cuadro: al cortar al capítulo había un salto de escala de ~1,5x. Con el aterrizaje
    // calculado, en el último frame NINGÚN borde muestra fondo.
    const dir = mkdtempSync(join(tmpdir(), 'demo-3d-encuadre-'));
    const mp4 = join(dir, 'cap.mp4');
    // Mismo aspecto que la salida: es el caso real, el capítulo ya viene compuesto por montar().
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=white:s=480x270', '-t', '2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);

    const clip = await renderizarTransicion({
        mp4, desdeSeg: 0, salida: dir, presentacion, marca: { color: '#1e3a8a' }, fps: 25,
    });
    for (const [nombre, x, y] of [['izquierdo', 2, 135], ['derecho', 477, 135],
        ['superior', 240, 2], ['inferior', 240, 267]]) {
        const p = pixel(clip, x, y, 0.36);
        assert.ok(p.every((c) => c > 200), `el borde ${nombre} no es el plano: rgb(${p})`);
    }
});

test('el fondo de la transición es el MISMO que el del marco', async () => {
    // Con `fondo:null` el marco pinta un gradiente derivado de marca.color y la escena pintaba
    // un gris fijo: cada transición saltaba de un fondo al otro.
    const dir = mkdtempSync(join(tmpdir(), 'demo-3d-fondo-'));
    const mp4 = join(dir, 'cap.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=white:s=480x270', '-t', '2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
    const conMarca = { ...presentacion, fondo: null };
    const marca = { color: '#1e3a8a' };

    const clip = await renderizarTransicion({ mp4, desdeSeg: 0, salida: dir, presentacion: conMarca, marca, fps: 25 });
    const png = await renderizarMarco({ salida: dir, presentacion: conMarca, marca, baseURL: 'http://localhost:8000' });

    // En el primer frame la cámara está retirada, así que las esquinas son fondo puro.
    for (const [x, y] of [[2, 2], [477, 2], [2, 265]]) {
        const enElMarco = pixelPng(png, x, y);
        const enLaTransicion = pixel(clip, x, y, 0);
        const distancia = Math.max(...enElMarco.map((c, i) => Math.abs(c - enLaTransicion[i])));
        assert.ok(distancia <= 8,
            `(${x},${y}) marco rgb(${enElMarco}) vs transición rgb(${enLaTransicion})`);
    }
});
