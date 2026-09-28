import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUTA_FFMPEG as ffmpegPath, ff } from '../src/ffmpeg.mjs';
import { variante } from '../src/formatos.mjs';

/** Video base de 2 s con audio, subtítulos mov_text y dos capítulos. */
function base() {
    const dir = mkdtempSync(join(tmpdir(), 'fmt-'));
    const mp4 = join(dir, 'curso.mp4');
    const srt = join(dir, 's.srt');
    const meta = join(dir, 'm.txt');
    writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nHola\n');
    writeFileSync(meta, ';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Uno\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Dos\n');
    ff(['-y', '-f', 'lavfi', '-i', 'testsrc=s=1920x1080:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-i', srt, '-i', meta,
        '-map', '0:v', '-map', '1:a', '-map', '2:s', '-map_metadata', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text', mp4]);
    return { dir, mp4 };
}

test('Review Focus #5: el vertical conserva audio, subtítulos y capítulos', () => {
    const { dir, mp4 } = base();
    const vertical = variante(mp4, { formato: 'vertical', salida: dir });
    assert.ok(vertical.endsWith('curso-vertical.mp4'));
    const info = spawnSync(ffmpegPath, ['-i', vertical]).stderr.toString();
    assert.match(info, /1080x1920/);
    assert.match(info, /Audio:/);
    assert.match(info, /Subtitle: mov_text/);
    assert.match(info, /Chapter #0:1/);
});

test('cuadrado: 1080x1080 y el fondo NO es negro liso (es el video desenfocado)', () => {
    const { dir, mp4 } = base();
    const cuadrado = variante(mp4, { formato: 'cuadrado', salida: dir });
    assert.ok(cuadrado.endsWith('curso-cuadrado.mp4'));
    const info = spawnSync(ffmpegPath, ['-i', cuadrado]).stderr.toString();
    assert.match(info, /1080x1080/);
    // (5,5) cae en la franja superior, fuera del video centrado (1080x608): es fondo.
    // exact=1: sin eso el crop de 1x1 se redondea a 0x0 y ffmpeg aborta.
    const r = spawnSync(ffmpegPath, ['-i', cuadrado, '-frames:v', '1', '-vf', 'crop=1:1:5:5:exact=1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e6 });
    const rgb = [...r.stdout.subarray(0, 3)];
    assert.equal(rgb.length, 3);
    assert.notDeepEqual(rgb, [0, 0, 0]);
});

test('formato desconocido: error legible', () => {
    assert.throws(() => variante('x.mp4', { formato: 'panoramico', salida: '/tmp' }), /vertical o cuadrado/);
});
