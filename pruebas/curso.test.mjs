import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { pegarCapitulos } from '../src/curso.mjs';
import { parseVtt } from '../src/subtitulos.mjs';

function clip(dir, nombre, segundos, color) {
    const archivo = join(dir, nombre);
    ff(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x400:d=${segundos}`,
        '-f', 'lavfi', '-t', String(segundos), '-i', 'anullsrc=r=22050:cl=mono',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', archivo]);
    return archivo;
}

test('pega los capítulos y les escribe la metadata que el reproductor lee', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-curso-'));
    const partes = [
        { id: 'uno', titulo: '1. Primero', archivo: clip(dir, 'a.mp4', 5, 'blue') },
        { id: 'dos', titulo: '2. Segundo', archivo: clip(dir, 'b.mp4', 4, 'red') },
    ];

    const { mp4, md, capitulos } = await pegarCapitulos(partes, {
        salida: dir, nombre: 'curso.mp4', titulo: 'Curso de prueba', video: { ancho: 640, alto: 400 },
    });

    assert.ok(existsSync(mp4));
    assert.ok(existsSync(md));
    assert.deepEqual(capitulos.map((c) => Math.round(c.inicioSeg)), [0, 5]);

    let info;
    try {
        info = execFileSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
            .toString() + '';
    } catch (e) {
        info = e.stderr.toString();
    }
    assert.match(info, /Chapter #0:0/, 'el MP4 debe llevar capítulos');
    assert.match(readFileSync(md, 'utf8'), /\*\*00:05\*\* — 2\. Segundo/);
});

test('combina los .vtt de cada capítulo desplazados por su offset, y los deja mux-eados en el MP4', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-curso-subs-'));
    const cap1 = clip(dir, 'a.mp4', 5, 'blue');
    const cap2 = clip(dir, 'b.mp4', 4, 'red');
    // Cada capítulo trae su .vtt al lado del clip, como hace `montar()`.
    writeFileSync(cap1.replace(/\.mp4$/, '.vtt'),
        'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nUno del capítulo uno.\n');
    writeFileSync(cap2.replace(/\.mp4$/, '.vtt'),
        'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nDos del capítulo dos.\n');

    const partes = [
        { id: 'uno', titulo: '1. Primero', archivo: cap1 },
        { id: 'dos', titulo: '2. Segundo', archivo: cap2 },
    ];

    const { mp4, vtt, capitulos } = await pegarCapitulos(partes, {
        salida: dir, nombre: 'curso.mp4', titulo: 'Curso con subtítulos', video: { ancho: 640, alto: 400 },
    });

    // (a)+(c) el .vtt del curso trae la cue del segundo capítulo YA desplazada por el
    // inicio real de ese capítulo (no un valor asumido a mano).
    assert.ok(existsSync(vtt));
    const cues = parseVtt(readFileSync(vtt, 'utf8'));
    assert.equal(cues.length, 2);
    assert.equal(cues[0].narrar, 'Uno del capítulo uno.');
    assert.equal(cues[1].narrar, 'Dos del capítulo dos.');
    const offsetCap2 = capitulos[1].inicioSeg;
    assert.ok(Math.abs(cues[1].inicioSeg - (offsetCap2 + 1)) < 0.05,
        `esperaba ~${offsetCap2 + 1}s, salió ${cues[1].inicioSeg}s`);

    // (a) se puede extraer la pista como subtítulo real. Este es el defecto reportado tal
    // cual: antes del fix, el único stream "tipo subtítulo" en el MP4 era la pista fantasma
    // que el muxer de mov agrega para chapters (`Data: bin_data (text), eng`) — que NO es de
    // tipo Subtitle, así que `-map 0:s:0` no encontraba nada que mapear y reventaba con
    // "Invalid argument". Que esta línea no reviente ya prueba que ahora existe una pista
    // real de tipo Subtitle.
    const srtExtraido = join(dir, 'extraido.srt');
    execFileSync(RUTA_FFMPEG, ['-y', '-i', mp4, '-map', '0:s:0', '-c:s', 'srt', srtExtraido]);
    const srt = readFileSync(srtExtraido, 'utf8');
    assert.match(srt, /Uno del capítulo uno\./);
    assert.match(srt, /Dos del capítulo dos\./);

    // (b) la pista queda declarada como mov_text en español, no `eng` genérico.
    let info;
    try {
        info = execFileSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
            .toString();
    } catch (e) {
        info = e.stderr.toString();
    }
    assert.match(info, /Subtitle: mov_text/);
    assert.match(info, /\(spa\)/);
});

test('un capítulo sin .vtt propio (video de teléfono) no revienta y no aporta entradas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-curso-sin-subs-'));
    const partes = [
        { id: 'uno', titulo: '1. Primero', archivo: clip(dir, 'a.mp4', 3, 'green') },
        { id: 'dos', titulo: '2. Segundo', archivo: clip(dir, 'b.mp4', 3, 'yellow') },
    ];

    const { mp4, vtt } = await pegarCapitulos(partes, {
        salida: dir, nombre: 'curso.mp4', titulo: 'Curso sin subtítulos', video: { ancho: 640, alto: 400 },
    });

    assert.ok(existsSync(mp4));
    assert.equal(vtt, null);
});
