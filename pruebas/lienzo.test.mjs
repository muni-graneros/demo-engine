import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geometriaLienzo, renderizarLienzo } from '../src/lienzo.mjs';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const L = { ancho: 1920, alto: 1080 };
const PADDING = 64, SEP = PADDING / 2;
// Directorio temporal que se borra al terminar el test: cada render deja un PNG de 1920×1080.
const temporal = (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'lienzo-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
};
const pixel = (png, x, y) => {   // RGBA de un píxel, leído con ffmpeg (sin dependencias)
    // exact=1: sin eso el crop de 1x1 se redondea a 0x0 y ffmpeg aborta.
    const r = spawnSync(ffmpegPath, ['-v', 'error', '-i', png, '-vf', `crop=1:1:${x}:${y}:exact=1`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
    return [...r.stdout];
};

test('un teléfono conserva el aspecto del dispositivo y queda centrado', () => {
    const [h] = geometriaLienzo({ lienzo: L, paneles: [{ tipo: 'telefono', aspecto: 412 / 839 }] });
    assert.ok(Math.abs(h.ancho / h.alto - 412 / 839) < 0.01);
    assert.ok(Math.abs((h.x + h.ancho / 2) - L.ancho / 2) <= 1);
    assert.equal(h.ancho % 2, 0); assert.equal(h.alto % 2, 0);
});

test('dos paneles se reparten el ancho en proporción a su aspecto, sin solaparse', () => {
    const tel = { tipo: 'telefono', aspecto: 412 / 839, chip: { nombre: 'x', icono: 'phone', color: '#166534' } };
    const ven = { tipo: 'ventana', aspecto: 1.6, chip: { nombre: 'y', icono: 'monitor', color: '#fde047' } };
    const [a, b] = geometriaLienzo({ lienzo: L, paneles: [tel, ven] });
    // Sin solaparse contando el bisel del teléfono (18 px) y la separación entre paneles.
    assert.ok(a.x + a.ancho + 18 + SEP <= b.x, `a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
    // Ambos huecos (con el bisel del teléfono) dentro del padding.
    assert.ok(a.x - 18 >= PADDING && b.x + b.ancho <= L.ancho - PADDING);
    for (const h of [a, b]) {
        assert.ok(h.y >= PADDING && h.y + h.alto <= L.alto - PADDING);
        for (const v of [h.x, h.y, h.ancho, h.alto]) { assert.ok(Number.isInteger(v)); assert.equal(v % 2, 0); }
    }
    assert.equal(a.alto, b.alto, 'misma altura de pantalla en los dos paneles');
    assert.ok(Math.abs(a.ancho / a.alto - 412 / 839) < 0.01 && Math.abs(b.ancho / b.alto - 1.6) < 0.01);
    // Con columnas iguales la ventana no pasaba de ~864 px de ancho y el grupo ocupaba mucho
    // menos del ancho útil; proporcional, el grupo llena casi todo el ancho disponible.
    assert.ok(b.ancho > 1100, `ventana ${b.ancho}`);
    const grupo = (b.x + b.ancho) - (a.x - 18);
    assert.ok(grupo > (L.ancho - 2 * PADDING) * 0.9, `grupo ${grupo}`);
});

test('geometriaLienzo rechaza cantidades de paneles y tipos que no sabe dibujar', () => {
    assert.throws(() => geometriaLienzo({ lienzo: L, paneles: [] }), /paneles/);
    const p = { tipo: 'ventana', aspecto: 1.6 };
    assert.throws(() => geometriaLienzo({ lienzo: L, paneles: [p, p, p] }), /paneles/);
    assert.throws(() => geometriaLienzo({ lienzo: L, paneles: [{ tipo: 'tablet', aspecto: 1 }] }), /tipo/);
});

test('un nombre de chip larguísimo se recorta con elipsis dentro de la columna de su panel', async (t) => {
    const nombre = 'Aplicación móvil del patrullero municipal de seguridad ciudadana · Android 14 · v2';
    // En pantalla dividida la columna del teléfono termina donde empieza la ventana: ahí no
    // cabe, y tiene que recortarse sin pisar al vecino.
    const r = await renderizarLienzo({ lienzo: L, paneles: [
        { tipo: 'telefono', aspecto: 412 / 839, chip: { nombre, icono: 'phone', color: '#166534' } },
        { tipo: 'ventana', aspecto: 1.6, url: 'http://x', chip: { nombre: 'Sala', icono: 'monitor', color: '#1e3a8a' } },
    ], marca: { color: '#1e3a8a' }, salida: temporal(t), devolverContraste: true });
    const [c, ven] = r.chips;
    assert.ok(c.x >= c.columna.x - 0.5 && c.x + c.ancho <= c.columna.x + c.columna.ancho + 0.5, JSON.stringify(c));
    assert.ok(c.x >= PADDING - 0.5 && c.x + c.ancho <= ven.panel.x, JSON.stringify(c));
    assert.ok(c.recortado, 'el texto tiene que quedar recortado (elipsis), no desbordado');

    // Un solo panel: la columna es todo el ancho útil, y el chip no se sale del padding.
    const solo = await renderizarLienzo({ lienzo: L, paneles: [{ tipo: 'telefono', aspecto: 412 / 839, chip: { nombre: nombre.repeat(3), icono: 'phone', color: '#166534' } }],
        marca: { color: '#1e3a8a' }, salida: temporal(t), devolverContraste: true });
    const [s1] = solo.chips;
    assert.ok(s1.x >= PADDING - 0.5 && s1.x + s1.ancho <= L.ancho - PADDING + 0.5, JSON.stringify(s1));
    assert.ok(s1.recortado);
});

test('en pantalla dividida el chip del teléfono no se trunca ni pisa el panel vecino', async (t) => {
    // El chip es lo que nombra la superficie (el color no puede ser lo único, WCAG 1.4.1):
    // limitarlo al ancho de la carcasa lo dejaba en «App de…», ilegible.
    const r = await renderizarLienzo({ lienzo: L,
        paneles: [
            { tipo: 'telefono', aspecto: 412 / 840, chip: { nombre: 'App del patrullero · Android', icono: 'phone', color: '#166534' } },
            { tipo: 'ventana', aspecto: 1.6, url: 'http://x', chip: { nombre: 'Sala de operaciones', icono: 'monitor', color: '#1e3a8a' } },
        ],
        marca: { color: '#1e3a8a' }, salida: temporal(t), devolverContraste: true });
    const [tel, ven] = r.chips;
    assert.ok(!tel.recortado, `el chip del teléfono no debe recortarse: ${JSON.stringify(tel)}`);
    // No pisa ni la ventana ni su chip.
    assert.ok(tel.x + tel.ancho <= ven.panel.x, `chip ${tel.x + tel.ancho} vs ventana ${ven.panel.x}`);
    assert.ok(tel.x + tel.ancho <= ven.x, 'no pisa el chip de la ventana');
    assert.ok(tel.x >= PADDING - 0.5, 'no se sale por la izquierda del lienzo');
    assert.ok(!ven.recortado);
});

test('en un lienzo chico el chip del teléfono crece más allá de la carcasa en vez de recortarse', async (t) => {
    // Lo que se vio en el curso de 960×540: la carcasa medía ~156 px y el chip salía «App de…».
    const chico = { ancho: 960, alto: 540 };
    const r = await renderizarLienzo({ lienzo: chico,
        paneles: [
            { tipo: 'telefono', aspecto: 412 / 840, chip: { nombre: 'App del vecino', icono: 'phone', color: '#9a3412' } },
            { tipo: 'ventana', aspecto: 800 / 600, url: 'http://x', chip: { nombre: 'Sala de operaciones', icono: 'monitor', color: '#1e3a8a' } },
        ],
        marca: { color: '#1e3a8a' }, salida: temporal(t), devolverContraste: true });
    const [tel, ven] = r.chips;
    assert.ok(!tel.recortado, `el chip del teléfono no debe recortarse: ${JSON.stringify(tel)}`);
    assert.ok(tel.ancho > tel.panel.ancho, 'para no recortarse tiene que poder ser más ancho que la carcasa');
    assert.ok(tel.x + tel.ancho <= ven.panel.x && tel.x + tel.ancho <= ven.x, 'no pisa la ventana ni su chip');
    assert.ok(tel.x >= PADDING - 0.5);
    assert.ok(!ven.recortado);
});

test('el PNG deja el hueco transparente y pinta el fondo fuera', async (t) => {
    const dir = temporal(t);
    const { png, huecos: [h] } = await renderizarLienzo({ lienzo: L,
        paneles: [{ tipo: 'telefono', aspecto: 412 / 839, chip: { nombre: 'App del patrullero · Android', icono: 'phone', color: '#166534' } }],
        marca: { color: '#1e3a8a' }, salida: dir });
    assert.equal(pixel(png, h.x + h.ancho / 2, h.y + h.alto / 2)[3], 0);   // hueco transparente
    assert.equal(pixel(png, 5, 5)[3], 255);                                  // fondo opaco
});

test('chip: el texto contrasta al menos 4.5:1 con su fondo', async (t) => {
    const dir = temporal(t);
    const r = await renderizarLienzo({ lienzo: L, paneles: [{ tipo: 'ventana', aspecto: 1.6, chip: { nombre: 'Sala de operaciones', icono: 'monitor', color: '#fde047' } }],
        marca: { color: '#1e3a8a' }, salida: dir, devolverContraste: true });
    assert.ok(r.contraste >= 4.5, `contraste ${r.contraste}`);
});

test('dos paneles: ambos huecos transparentes, bisel y barra opacos', async (ctx) => {
    // El fondo se pinta con una máscara que tiene que perforar TODOS los huecos, no solo el
    // primero; y el bisel del teléfono y la barra de la ventana tienen que tapar el fondo.
    const dir = temporal(ctx);
    const { png, huecos: [t, v] } = await renderizarLienzo({ lienzo: L,
        paneles: [
            { tipo: 'telefono', aspecto: 412 / 839, chip: { nombre: 'App del patrullero', icono: 'phone', color: '#166534' } },
            { tipo: 'ventana', aspecto: 1.6, url: 'https://seguridad.graneros.cl', chip: { nombre: 'Sala de operaciones', icono: 'monitor', color: '#fde047' } },
        ],
        marca: { color: '#1e3a8a' }, salida: dir });
    assert.equal(pixel(png, t.x + t.ancho / 2, t.y + t.alto / 2)[3], 0);
    assert.equal(pixel(png, v.x + v.ancho / 2, v.y + v.alto / 2)[3], 0);
    const bisel = pixel(png, t.x + t.ancho / 2, t.y + t.alto + 28);   // bajo el hueco del teléfono
    assert.equal(bisel[3], 255);
    assert.ok(bisel[0] < 30 && bisel[1] < 30 && bisel[2] < 30, `bisel ${bisel}`);
    assert.equal(pixel(png, v.x + 200, v.y - 19)[3], 255);              // barra de la ventana
});
