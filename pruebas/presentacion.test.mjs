import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
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
    assert.match(c, /overlay=80:118:shortest=1/);   // x=padding, y=padding+altoBarra, shortest=1 detiene la fuente infinita
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

/** Devuelve la caja (en píxeles) de lo que esté claro en el primer frame del video. */
function cajaClara(mp4, ancho, alto) {
    const r = spawnSync(RUTA_FFMPEG, ['-i', mp4, '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1e9 });
    let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
    for (let y = 0; y < alto; y++) {
        for (let x = 0; x < ancho; x++) {
            if (r.stdout[y * ancho + x] > 200) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
            }
        }
    }
    return { ancho: x1 - x0 + 1, alto: y1 - y0 + 1 };
}

test('la composición no deforma: un cuadrado sigue siendo un cuadrado', () => {
    // El hueco (800x342 con estos defectos) tiene aspecto 2,34 y la grabación 1,0: un `scale`
    // a secas estiraba el contenido hasta ese aspecto. Se mide sobre PÍXELES, no sobre la
    // cadena de filtros, porque el defecto original se veía perfectamente razonable en el código.
    const dir = mkdtempSync(join(tmpdir(), 'demo-pres-aspecto-'));
    const entrada = join(dir, 'cuadrado.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=400x400:d=1',
        '-vf', 'drawbox=x=100:y=100:w=200:h=200:color=white:t=fill',
        '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', entrada]);
    const marco = join(dir, 'marco.png');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=960x540,format=rgba', '-frames:v', '1', marco]);

    const salida = componer(entrada, marco, join(dir, 'listo.mp4'), presentacion);
    const caja = cajaClara(salida, 960, 540);
    const aspecto = caja.ancho / caja.alto;
    assert.ok(Math.abs(aspecto - 1) < 0.05, `el cuadrado salió con aspecto ${aspecto} (${caja.ancho}x${caja.alto})`);
});

test('la cadena preserva el aspecto y rellena el sobrante del hueco', () => {
    const c = cadenaDePresentacion(presentacion);
    assert.match(c, /force_original_aspect_ratio=decrease/);
    assert.match(c, /pad=800:342:\(ow-iw\)\/2:\(oh-ih\)\/2/);
});
