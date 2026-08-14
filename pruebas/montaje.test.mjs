import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff, duracion } from '../src/ffmpeg.mjs';
import { montar } from '../src/montaje.mjs';

/** Fabrica una pista de color sólido de N segundos, como sustituto de una grabación. */
function pista(dir, nombre, segundos, color) {
    const archivo = join(dir, nombre);
    ff(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x400:d=${segundos}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', archivo]);
    return archivo;
}

const vozMuda = { motor: 'ninguno', disponible: () => false, sintetizar: () => null };

test('intercala los tramos de dos actores en orden narrativo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = {
        ciudadano: pista(dir, 'ciudadano.mp4', 10, 'blue'),
        funcionario: pista(dir, 'funcionario.mp4', 8, 'red'),
    };
    const pasos = [
        { escena: 'entrega',  actor: 'ciudadano',   tLocal: 0,    tGlobal: 0,     duracionMs: 4000 },
        { escena: 'revision', actor: 'funcionario', tLocal: 0,    tGlobal: 4000,  duracionMs: 5000 },
        { escena: 'cierre',   actor: 'ciudadano',   tLocal: 4000, tGlobal: 9000,  duracionMs: 3000 },
    ];

    const { mp4, segmentos } = await montar(
        { pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' });

    assert.ok(existsSync(mp4));
    const total = duracion(mp4);
    assert.ok(Math.abs(total - 12) < 1, `el total debe rondar 4+5+3=12 s, midió ${total}`);
    assert.deepEqual(segmentos.map((s) => s.inicioSeg), [0, 4, 9]);
});

test('emite el .vtt junto al mp4', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 6, 'green') };
    const pasos = [
        { escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 3000, narrar: 'Primer paso.' },
        { escena: 'b', actor: 'uno', tLocal: 3000, tGlobal: 3000, duracionMs: 3000, narrar: 'Segundo paso.' },
    ];
    const { vtt } = await montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' });

    assert.ok(existsSync(vtt));
    const texto = readFileSync(vtt, 'utf8');
    assert.match(texto, /^WEBVTT/);
    assert.match(texto, /Segundo paso\./);
});

test('un paso que se sale del largo de su pista falla en vez de producir un corte vacío', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 3, 'black') };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 10000, tGlobal: 0, duracionMs: 2000 }];
    await assert.rejects(() => montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' }), /fuera de la pista/);
});

test('un desborde pequeño se recorta y los tiempos siguen calzando con el video', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { largo: pista(dir, 'largo.mp4', 10, 'blue'), corto: pista(dir, 'corto.mp4', 3, 'green') };
    // El segundo tramo empieza en 1 s y "dura" 2,1 s sobre una pista de 3 s: desborda 0,1 s,
    // que es lo que pasa de verdad al cerrar la grabación de un actor justo tras su paso.
    const pasos = [
        { escena: 'a', actor: 'largo', tLocal: 0, tGlobal: 0, duracionMs: 2000, narrar: 'Primero.' },
        { escena: 'b', actor: 'corto', tLocal: 1000, tGlobal: 2000, duracionMs: 2100, narrar: 'Segundo.' },
    ];
    const { mp4, segmentos } = await montar(
        { pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' });

    // Lo que prometen los subtítulos tiene que coincidir con lo que el video dura de verdad.
    const prometido = segmentos.at(-1).finSeg;
    assert.ok(Math.abs(prometido - duracion(mp4)) < 0.3,
        `los subtítulos prometen ${prometido}s y el video dura ${duracion(mp4)}s: quedarían desfasados`);
});

test('limpia los archivos intermedios de la carpeta de salida al terminar', async () => {
    // Igual que ya se hizo en pegarCapitulos: la carpeta de salida debe contener solo lo
    // que el usuario quiere ver, no los trozos y el .srt intermedios del montaje.
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 3, 'green') };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 2000, narrar: 'Hola.' }];

    await montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' });

    assert.ok(!existsSync(join(dir, '.tmp')), 'la carpeta temporal ".tmp" debe limpiarse tras montar');
    assert.deepEqual(readdirSync(dir).sort(), ['final.mp4', 'final.vtt', 'uno.mp4'].sort(),
        'la carpeta de salida solo debe tener lo que produce el montaje, sin intermedios');
});

test('un desborde grande falla, en vez de recortar media escena en silencio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 3, 'black') };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 1000, tGlobal: 0, duracionMs: 5000 }];
    await assert.rejects(() => montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' }), /desfasados/);
});
