import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarVtt, generarSrt } from '../src/subtitulos.mjs';

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
