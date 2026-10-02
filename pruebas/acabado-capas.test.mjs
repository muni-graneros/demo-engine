import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    cuesDeVoz, sinParpadeo, rotulosDeEscenas, estadosDeSubtitulos, estadosDeRotulos, htmlDeEstado,
    listaDeCapa, renderizarEstados,
} from '../src/acabado/capas.mjs';
import { ff } from '../src/ffmpeg.mjs';

test('cuesDeVoz usa el tramo de la voz, no el del paso entero', () => {
    const cues = cuesDeVoz([{ inicioSeg: 10, finSeg: 30, narrar: 'Hola.', vozSeg: 2 }]);
    assert.equal(cues.length, 1);
    assert.equal(cues[0].inicioSeg, 10);
    assert.ok(Math.abs(cues[0].finSeg - 12.25) < 1e-9, `fin ${cues[0].finSeg}`);
});

test('cuesDeVoz sin duración de voz conserva el tramo del paso y parte en 42×2', () => {
    const largo = 'Esta es una frase bastante larga que no cabe en una sola línea de subtítulo. Y esta es la segunda frase del paso.';
    const cues = cuesDeVoz([{ inicioSeg: 0, finSeg: 8, narrar: largo }]);
    assert.ok(cues.length >= 2);
    assert.equal(cues.at(-1).finSeg, 8);
    for (const c of cues) assert.ok(c.narrar.split('\n').every((l) => l.length <= 42));
});

test('sinParpadeo rellena huecos imperceptibles y respeta los largos', () => {
    const c = sinParpadeo([
        { inicioSeg: 0, finSeg: 1, narrar: 'a' },
        { inicioSeg: 1.2, finSeg: 2, narrar: 'b' },
        { inicioSeg: 5, finSeg: 6, narrar: 'c' },
    ]);
    assert.equal(c[0].finSeg, 1.2, 'hueco de 0,2 s rellenado');
    assert.equal(c[1].finSeg, 2, 'hueco de 3 s se respeta');
});

test('un rótulo por escena con título, nunca en un tramo plano', () => {
    const r = rotulosDeEscenas([
        { inicioSeg: 0, finSeg: 2, escena: 'portada', titulo: 'Portada', plano: 'portada' },
        { inicioSeg: 2, finSeg: 5, escena: 'a', titulo: 'Primera' },
        { inicioSeg: 5, finSeg: 9, escena: 'a', titulo: 'Primera' },
        { inicioSeg: 9, finSeg: 20, escena: 'b', titulo: 'Segunda' },
        { inicioSeg: 20, finSeg: 30, escena: 'c' },
    ], { segundos: 3, antetitulo: 'Capítulo' });
    assert.deepEqual(r.map((x) => [x.inicio, x.fin, x.titulo, x.antetitulo]), [[2, 5, 'Primera', 'Capítulo'], [9, 12, 'Segunda', 'Capítulo']]);
});

test('los estados de un rótulo animan la entrada y la salida sin pisarse', () => {
    const e = estadosDeRotulos([{ inicio: 1, fin: 4, titulo: 'T', antetitulo: '' }]);
    assert.ok(e.length > 10, 'cuadros de entrada y salida');
    for (let i = 1; i < e.length; i++) assert.ok(Math.abs(e[i].inicio - e[i - 1].fin) < 1e-9, 'contiguos');
    assert.ok(e[0].datos.opacidad < 0.5 && e[0].datos.desplazamiento > 0, 'entra desde el costado y transparente');
    assert.ok(e.at(-1).datos.opacidad < 0.5, 'sale desvaneciéndose');
    assert.equal(Math.max(...e.map((x) => x.datos.opacidad)), 1);
});

test('el subtítulo escapa el texto y usa texto blanco sobre fondo oscuro', () => {
    const html = htmlDeEstado({ tipo: 'subtitulo', texto: 'a < b & "c"' }, { lienzo: { ancho: 1920, alto: 1080 } });
    assert.match(html, /a &lt; b &amp; &quot;c&quot;/);
    assert.match(html, /color:#fff/);
    assert.match(html, /background:rgba\(15,23,42,\.88\)/);
});

test('listaDeCapa recorta y desplaza al reloj de la pieza, y rellena con el transparente', () => {
    const estados = [
        { inicio: 1, fin: 3, png: '/a.png' },
        { inicio: 5, fin: 9, png: '/b.png' },
    ];
    const texto = listaDeCapa(estados, '/v.png', { desde: 2, hasta: 6 });
    assert.equal(texto, 'ffconcat version 1.0\n'
        + "file '/a.png'\nduration 1.000000\n"
        + "file '/v.png'\nduration 2.000000\n"
        + "file '/b.png'\nduration 1.000000\n"
        + "file '/b.png'\n");
    assert.equal(listaDeCapa(estados, '/v.png', { desde: 3.5, hasta: 4.5 }), null, 'tramo vacío: sin capa');
});

test('renderizarEstados dibuja la píldora abajo al centro y deja transparente lo demás', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-capas-'));
    const lienzo = { ancho: 640, alto: 360 };
    const { estados, vacio } = await renderizarEstados(
        estadosDeSubtitulos([{ inicioSeg: 0, finSeg: 1, narrar: 'Hola mundo' }]),
        { lienzo, dir, tamano: 24 });
    assert.ok(existsSync(vacio) && existsSync(estados[0].png));
    // Píxel del centro abajo (dentro de la píldora) opaco y oscuro; esquina superior transparente.
    const pixel = (png, x, y) => {
        const crudo = join(dir, `p-${x}-${y}.rgba`);
        ff(['-y', '-i', png, '-vf', `crop=1:1:${x}:${y}:exact=1,format=rgba`, '-f', 'rawvideo', crudo]);
        return [...readFileSync(crudo)];
    };
    const centro = pixel(estados[0].png, 320 - 60, 360 - 16 - 12);
    assert.ok(centro[3] > 200, `la píldora es opaca (alfa ${centro[3]})`);
    const esquina = pixel(estados[0].png, 5, 5);
    assert.equal(esquina[3], 0, 'fuera de la píldora es transparente');
});

test('con un teléfono solo en pantalla, el subtítulo va al costado y en una sola caja', () => {
    const estados = estadosDeSubtitulos([
        { inicioSeg: 0, finSeg: 2, narrar: 'En la sala.' },
        { inicioSeg: 2, finSeg: 4, narrar: 'En el\nteléfono.' },
    ], { lateralEn: (t) => t >= 2 });
    assert.equal(estados[0].datos.lateral, false);
    assert.equal(estados[1].datos.lateral, true);
    assert.notEqual(estados[0].clave, estados[1].clave.replace(/-l$/, '') + 'x');
    const html = htmlDeEstado(estados[1].datos, { lienzo: { ancho: 1920, alto: 1080 } });
    assert.match(html, /align-items:center/);
    assert.match(html, /En el teléfono\./, 'las líneas se juntan: la caja lateral envuelve sola');
});
