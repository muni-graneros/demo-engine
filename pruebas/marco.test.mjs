import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { renderizarMarco, geometria } from '../src/marco.mjs';

const presentacion = {
    fondo: null, padding: 80, radio: 16, sombra: true, barra: true,
    salida: { ancho: 960, alto: 540 },
    transicion3d: { activa: true, ms: 900, gradosMax: 12 },
};

/** Devuelve el pixel RGBA en (x,y) del PNG, leyendo por ffmpeg a rawvideo. */
function pixel(png, x, y) {
    // exact=1: sin eso el crop de 1x1 se redondea a 0x0 y ffmpeg aborta (ver escenario3d.test).
    const r = spawnSync(RUTA_FFMPEG, ['-i', png, '-vf', `crop=1:1:${x}:${y}:exact=1`,
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1e6 });
    return [...r.stdout.subarray(0, 4)];
}

test('el marco sale con las dimensiones de salida y el centro transparente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-marco-'));
    const png = await renderizarMarco({
        salida: dir, presentacion, marca: { color: '#1e3a8a' }, baseURL: 'http://localhost:8000',
    });
    assert.ok(existsSync(png));

    // el centro es el hueco donde va el video: alfa 0
    assert.equal(pixel(png, 480, 300)[3], 0);
    // la esquina es fondo opaco
    assert.equal(pixel(png, 4, 4)[3], 255);
});

test('la barra muestra la URL del sistema', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-marco-'));
    const texto = await renderizarMarco({
        salida: dir, presentacion, marca: { color: '#1e3a8a' },
        baseURL: 'http://localhost:8000', devolverTexto: true,
    });
    assert.match(texto, /localhost:8000/);
});

test('con barra:false no se dibuja la barra: ese alto es hueco del video', async () => {
    // geometria() ya no reservaba alto para la barra, pero el HTML la dibujaba igual: los
    // primeros 38px del video quedaban tapados por la barra gris.
    const dir = mkdtempSync(join(tmpdir(), 'demo-marco-sinbarra-'));
    const sinBarra = { ...presentacion, barra: false };
    const png = await renderizarMarco({
        salida: dir, presentacion: sinBarra, marca: { color: '#1e3a8a' }, baseURL: 'http://localhost:8000',
    });
    const g = geometria(sinBarra);
    assert.equal(pixel(png, 480, g.y + 2)[3], 0, 'arriba del hueco no puede quedar barra opaca');
});

test('las esquinas del recorte quedan opacas: el video cuadrado no asoma', async () => {
    // `overflow:hidden` no pinta nada fuera del radio; ese sobrante quedaba transparente y
    // por ahí se veía la esquina cuadrada del video (abajo) o el negro del compuesto (arriba).
    const dir = mkdtempSync(join(tmpdir(), 'demo-marco-esquinas-'));
    const png = await renderizarMarco({
        salida: dir, presentacion, marca: { color: '#1e3a8a' }, baseURL: 'http://localhost:8000',
    });
    const g = geometria(presentacion);
    const arriba = g.y - g.alturaBarra;
    const abajo = arriba + g.alto + g.alturaBarra - 2;
    for (const [x, y] of [[g.x + 1, arriba + 1], [g.x + g.ancho - 2, arriba + 1],
        [g.x + 1, abajo], [g.x + g.ancho - 2, abajo]]) {
        assert.equal(pixel(png, x, y)[3], 255, `la esquina (${x},${y}) debe ser fondo opaco`);
    }
    // Y el centro sigue siendo el hueco transparente: no se tapó el video de paso.
    assert.equal(pixel(png, 480, 300)[3], 0);
});

test('sombra:false apaga de verdad la sombra', async () => {
    // El interruptor existía en la config y no lo leía nadie: el box-shadow vivía en el CSS.
    const dir = mkdtempSync(join(tmpdir(), 'demo-marco-sombra-'));
    mkdirSync(join(dir, 'a'));
    mkdirSync(join(dir, 'b'));
    const conSombra = await renderizarMarco({
        salida: join(dir, 'a'), presentacion, marca: { color: '#1e3a8a' }, baseURL: 'http://localhost:8000',
    });
    const sinSombra = await renderizarMarco({
        salida: join(dir, 'b'), presentacion: { ...presentacion, sombra: false },
        marca: { color: '#1e3a8a' }, baseURL: 'http://localhost:8000',
    });
    // Justo debajo de la ventana, donde cae la sombra proyectada.
    const g = geometria(presentacion);
    const y = (g.y - g.alturaBarra) + g.alto + g.alturaBarra + 10;
    assert.notDeepEqual(pixel(conSombra, 480, y), pixel(sinSombra, 480, y),
        'sin sombra el fondo bajo la ventana tiene que quedar más claro');
});
