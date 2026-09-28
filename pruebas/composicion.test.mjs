import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { renderizarLienzo } from '../src/lienzo.mjs';
import { componerEnLienzo, lienzoDe } from '../src/composicion.mjs';

const temporal = (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-comp-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
};

/** Primer frame (o el del instante `ss`) como RGB crudo, para buscar por píxeles en JS. */
function frame(mp4, ancho, alto, ss = 0) {
    const r = spawnSync(RUTA_FFMPEG, ['-v', 'error', '-ss', String(ss), '-i', mp4, '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.stdout.length, ancho * alto * 3, 'el frame no mide lo que el lienzo');
    return (x, y) => { const i = (y * ancho + x) * 3; return [r.stdout[i], r.stdout[i + 1], r.stdout[i + 2]]; };
}

const blanco = ([r, g, b]) => r > 200 && g > 200 && b > 200;

/** Largo del tramo blanco más largo en una fila (o columna) del frame. */
function tramoBlanco(px, fijo, desde, hasta, horizontal) {
    let mejor = 0, actual = 0;
    for (let v = desde; v < hasta; v++) {
        if (blanco(horizontal ? px(v, fijo) : px(fijo, v))) { actual++; mejor = Math.max(mejor, actual); } else actual = 0;
    }
    return mejor;
}

test('lienzoDe: con presentación, su salida; sin ella, el tamaño del video', () => {
    assert.deepEqual(lienzoDe({ presentacion: { salida: { ancho: 1920, alto: 1080 } }, video: { ancho: 1600, alto: 1000 } }), { ancho: 1920, alto: 1080 });
    assert.deepEqual(lienzoDe({ presentacion: null, video: { ancho: 1600, alto: 1000 } }), { ancho: 1600, alto: 1000 });
});

for (const [caso, aspecto] of [['mismo aspecto que la pista', 412 / 840], ['hueco más ancho que la pista', 9 / 16]]) {
    test(`componerEnLienzo pone la entrada en su hueco sin deformar (Review Focus #3, ${caso})`, async (t) => {
        const dir = temporal(t);
        // Un cuadrado blanco de 200×200 sobre negro, en una pista del tamaño de un Pixel 7
        // (412×840: el grabador redondea a par, y yuv420p no admite un alto impar).
        const mp4 = join(dir, 'telefono.mp4');
        ff(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=412x840:d=1',
            '-vf', 'drawbox=x=106:y=320:w=200:h=200:color=white:t=fill',
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]);
        // Lienzo de 1280×720: el hueco queda más chico que la pista, así que hay escalado real.
        const lienzo = { ancho: 1280, alto: 720 };
        const { png, huecos } = await renderizarLienzo({ lienzo, paneles: [{ tipo: 'telefono', aspecto }], marca: null, salida: dir });
        const salida = componerEnLienzo([{ mp4, desdeSeg: 0, hastaSeg: 1 }], { png, huecos, lienzo, salida: join(dir, 'compuesto.mp4'), duracion: 1 });

        assert.ok(Math.abs(duracion(salida) - 1) < 0.1, `duración ${duracion(salida)}`);
        const px = frame(salida, lienzo.ancho, lienzo.alto);
        const [h] = huecos;
        const cx = h.x + Math.floor(h.ancho / 2), cy = h.y + Math.floor(h.alto / 2);
        const ancho = tramoBlanco(px, cy, h.x, h.x + h.ancho, true);
        const alto = tramoBlanco(px, cx, h.y, h.y + h.alto, false);
        assert.ok(ancho > 40 && alto > 40, `no se encontró el cuadrado (ancho ${ancho}, alto ${alto})`);
        assert.ok(Math.abs(ancho / alto - 1) < 0.03, `el cuadrado salió de ${ancho}×${alto}: la pista se deformó`);
    });
}

test('dos entradas: cada hueco muestra su propia pista', async (t) => {
    const dir = temporal(t);
    const rojo = join(dir, 'rojo.mp4'), azul = join(dir, 'azul.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=412x840:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', rojo]);
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x800:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', azul]);
    const lienzo = { ancho: 1280, alto: 720 };
    const paneles = [{ tipo: 'telefono', aspecto: 412 / 840 }, { tipo: 'ventana', aspecto: 1.6 }];
    const { png, huecos } = await renderizarLienzo({ lienzo, paneles, marca: null, salida: dir });
    const salida = componerEnLienzo(
        [{ mp4: rojo, desdeSeg: 0.5, hastaSeg: 1.5 }, { mp4: azul, desdeSeg: 1, hastaSeg: 2 }],
        { png, huecos, lienzo, salida: join(dir, 'dividido.mp4'), duracion: 1 });

    assert.ok(Math.abs(duracion(salida) - 1) < 0.1, `duración ${duracion(salida)}`);
    const px = frame(salida, lienzo.ancho, lienzo.alto, 0.5);
    const centro = (h) => px(h.x + Math.floor(h.ancho / 2), h.y + Math.floor(h.alto / 2));
    const [r1, g1, b1] = centro(huecos[0]);
    const [r2, g2, b2] = centro(huecos[1]);
    assert.ok(r1 > 180 && g1 < 80 && b1 < 80, `el hueco del teléfono debía ser rojo y es ${[r1, g1, b1]}`);
    assert.ok(b2 > 180 && r2 < 80 && g2 < 80, `el hueco de la ventana debía ser azul y es ${[r2, g2, b2]}`);
});

