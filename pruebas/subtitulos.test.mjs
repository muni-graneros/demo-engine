import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarVtt, generarSrt, parseVtt } from '../src/subtitulos.mjs';

const SEGMENTOS = [
    { inicioSeg: 0, finSeg: 4.5, narrar: 'El ciudadano envía su solicitud.' },
    { inicioSeg: 4.5, finSeg: 9, narrar: 'El funcionario la revisa.' },
    { inicioSeg: 9, finSeg: 12, narrar: undefined },
];

test('el VTT lleva cabecera y una entrada por locución', () => {
    const vtt = generarVtt(SEGMENTOS);
    assert.match(vtt, /^WEBVTT/);
    assert.equal((vtt.match(/-->/g) ?? []).length, 2, 'el segmento sin narración no genera entrada');
    assert.match(vtt, /00:00:00\.000 --> 00:00:04\.500/);
});

test('el SRT numera las entradas y usa coma decimal', () => {
    const srt = generarSrt(SEGMENTOS);
    assert.match(srt, /^1\n00:00:00,000 --> 00:00:04,500\nEl ciudadano envía su solicitud\./);
    assert.match(srt, /\n2\n/);
});

test('una hora larga se formatea con las horas correctas', () => {
    const vtt = generarVtt([{ inicioSeg: 3725.5, finSeg: 3727, narrar: 'Cierre.' }]);
    assert.match(vtt, /01:02:05\.500 --> 01:02:07\.000/);
});

test('los milisegundos acarrean en vez de producir un timestamp inválido', () => {
    // Redondear la fracción por separado da "00:00:59.1000" (cuatro dígitos), y el
    // navegador descarta esa cue EN SILENCIO: el subtítulo desaparece sin error.
    const vtt = generarVtt([
        { inicioSeg: 0, finSeg: 59.9999, narrar: 'Cruza el minuto.' },
        { inicioSeg: 3599.9996, finSeg: 3601, narrar: 'Cruza la hora.' },
    ]);
    assert.doesNotMatch(vtt, /\.\d{4}/, 'ningún timestamp puede tener cuatro dígitos de ms');
    assert.match(vtt, /00:00:00\.000 --> 00:01:00\.000/);
    assert.match(vtt, /01:00:00\.000 --> 01:00:01\.000/);

    const srt = generarSrt([{ inicioSeg: 59.9999, finSeg: 60.5, narrar: 'Cruza.' }]);
    assert.match(srt, /00:01:00,000 --> 00:01:00,500/);
});

test('parseVtt recupera las cues con sus tiempos y su texto', () => {
    const cues = parseVtt(generarVtt(SEGMENTOS));
    assert.equal(cues.length, 2, 'el segmento sin narración no genera cue');
    assert.deepEqual(cues[0], { inicioSeg: 0, finSeg: 4.5, narrar: 'El ciudadano envía su solicitud.' });
    assert.deepEqual(cues[1], { inicioSeg: 4.5, finSeg: 9, narrar: 'El funcionario la revisa.' });
});

test('parseVtt ignora la cabecera y los bloques sin marca de tiempo (NOTE, etc.)', () => {
    const cues = parseVtt('WEBVTT\n\nNOTE algo que no es una cue\n\n00:00:01.000 --> 00:00:02.000\nHola.\n');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].narrar, 'Hola.');
});

test('parseVtt entiende horas de más de un dígito de reloj (curso largo)', () => {
    const cues = parseVtt('WEBVTT\n\n01:02:05.500 --> 01:02:07.000\nCierre.\n');
    assert.equal(cues[0].inicioSeg, 3725.5);
    assert.equal(cues[0].finSeg, 3727);
});
