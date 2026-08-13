import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { pegarCapitulos } from '../src/curso.mjs';

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
