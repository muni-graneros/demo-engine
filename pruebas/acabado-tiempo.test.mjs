import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDeRecorte, unir } from '../src/acabado/tiempo.mjs';

const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} ≠ ${b}`);

test('unir junta intervalos que se pisan o se tocan', () => {
    assert.deepEqual(unir([{ inicio: 5, fin: 6 }, { inicio: 0, fin: 2 }, { inicio: 1, fin: 3 }, { inicio: 3, fin: 4 }]),
        [{ inicio: 0, fin: 4 }, { inicio: 5, fin: 6 }]);
});

test('un hueco sin voz de más de maxSeg pierde el centro y conserva los márgenes', () => {
    // voz 0-3, hueco 3-13 (10 s), voz 13-15
    const plan = planDeRecorte({ total: 15, voces: [{ inicio: 0, fin: 3 }, { inicio: 13, fin: 15 }], maxSeg: 2, margenSeg: 0.5 });
    assert.deepEqual(plan.cortes, [{ inicio: 3.5, fin: 12.5 }]);
    cerca(plan.total, 6, 'total');
    cerca(plan.mapear(13), 4, 'la voz siguiente empieza 9 s antes');
    cerca(plan.mapear(2), 2, 'lo anterior al corte no se mueve');
    cerca(plan.mapear(8), 3.5, 'un punto dentro del corte cae en el empalme');
    assert.equal(plan.mapearEvento(8), null, 'un evento dentro del corte ya no se ve');
    cerca(plan.mapearEvento(14), 5, 'evento después del corte');
});

test('un hueco de hasta maxSeg no se toca', () => {
    const plan = planDeRecorte({ total: 6, voces: [{ inicio: 0, fin: 2 }, { inicio: 4, fin: 6 }], maxSeg: 2, margenSeg: 0.5 });
    assert.deepEqual(plan.cortes, []);
    cerca(plan.total, 6, 'total');
    assert.deepEqual(plan.piezas, [{ inicio: 0, fin: 6, origen: 0 }]);
});

test('lo protegido (un clic) parte el corte y sobrevive entero', () => {
    // hueco 2-20; clic en 10 protegido de 9 a 11.2
    const plan = planDeRecorte({
        total: 22, voces: [{ inicio: 0, fin: 2 }, { inicio: 20, fin: 22 }],
        protegidos: [{ inicio: 9, fin: 11.2 }], maxSeg: 2, margenSeg: 0.5,
    });
    assert.deepEqual(plan.cortes, [{ inicio: 2.5, fin: 9 }, { inicio: 11.2, fin: 19.5 }]);
    assert.notEqual(plan.mapearEvento(10), null, 'el clic sigue en el video');
    cerca(plan.mapearEvento(10), 3.5, 'y se corre lo que se cortó antes');
});

test('no deja cortes más cortos que minimoSeg', () => {
    const plan = planDeRecorte({
        total: 10, voces: [{ inicio: 0, fin: 2 }, { inicio: 5, fin: 10 }],
        protegidos: [{ inicio: 2.7, fin: 4.4 }], maxSeg: 2, margenSeg: 0.5, minimoSeg: 0.5,
    });
    // candidato 2.5-4.5 menos 2.7-4.4 deja 0.2 y 0.1: nada que valga la pena cortar
    assert.deepEqual(plan.cortes, []);
});

test('los bordes de los cortes caen en la grilla de cuadros', () => {
    const plan = planDeRecorte({ total: 20, voces: [{ inicio: 0, fin: 3.01234 }, { inicio: 15.4567, fin: 20 }], fps: 60 });
    for (const c of plan.cortes) {
        cerca(Math.round(c.inicio * 60), c.inicio * 60, 'inicio en la grilla');
        cerca(Math.round(c.fin * 60), c.fin * 60, 'fin en la grilla');
    }
});

test('las piezas cubren el reloj nuevo sin huecos y apuntan a su origen', () => {
    const plan = planDeRecorte({ total: 30, voces: [{ inicio: 0, fin: 2 }, { inicio: 10, fin: 12 }, { inicio: 25, fin: 30 }] });
    let reloj = 0;
    for (const p of plan.piezas) {
        cerca(p.inicio, reloj, 'pieza contigua');
        cerca(plan.mapear(p.origen), p.inicio, 'origen coherente con mapear');
        reloj = p.fin;
    }
    cerca(reloj, plan.total, 'las piezas suman el total nuevo');
});

test('un silencio al principio y al final también se recorta', () => {
    const plan = planDeRecorte({ total: 20, voces: [{ inicio: 6, fin: 8 }] });
    assert.deepEqual(plan.cortes, [{ inicio: 0.5, fin: 5.5 }, { inicio: 8.5, fin: 19.5 }]);
});

test('rechaza márgenes que no caben en maxSeg', () => {
    assert.throws(() => planDeRecorte({ total: 10, voces: [], maxSeg: 1, margenSeg: 0.5 }), /maxSeg/);
});
