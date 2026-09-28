import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geometriaLienzo, renderizarLienzo } from '../src/lienzo.mjs';
import { spawnSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const L = { ancho: 1920, alto: 1080 };
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

test('dos paneles caen en columnas distintas sin solaparse', () => {
    const [a, b] = geometriaLienzo({ lienzo: L, paneles: [{ tipo: 'telefono', aspecto: 0.49 }, { tipo: 'ventana', aspecto: 1.6 }] });
    assert.ok(a.x + a.ancho <= L.ancho / 2);
    assert.ok(b.x >= L.ancho / 2);
});

test('el PNG deja el hueco transparente y pinta el fondo fuera', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lienzo-'));
    const { png, huecos: [h] } = await renderizarLienzo({ lienzo: L,
        paneles: [{ tipo: 'telefono', aspecto: 412 / 839, chip: { nombre: 'App del patrullero · Android', icono: 'phone', color: '#166534' } }],
        marca: { color: '#1e3a8a' }, salida: dir });
    assert.equal(pixel(png, h.x + h.ancho / 2, h.y + h.alto / 2)[3], 0);   // hueco transparente
    assert.equal(pixel(png, 5, 5)[3], 255);                                  // fondo opaco
});

test('chip: el texto contrasta al menos 4.5:1 con su fondo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lienzo-'));
    const r = await renderizarLienzo({ lienzo: L, paneles: [{ tipo: 'ventana', aspecto: 1.6, chip: { nombre: 'Sala de operaciones', icono: 'monitor', color: '#fde047' } }],
        marca: { color: '#1e3a8a' }, salida: dir, devolverContraste: true });
    assert.ok(r.contraste >= 4.5, `contraste ${r.contraste}`);
});

test('dos paneles: ambos huecos transparentes, bisel y barra opacos', async () => {
    // El fondo se pinta con una máscara que tiene que perforar TODOS los huecos, no solo el
    // primero; y el bisel del teléfono y la barra de la ventana tienen que tapar el fondo.
    const dir = mkdtempSync(join(tmpdir(), 'lienzo-'));
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
