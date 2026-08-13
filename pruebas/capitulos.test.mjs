import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capitulosConTiempos, ffmetadata, indiceMarkdown } from '../src/capitulos.mjs';

const CAPITULOS = [
    { id: 'ciudadano', titulo: '1. El ciudadano hace su trámite' },
    { id: 'recepcion', titulo: '2. El municipio recibe y revisa' },
    { id: 'examen', titulo: '3. El examen médico' },
];

test('encadena los capítulos según la duración de cada uno', () => {
    const con = capitulosConTiempos(CAPITULOS, [62.5, 90, 45]);
    assert.deepEqual(con.map((c) => c.inicioSeg), [0, 62.5, 152.5]);
    assert.equal(con.at(-1).finSeg, 197.5);
});

test('el ffmetadata usa milisegundos y una entrada por capítulo', () => {
    const texto = ffmetadata(capitulosConTiempos(CAPITULOS, [10, 20, 30]));
    assert.match(texto, /^;FFMETADATA1/);
    assert.equal((texto.match(/\[CHAPTER\]/g) ?? []).length, 3);
    assert.match(texto, /TIMEBASE=1\/1000/);
    assert.match(texto, /START=10000\nEND=30000/);
});

test('un título con salto de línea no parte la metadata en dos', () => {
    // Medido: `;`, `#` y `=` dentro del valor no molestan; el salto de línea sí, porque
    // la segunda mitad se lee como otro campo y aparece un capítulo con datos inventados.
    const texto = ffmetadata(capitulosConTiempos([{ id: 'a', titulo: 'Capítulo\nfalso=1' }], [10]));
    const lineas = texto.split('\n').filter((l) => l.trim());
    assert.equal(lineas.filter((l) => l.startsWith('title=')).length, 1);
    assert.ok(!lineas.includes('falso=1'), 'el salto de línea creó una línea de metadata espuria');
});

test('el índice markdown trae las marcas de tiempo legibles', () => {
    const md = indiceMarkdown(capitulosConTiempos(CAPITULOS, [62.5, 90, 45]), 'Curso completo');
    assert.match(md, /# Curso completo/);
    assert.match(md, /- \*\*00:00\*\* — 1\. El ciudadano hace su trámite/);
    assert.match(md, /- \*\*02:32\*\* — 3\. El examen médico/);
});
