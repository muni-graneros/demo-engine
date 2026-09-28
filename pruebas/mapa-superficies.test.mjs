import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUTA_FFMPEG as ffmpegPath, duracion } from '../src/ffmpeg.mjs';
import { renderizarMapa } from '../src/mapa-superficies.mjs';

// Los mismos datos para todas las pruebas: tres superficies, la sala activa y el vecino
// anterior, así hay un nodo en cada estado (activa, anterior, atenuada).
const datos = (t) => ({
    superficies: {
        vecino: { nombre: 'App del vecino', tipo: 'telefono', icono: 'phone', color: '#9a3412', quien: 'Vecina que reporta' },
        sala: { nombre: 'Sala de operaciones', tipo: 'escritorio', icono: 'monitor', color: '#1e3a8a', quien: 'Operador de turno' },
        apk: { nombre: 'App del patrullero', tipo: 'telefono', icono: 'phone', color: '#166534', quien: 'Patrullero' },
    },
    flujo: [['vecino', 'sala'], ['sala', 'apk']], activa: 'sala', anterior: 'vecino',
    lienzo: { ancho: 1920, alto: 1080 }, marca: { color: '#1e3a8a' }, ms: 2500,
    salida: temporal(t), nombre: 'mapa.mp4',
});

/** Carpeta temporal que se borra al terminar la prueba. */
function temporal(t) {
    const dir = mkdtempSync(join(tmpdir(), 'mapa-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}

test('el clip de la tarjeta dura ms, tiene el tamaño del lienzo y no trae audio', async (t) => {
    const d = datos(t);
    const mp4 = await renderizarMapa(d);
    assert.ok(Math.abs(duracion(mp4) - 2.5) < 0.1);
    const info = spawnSync(ffmpegPath, ['-i', mp4]).stderr.toString();
    assert.match(info, /1920x1080/);
    assert.match(info, /yuv420p/);
    assert.match(info, /25 fps/);
    assert.doesNotMatch(info, /Audio:/);
    // el PNG intermedio no queda tirado junto al mp4
    assert.equal(existsSync(join(d.salida, 'mapa.png')), false);
});

test('la tarjeta rotula "Usted está aquí" solo en la activa', async (t) => {
    // renderizarMapa acepta devolverTexto:true (como renderizarMarco) y devuelve el innerText.
    const texto = await renderizarMapa({ ...datos(t), devolverTexto: true });
    assert.equal(texto.match(/Usted está aquí/g).length, 1);
});

test('WCAG 1.4.3: todo texto de la tarjeta es opaco y tiene contraste >= 4.5:1', async (t) => {
    const medidas = await renderizarMapa({ ...datos(t), devolverContrastes: true });
    // 3 nombres + 3 quién + 1 etiqueta
    assert.equal(medidas.length, 7);
    for (const m of medidas) {
        assert.equal(m.opacidad, 1, `"${m.texto}" hereda opacidad ${m.opacidad}`);
        assert.ok(m.contraste >= 4.5, `"${m.texto}" (${m.clase}) contraste ${m.contraste.toFixed(2)}`);
    }
});

test('con 9 superficies todos los nodos y la etiqueta caben en el lienzo', async (t) => {
    const superficies = {};
    for (let i = 1; i <= 9; i++) {
        superficies['s' + i] = { nombre: `Superficie número ${i}`, icono: 'monitor', color: '#1e3a8a', quien: 'Funcionario municipal' };
    }
    const flujo = Array.from({ length: 8 }, (_, i) => ['s' + (i + 1), 's' + (i + 2)]);
    const cajas = await renderizarMapa({ ...datos(t), superficies, flujo, activa: 's9', anterior: 's8', devolverCajas: true });
    assert.equal(cajas.length, 9);
    const dentro = (r, que) => {
        assert.ok(r.left >= 0 && r.top >= 0 && r.right <= 1920 && r.bottom <= 1080, `${que} fuera del lienzo: ${JSON.stringify(r)}`);
    };
    cajas.forEach((c, i) => { dentro(c, 'nodo ' + (i + 1)); if (c.etiqueta) dentro(c.etiqueta, 'etiqueta'); });
    assert.equal(cajas.filter((c) => c.etiqueta).length, 1);
});

test('un color que no es hexadecimal falla con un error claro', async (t) => {
    const d = datos(t);
    d.superficies.sala.color = 'rgb(30,58,138)';
    await assert.rejects(renderizarMapa(d), /superficies\.sala\.color debe ser hexadecimal/);
});

/** n superficies genéricas s1..sn. */
function muchas(n) {
    const superficies = {};
    for (let i = 1; i <= n; i++) {
        superficies['s' + i] = { nombre: `Superficie número ${i}`, icono: 'monitor', color: '#1e3a8a', quien: 'Funcionario municipal' };
    }
    return superficies;
}

test('ninguna flecha pasa por encima o por detrás de un nodo ajeno (9 en fila, secuencial)', async (t) => {
    const flujo = Array.from({ length: 8 }, (_, i) => ['s' + (i + 1), 's' + (i + 2)]);
    const r = await renderizarMapa({ ...datos(t), superficies: muchas(9), flujo, activa: 's6', anterior: 's5', devolverFlechas: true });
    assert.equal(r.trazos, 8);
    assert.deepEqual(r.choques, []);
});

test('7 superficies (4+3) con arista hacia atrás y salto no contiguo: tampoco pisan nodos', async (t) => {
    const flujo = [...Array.from({ length: 6 }, (_, i) => ['s' + (i + 1), 's' + (i + 2)]), ['s7', 's1'], ['s1', 's3'], ['s2', 's1']];
    const r = await renderizarMapa({ ...datos(t), superficies: muchas(7), flujo, activa: 's7', anterior: 's6', devolverFlechas: true });
    assert.equal(r.trazos, 9);
    assert.deepEqual(r.choques, []);
});