test('una entrada que se acaba antes congela su último cuadro sin acortar el tramo', async (t) => {
    // El otro actor de un tramo dividido se recorta a su pista (tolerancia de 0,25 s). Si ese
    // recorte acortara el compuesto, el reloj del video se correría respecto de los subtítulos.
    const dir = temporal(t);
    const largo = join(dir, 'largo.mp4'), corto = join(dir, 'corto.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=412x840:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', largo]);
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x800:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', corto]);
    const lienzo = { ancho: 1280, alto: 720 };
    const paneles = [{ tipo: 'telefono', aspecto: 412 / 840 }, { tipo: 'ventana', aspecto: 1.6 }];
    const { png, huecos } = await renderizarLienzo({ lienzo, paneles, marca: null, salida: dir });
    const salida = componerEnLienzo(
        [{ mp4: largo, desdeSeg: 0, hastaSeg: 2 }, { mp4: corto, desdeSeg: 0.2, hastaSeg: 1 }],
        { png, huecos, lienzo, salida: join(dir, 'dividido.mp4'), duracion: 2 });
    assert.ok(Math.abs(duracion(salida) - 2) < 0.1, `duración ${duracion(salida)}: el tramo se acortó`);
});

test('la duración es la explícita, aunque la PRIMERA entrada venga recortada', async (t) => {
    // Con dividir ['vecina','operador'] y el paso del operador, la entrada 0 es la vecina: si
    // su pista se recortó, el largo no puede salir de ella sino del segmento.
    const dir = temporal(t);
    const corto = join(dir, 'corto.mp4'), largo = join(dir, 'largo.mp4');
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=red:s=412x840:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', corto]);
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1280x800:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', largo]);
    const lienzo = { ancho: 1280, alto: 720 };
    const paneles = [{ tipo: 'telefono', aspecto: 412 / 840 }, { tipo: 'ventana', aspecto: 1.6 }];
    const { png, huecos } = await renderizarLienzo({ lienzo, paneles, marca: null, salida: dir });
    const salida = componerEnLienzo(
        [{ mp4: corto, desdeSeg: 0.2, hastaSeg: 1 }, { mp4: largo, desdeSeg: 0, hastaSeg: 2 }],
        { png, huecos, lienzo, salida: join(dir, 'dividido.mp4'), duracion: 2 });
    assert.ok(Math.abs(duracion(salida) - 2) < 0.1, `duración ${duracion(salida)}: manda la primera entrada, no el segmento`);
});

test('sin duración explícita, componerEnLienzo falla en vez de adivinarla', () => {
    assert.throws(() => componerEnLienzo([{ mp4: 'x.mp4', desdeSeg: 0, hastaSeg: 1 }],
        { png: 'x.png', huecos: [{ x: 0, y: 0, ancho: 2, alto: 2 }], lienzo: { ancho: 4, alto: 4 }, salida: 'y.mp4' }), /duracion/);
});
