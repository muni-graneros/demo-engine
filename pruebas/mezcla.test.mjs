import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff, duracion, RUTA_FFMPEG as ffmpegPath } from '../src/ffmpeg.mjs';
import { cadenaDeMezcla } from '../src/mezcla.mjs';

// Aplica la cadena de verdad sobre un video mudo, igual que lo hará montaje.mjs:
// el video va primero (entrada 0) y después las entradas de la mezcla.
const correr = (total, opciones) => {
    const dir = mkdtempSync(join(tmpdir(), 'mez-'));
    const video = join(dir, 'v.mp4');
    ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=320x240:d=${total}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const { entradas, filtro } = cadenaDeMezcla({ total, ...opciones });
    const out = join(dir, 'o.mp4');
    ff(['-y', '-i', video, ...entradas, '-filter_complex', filtro, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', out]);
    return out;
};
const wavDe = (seg, f = 440, canales = 1) => {
    const w = join(mkdtempSync(join(tmpdir(), 'w-')), 'v.wav');
    ff(['-y', '-f', 'lavfi', '-i', `sine=f=${f}:d=${seg}`, '-ac', String(canales), w]);
    return w;
};

// Nivel medio (dB) de una banda estrecha alrededor de `f` en la ventana [desde, desde+largo].
// Filtrar por banda (dos pasadas, para que la otra fuente no se cuele) separa la música
// de la voz dentro de la mezcla: por eso las pruebas usan frecuencias bien separadas.
const nivelBanda = (archivo, f, desde, largo) => {
    const r = spawnSync(ffmpegPath, ['-ss', String(desde), '-t', String(largo), '-i', archivo,
        '-af', `bandpass=f=${f}:width_type=q:w=8,bandpass=f=${f}:width_type=q:w=8,volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
    const m = r.stderr.match(/mean_volume: (-?[\d.]+) dB/);
    assert.ok(m, 'volumedetect no reportó nivel');
    return parseFloat(m[1]);
};

test('sin voz, música ni clics: silencio estéreo 48 kHz del largo exacto', () => {
    const out = correr(3, { locuciones: [], musica: null, clics: [], clic: { activo: false } });
    const info = spawnSync(ffmpegPath, ['-i', out]).stderr.toString();
    assert.match(info, /48000 Hz, stereo/);
    assert.ok(Math.abs(duracion(out) - 3) < 0.1);
});

test('voz retrasada a su marca y música en bucle más corta que el video', () => {
    const out = correr(6, { locuciones: [{ wav: wavDe(1), inicioSeg: 2 }], musica: { archivo: wavDe(1.5), volumen: 0.12, atenuar: true }, clics: [], clic: { activo: false } });
    const info = spawnSync(ffmpegPath, ['-i', out]).stderr.toString();
    assert.match(info, /48000 Hz, stereo/);
    assert.ok(Math.abs(duracion(out) - 6) < 0.15);
});

test('clics activos agregan una entrada lavfi por clic y ninguna si están apagados', () => {
    const con = cadenaDeMezcla({ total: 5, locuciones: [], musica: null, clics: [1, 2.5], clic: { activo: true, volumen: 0.5 } });
    const sin = cadenaDeMezcla({ total: 5, locuciones: [], musica: null, clics: [1, 2.5], clic: { activo: false, volumen: 0.5 } });
    assert.equal(con.entradas.filter((e) => String(e).startsWith('aevalsrc')).length, 2);
    assert.equal(sin.entradas.filter((e) => String(e).startsWith('aevalsrc')).length, 0);
});

test('los clics se oyen en su marca y el resto queda en silencio', () => {
    const out = correr(3, { locuciones: [], musica: null, clics: [1.5], clic: { activo: true, volumen: 0.8 } });
    assert.ok(Math.abs(duracion(out) - 3) < 0.1);
    const antes = nivelBanda(out, 3000, 0.2, 1);
    const clic = nivelBanda(out, 3000, 1.45, 0.2);
    assert.ok(clic - antes > 20, `el clic no se distingue del silencio (${clic} vs ${antes} dB)`);
});

test('con atenuar, la cadena usa la voz como llave de sidechaincompress', () => {
    const { filtro } = cadenaDeMezcla({ total: 5, locuciones: [{ wav: '/x.wav', inicioSeg: 0 }], musica: { archivo: '/m.mp3', volumen: 0.12, atenuar: true }, clics: [], clic: { activo: false } });
    assert.match(filtro, /sidechaincompress/);
});

test('con atenuar, la música baja de verdad mientras suena la voz (medido en el audio)', () => {
    // Voz a 200 Hz entre 3 y 5 s; música a 3 kHz en bucle todo el video. Se compara la
    // caída de la banda de la música (ventana con voz vs sin voz) con y sin atenuar: así
    // el efecto de loudnorm, que es igual en ambos casos, no se confunde con el ducking.
    const voz = wavDe(2, 200);
    const mus = wavDe(1.5, 3000, 2);
    const caida = (atenuar) => {
        const out = correr(7, { locuciones: [{ wav: voz, inicioSeg: 3 }], musica: { archivo: mus, volumen: 0.12, atenuar }, clics: [], clic: { activo: false } });
        return nivelBanda(out, 3000, 0.5, 2) - nivelBanda(out, 3000, 3.5, 1);
    };
    const conDucking = caida(true);
    const sinDucking = caida(false);
    assert.ok(conDucking - sinDucking > 6,
        `la música no se atenuó bajo la voz (caída con=${conDucking.toFixed(1)} dB, sin=${sinDucking.toFixed(1)} dB)`);
});

test('con atenuar, la música sigue sonando después de la última voz', () => {
    // sidechaincompress termina cuando se acaba su llave: sin rellenar la voz hasta el
    // final, la música se cortaba en seco al terminar la última locución.
    const out = correr(7, { locuciones: [{ wav: wavDe(1, 200), inicioSeg: 1 }], musica: { archivo: wavDe(1.5, 3000, 2), volumen: 0.12, atenuar: true }, clics: [], clic: { activo: false } });
    assert.ok(nivelBanda(out, 3000, 4.5, 2) > -60, 'la música se cortó al terminar la voz');
});

test('en los tramos sin voz la música queda a su volumen, sin que loudnorm la suba', () => {
    // loudnorm de una pasada es un control automático de ganancia: aplicado a la mezcla
    // entera subía la música de fondo hasta el nivel de la voz en cada silencio.
    // Música estéreo, como la real: una mono pierde 3 dB al abrirse a estéreo en swr.
    const musica = wavDe(1.5, 3000, 2);
    const out = correr(6, { locuciones: [{ wav: wavDe(1, 200), inicioSeg: 4 }], musica: { archivo: musica, volumen: 0.12, atenuar: false }, clics: [], clic: { activo: false } });
    // Referencia: la misma música con solo `volume=0.12`, sin pasar por la mezcla.
    const ref = join(mkdtempSync(join(tmpdir(), 'ref-')), 'r.wav');
    ff(['-y', '-i', musica, '-af', 'volume=0.12', ref]);
    const dif = nivelBanda(out, 3000, 0.5, 1) - nivelBanda(ref, 3000, 0.2, 1);
    assert.ok(Math.abs(dif) < 2, `la música antes de la voz cambió ${dif.toFixed(1)} dB respecto de su volumen`);
});
