import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirLineaDeTiempo } from '../src/linea-tiempo.mjs';

// Dos actores intercalados: ciudadano entrega, funcionario revisa, ciudadano vuelve.
const PASOS = [
    { escena: 'entrega',  actor: 'ciudadano',   tLocal: 0,     tGlobal: 0,     duracionMs: 5000, narrar: 'Envía su solicitud.' },
    { escena: 'revision', actor: 'funcionario', tLocal: 0,     tGlobal: 5000,  duracionMs: 8000, narrar: 'El funcionario revisa.' },
    { escena: 'cierre',   actor: 'ciudadano',   tLocal: 5000,  tGlobal: 13000, duracionMs: 4000, narrar: 'Recibe su comprobante.' },
];

test('ordena los segmentos por tiempo global, no por actor', () => {
    const linea = construirLineaDeTiempo(PASOS);
    assert.deepEqual(linea.map((s) => s.escena), ['entrega', 'revision', 'cierre']);
});

test('cada segmento apunta al tramo correcto DENTRO de la pista de su actor', () => {
    const linea = construirLineaDeTiempo(PASOS);
    const cierre = linea.find((s) => s.escena === 'cierre');
    assert.equal(cierre.actor, 'ciudadano');
    assert.equal(cierre.desdeSeg, 5);   // tLocal, no tGlobal
    assert.equal(cierre.hastaSeg, 9);
});

test('los segmentos consecutivos del mismo actor no se solapan', () => {
    const linea = construirLineaDeTiempo(PASOS);
    const delCiudadano = linea.filter((s) => s.actor === 'ciudadano');
    assert.ok(delCiudadano[0].hastaSeg <= delCiudadano[1].desdeSeg,
        'el primer segmento del ciudadano termina antes de que empiece el segundo');
});

test('rechaza un paso sin duración en vez de producir un video mudo y cortado', () => {
    assert.throws(() => construirLineaDeTiempo([{ escena: 'x', actor: 'a', tLocal: 0, tGlobal: 0 }]),
        /duracionMs/);
});

test('con un solo actor la línea es la del guion, sin huecos', () => {
    const linea = construirLineaDeTiempo([
        { escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 3000 },
        { escena: 'b', actor: 'uno', tLocal: 3000, tGlobal: 3000, duracionMs: 2000 },
    ]);
    assert.equal(linea[0].hastaSeg, linea[1].desdeSeg);
});
