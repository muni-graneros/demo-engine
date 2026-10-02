import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { acabar, piezasDelAcabado } from '../src/acabado/index.mjs';
import { planDeRecorte } from '../src/acabado/tiempo.mjs';
import { generarMusica } from '../src/acabado/musica.mjs';
import { fusionarAcabado } from '../src/configurar.mjs';
import { encuadresDe, focosEnLienzo } from '../src/montaje.mjs';

const LIENZO = { ancho: 640, alto: 360 };

/** Lienzo gris de 10 s a 25 fps con un cuadrado rojo en (500,100) de 40×40, como un `mudo.mp4`. */
function mudo(dir) {
    const archivo = join(dir, 'mudo.mp4');
    ff(['-y', '-f', 'lavfi', '-i', `color=c=gray:s=${LIENZO.ancho}x${LIENZO.alto}:r=25:d=10`,
        '-vf', 'drawbox=x=500:y=100:w=40:h=40:color=red:t=fill',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', archivo]);
    return archivo;
}

/** RGB del píxel (x,y) del cuadro en el segundo `t`. */
function pixel(dir, video, t, x, y) {
    const crudo = join(dir, `px-${t}-${x}-${y}.rgb`);
    ff(['-y', '-ss', String(t), '-i', video, '-frames:v', '1', '-vf', `crop=1:1:${x}:${y}:exact=1,format=rgb24`, '-f', 'rawvideo', crudo]);
    return [...readFileSync(crudo)];
}

const esRojo = ([r, g, b]) => r > 180 && g < 90 && b < 90;
const esGris = ([r, g, b]) => Math.abs(r - 128) < 30 && Math.abs(g - 128) < 30 && Math.abs(b - 128) < 30;

test('acabar: recorta el silencio, acerca la cámara al clic, quema el subtítulo y sale a 60 fps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-acabado-'));
    const r = await acabar({
        mudo: mudo(dir), lienzo: LIENZO, total: 10, temporal: dir,
        opciones: fusionarAcabado({ subtitulos: { tamano: 24 }, rotulos: null }),
        segmentos: [
            { inicioSeg: 0, finSeg: 5, narrar: 'Hola.', escena: 'a', vozSeg: 1.5 },
            { inicioSeg: 5, finSeg: 10, narrar: 'Chao.', escena: 'a', vozSeg: 1 },
        ],
        clics: [3],
        focos: [{ t: 3, x: 520, y: 120, encuadre: 0 }],
        encuadres: [{ inicio: 0, fin: 10, camara: true }],
    });
    // Huecos sin voz: 1,5–5 (el clic protege 2–4,2 y lo que sobra, 0,3 s, no vale un corte) y
    // 6–10, que pierde 6,5–9,5 (3 s).
    assert.ok(Math.abs(r.total - 7) < 0.02, `total ${r.total}`);
    assert.ok(Math.abs(duracion(r.video) - 7) < 0.05, `duración real ${duracion(r.video)}`);
    assert.deepEqual(r.clics, [3]);

    // En el clic, la cámara está acercada 1,5× sobre (520,120): el cuadrado rojo cae en (460,180).
    assert.ok(esRojo(pixel(dir, r.video, 3, 460, 180)), 'acercado sobre el cuadrado');
    // Antes de entrar (t=0,3) el mismo píxel es gris: la cámara está en reposo.
    assert.ok(esGris(pixel(dir, r.video, 0.3, 460, 180)), 'en reposo al principio');
    // Subtítulo: la píldora oscura abajo al centro mientras se dice «Hola.»…
    const conSub = pixel(dir, r.video, 0.8, 320, LIENZO.alto - 26);
    assert.ok(conSub.every((c) => c < 70), `píldora oscura ${conSub}`);
    // …y nada cuando no se habla (t=5, ya acercada o no, abajo al centro es gris).
    assert.ok(esGris(pixel(dir, r.video, 4.6, 320, LIENZO.alto - 26)), 'sin subtítulo en silencio');
    // Los cues siguen la voz: «Chao.» de 5 a 6,25 (voz + cola), antes del corte.
    assert.equal(r.cues.length, 2);
    assert.ok(Math.abs(r.cues[1].inicioSeg - 5) < 1e-9 && Math.abs(r.cues[1].finSeg - 6.25) < 1e-9, JSON.stringify(r.cues[1]));
    assert.deepEqual(r.cortes, [{ inicio: 6.5, fin: 9.5 }]);
});

test('acabar a 60 fps entrega exactamente total×60 cuadros aunque se parta en piezas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-acabado-'));
    const r = await acabar({
        mudo: mudo(dir), lienzo: LIENZO, total: 10, temporal: dir,
        opciones: fusionarAcabado({ silencios: null, subtitulos: null, rotulos: null, camara: null }),
        segmentos: [], encuadres: [],
    });
    const salida = readFileSync(join(dir, 'acabado', 'piezas.txt'), 'utf8').trim().split('\n').length;
    assert.ok(salida >= 2, 'se partió en piezas');
    const stderr = spawnSync(RUTA_FFMPEG, ['-i', r.video, '-map', '0:v', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const cuadros = Number(stderr.match(/frame=\s*(\d+)/g).at(-1).match(/\d+/)[0]);
    assert.equal(cuadros, 600);
    assert.match(stderr, /60 fps/);
});

test('piezasDelAcabado no cruza cortes y cada pieza mide cuadros enteros', () => {
    const plan = planDeRecorte({ total: 30, voces: [{ inicio: 0, fin: 2 }, { inicio: 20, fin: 30 }] });
    const piezas = piezasDelAcabado(plan, 60);
    for (const p of piezas) {
        assert.ok(Number.isInteger(p.cuadros));
        assert.ok(p.fin - p.inicio <= 8 + 1e-9);
        const enCorte = plan.cortes.some((c) => p.origen < c.fin - 1e-9 && p.origen + (p.fin - p.inicio) > c.inicio + 1e-9);
        assert.equal(enCorte, false, `la pieza ${JSON.stringify(p)} cruza un corte`);
    }
    assert.ok(Math.abs(piezas.reduce((s, p) => s + p.cuadros, 0) / 60 - plan.total) < 1 / 60);
});

test('encuadresDe junta pasos con la misma composición y focosEnLienzo descarta lo que no se acerca', () => {
    const segmentos = [
        { inicioSeg: 0, finSeg: 2, tGlobal: 0 },
        { inicioSeg: 2, finSeg: 5, tGlobal: 2000 },
        { inicioSeg: 5, finSeg: 6, tGlobal: 5000 },
    ];
    const panel = { hueco: { x: 0, y: 0, ancho: 640, alto: 360 }, dim: { ancho: 640, alto: 360 } };
    const composiciones = [
        { clave: 'a', camara: true, paneles: { ana: panel } },
        { clave: 'a', camara: true, paneles: { ana: panel } },
        { clave: 'plano-2', camara: false, paneles: {} },
    ];
    const { encuadres, indicePorSegmento } = encuadresDe(composiciones, segmentos);
    assert.deepEqual(encuadres, [{ inicio: 0, fin: 5, camara: true }, { inicio: 5, fin: 6, camara: false }]);
    assert.deepEqual(indicePorSegmento, [0, 0, 1]);
    const focos = focosEnLienzo({
        focos: [
            { t: 2500, actor: 'ana', x: 100, y: 50, escala: 1 },
            { t: 3000, actor: 'ana', x: 100, y: 50, escala: 1.6 },   // la página ya estaba acercada
            { t: 3000, actor: 'beto', x: 100, y: 50 },               // no está en el lienzo
            { t: 5500, actor: 'ana', x: 100, y: 50 },                // tramo plano
        ],
        segmentos, composiciones, indicePorSegmento,
    });
    assert.deepEqual(focos, [{ t: 2.5, x: 100, y: 50, encuadre: 0, telefono: undefined }]);
});

test('fusionarAcabado: null apaga, true y objeto encienden con defectos, y valida', () => {
    assert.equal(fusionarAcabado(undefined), null);
    assert.equal(fusionarAcabado(null), null);
    const a = fusionarAcabado({ camara: { zoom: 1.4 }, rotulos: false });
    assert.equal(a.fps, 60);
    assert.equal(a.camara.zoom, 1.4);
    assert.equal(a.camara.zoomTelefono, 1.3);
    assert.equal(a.rotulos, null);
    assert.deepEqual(a.silencios, { maxSeg: 2, margenSeg: 0.5 });
    assert.throws(() => fusionarAcabado({ fps: 120 }), /fps/);
    assert.throws(() => fusionarAcabado({ camara: { zoom: 4 } }), /zoom/);
    assert.throws(() => fusionarAcabado({ silencios: { maxSeg: 1, margenSeg: 0.6 } }), /maxSeg/);
});

test('generarMusica: estéreo del largo pedido, con fundidos y bajo nivel', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-musica-'));
    const wav = generarMusica({ segundos: 6, salida: join(dir, 'm.wav'), dirCache: dir });
    assert.ok(Math.abs(duracion(wav) - 6) < 0.05);
    const primero = join(dir, 'ini.raw');
    ff(['-y', '-i', wav, '-t', '0.01', '-f', 's16le', '-ac', '1', primero]);
    const crudo = readFileSync(primero);
    const muestras = new Int16Array(crudo.buffer.slice(crudo.byteOffset, crudo.byteOffset + crudo.length));
    assert.ok(Math.max(...muestras.map(Math.abs)) < 500, 'empieza con fundido, sin golpe');
});
