/**
 * C4 (portadas y cierres a pantalla completa, sin marco de navegador) y C5 (pantalla
 * dividida legible, con foco en el actor que actúa y rótulo por mitad).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { cargarConfig, ErrorConfig } from '../src/configurar.mjs';
import { portada, cierre, esPlano } from '../src/rotulos.mjs';
import { construirLineaDeTiempo } from '../src/linea-tiempo.mjs';
import { componerPlano } from '../src/composicion.mjs';
import { montar, panelDeActor } from '../src/montaje.mjs';
import { geometriaLienzo } from '../src/lienzo.mjs';

const temporal = (t, prefijo = 'demo-c45-') => {
    const dir = mkdtempSync(join(tmpdir(), prefijo));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
};

function proyecto(t, config) {
    const dir = temporal(t, 'demo-cfg-');
    mkdirSync(join(dir, 'guiones'));
    writeFileSync(join(dir, 'demo.config.mjs'), `export default ${JSON.stringify(config)};`);
    return dir;
}
const minima = {
    baseURL: 'http://localhost:8031',
    marca: { nombre: 'Sistema' },
    actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
    guiones: './guiones',
    salida: './salida',
};

function pistaDe(dir, nombre, fuente) {
    const archivo = join(dir, nombre);
    ff(['-y', '-f', 'lavfi', '-i', fuente, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', archivo]);
    return archivo;
}
function frameDe(mp4, ancho, alto, ss) {
    const r = spawnSync(RUTA_FFMPEG, ['-v', 'error', '-ss', String(ss), '-i', mp4, '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.stdout.length, ancho * alto * 3, 'el frame no mide lo que el lienzo');
    return (x, y) => { const i = (y * ancho + x) * 3; return [r.stdout[i], r.stdout[i + 1], r.stdout[i + 2]]; };
}
const cerca = (a, b, tol = 14) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const vozMuda = { motor: 'ninguno', disponible: () => false, sintetizar: () => null };

// Portada sintética: fondo del color de marca (#355a63) con un bloque blanco al centro.
const PORTADA = 'color=c=0x355a63:s=640x400:d=3,drawbox=x=220:y=150:w=200:h=100:color=white:t=fill';
const PETROLEO = [0x35, 0x5a, 0x63];

// ---- Config ------------------------------------------------------------------------------

test('config: por defecto los rótulos van a pantalla completa y la división usa foco 0,72', async (t) => {
    const cfg = await cargarConfig(proyecto(t, minima));
    assert.equal(cfg.video.rotulos, 'plano');
    assert.deepEqual(cfg.video.dividida, { modo: 'foco', foco: 0.72 });
});

test('config: rotulos «marco» y dividida «igual» devuelven el aspecto de 1.14', async (t) => {
    const cfg = await cargarConfig(proyecto(t, { ...minima, video: { rotulos: 'marco', dividida: { modo: 'igual' } } }));
    assert.equal(cfg.video.rotulos, 'marco');
    assert.equal(cfg.video.dividida.modo, 'igual');
});

test('config: valores inválidos fallan al cargar, no a mitad del montaje', async (t) => {
    await assert.rejects(cargarConfig(proyecto(t, { ...minima, video: { rotulos: 'sin-marco' } })), ErrorConfig);
    await assert.rejects(cargarConfig(proyecto(t, { ...minima, video: { dividida: { modo: 'foco', foco: 1.2 } } })), /foco/);
    await assert.rejects(cargarConfig(proyecto(t, { ...minima, video: { dividida: { modo: 'mosaico' } } })), /modo/);
    await assert.rejects(cargarConfig(proyecto(t, { ...minima, actores: { f: { sesion: false, rotulo: 7 } } })), /rotulo/);
});

// ---- Rótulo de cada mitad ----------------------------------------------------------------

test('chip: en pantalla dividida suma el rótulo del actor a la superficie; solo, no', () => {
    const config = {
        superficies: { sala: { nombre: 'Sala de operaciones', tipo: 'escritorio', icono: 'monitor', color: '#1e3a8a' } },
        actores: { operador: { superficie: 'sala', rotulo: 'Camila · operadora' }, supervisor: { superficie: 'sala' } },
    };
    const base = { config, dimensiones: {}, video: { ancho: 1600, alto: 1000 }, presentacion: null, baseURL: 'http://x' };
    assert.equal(panelDeActor({ ...base, actor: 'operador', dividido: true }).chip.nombre, 'Sala de operaciones · Camila · operadora');
    assert.equal(panelDeActor({ ...base, actor: 'operador', dividido: false }).chip.nombre, 'Sala de operaciones');
    // Sin rótulo declarado, lo de siempre.
    assert.equal(panelDeActor({ ...base, actor: 'supervisor', dividido: true }).chip.nombre, 'Sala de operaciones');
});

test('chip: sin superficies, el rótulo del actor igual nombra su mitad en la pantalla dividida', () => {
    const config = { superficies: null, actores: { a: { rotulo: 'Ana · jefa' }, b: {} } };
    const base = { config, dimensiones: {}, video: { ancho: 1600, alto: 1000 }, presentacion: null, baseURL: 'http://x', marca: { color: '#355a63' } };
    const p = panelDeActor({ ...base, actor: 'a', dividido: true });
    assert.equal(p.chip.nombre, 'Ana · jefa');
    assert.equal(p.chip.color, '#355a63');
    assert.equal(panelDeActor({ ...base, actor: 'b', dividido: true }).chip, null);
});

// ---- C4: rótulos planos --------------------------------------------------------------------

test('portada y cierre marcan la página como plano; al navegar a otra, deja de serlo', async () => {
    const navegador = await chromium.launch();
    try {
        const page = await navegador.newPage();
        assert.equal(await esPlano(page), null);
        await portada(page, { titulo: 'T', marca: { color: '#355a63' }, esperaMs: 0 });
        assert.equal(await esPlano(page), 'portada');
        await cierre(page, { mensaje: 'Fin', marca: {}, esperaMs: 0 });
        assert.equal(await esPlano(page), 'cierre');
        await page.goto('data:text/html,<p>sistema</p>');
        assert.equal(await esPlano(page), null);
    } finally {
        await navegador.close();
    }
});

test('la línea de tiempo lleva el plano de cada paso (falso si no viene)', () => {
    const l = construirLineaDeTiempo([
        { escena: 'a', actor: 'x', tLocal: 0, tGlobal: 0, duracionMs: 1000, plano: 'portada' },
        { escena: 'b', actor: 'x', tLocal: 1000, tGlobal: 1000, duracionMs: 1000 },
    ]);
    assert.deepEqual(l.map((s) => s.plano), ['portada', null]);
});

test('componerPlano: la tarjeta llena el lienzo, sin marco, rellenando con su propio color', (t) => {
    const dir = temporal(t);
    const mp4 = pistaDe(dir, 'portada.mp4', PORTADA);
    const salida = componerPlano({ mp4, desdeSeg: 0.5, hastaSeg: 2 }, { lienzo: { ancho: 1920, alto: 1080 }, salida: join(dir, 'plano.mp4'), duracion: 1.5 });
    assert.ok(Math.abs(duracion(salida) - 1.5) < 0.1, `duración ${duracion(salida)}`);
    const px = frameDe(salida, 1920, 1080, 0.5);
    // Esquinas y bordes: el color de la tarjeta, no el negro de un pad ni el gradiente del marco.
    for (const [x, y] of [[4, 4], [1915, 4], [4, 1075], [1915, 1075], [960, 20], [60, 540]]) {
        assert.ok(cerca(px(x, y), PETROLEO), `(${x},${y}) = ${px(x, y)}`);
    }
    assert.ok(cerca(px(960, 540), [255, 255, 255], 20), `centro ${px(960, 540)}`);
    // Escalada a lo alto del lienzo: el bloque de 200×100 mide ~540×270.
    let ancho = 0;
    for (let x = 0; x < 1920; x++) if (cerca(px(x, 540), [255, 255, 255], 40)) ancho++;
    assert.ok(Math.abs(ancho - 540) < 12, `bloque de ${ancho} px`);
});

const SUPERFICIES = {
    sala: { nombre: 'Sala de operaciones', tipo: 'escritorio', icono: 'monitor', color: '#1e3a8a' },
};
const LIENZO = { ancho: 1920, alto: 1080 };
const PRESENTACION = { salida: LIENZO, url: 'https://seguridad.example.cl', padding: 80, radio: 16, sombra: true, barra: true };

test('montar con superficies: el paso de portada sale a pantalla completa y el resto con su marco', async (t) => {
    const dir = temporal(t);
    const pistas = { operador: pistaDe(dir, 'op.mp4', `${PORTADA.replace('d=3', 'd=4')}`) };
    const pasos = [
        { escena: 'portada', actor: 'operador', tLocal: 0, tGlobal: 0, duracionMs: 1500, plano: 'portada' },
        { escena: 'sala', actor: 'operador', tLocal: 1500, tGlobal: 1500, duracionMs: 1500, plano: null },
    ];
    const { mp4 } = await montar({
        pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 }, presentacion: PRESENTACION,
        // Marca de OTRO color que la tarjeta: el gradiente del marco arranca en marca.color, y
        // con el mismo color la esquina no distinguiría marco de tarjeta.
        marca: { color: '#7c2d12' }, superficies: SUPERFICIES, actores: { operador: { superficie: 'sala' } },
        dimensiones: { operador: { ancho: 640, alto: 400 } }, origenes: { operador: 0 },
    }, { salida: dir, nombre: 'curso.mp4' });

    const enPortada = frameDe(mp4, 1920, 1080, 0.7);
    // Donde el marco pone el chip y la barra de URL (arriba a la izquierda del panel) y el
    // borde del lienzo: en la portada tiene que verse la tarjeta, no el marco.
    for (const [x, y] of [[10, 10], [200, 90], [1900, 1070]]) {
        assert.ok(cerca(enPortada(x, y), PETROLEO), `portada (${x},${y}) = ${enPortada(x, y)}`);
    }
    const enSala = frameDe(mp4, 1920, 1080, 2.2);
    assert.ok(!cerca(enSala(10, 10), PETROLEO, 6), `la escena normal perdió su marco: ${enSala(10, 10)}`);
});

test('montar con presentación y sin superficies: la portada también sale sin la ventana del navegador', async (t) => {
    const dir = temporal(t);
    const pistas = { uno: pistaDe(dir, 'uno.mp4', PORTADA.replace('d=3', 'd=4')) };
    const pasos = [
        { escena: 'portada', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 1500, plano: 'portada' },
        { escena: 'b', actor: 'uno', tLocal: 1500, tGlobal: 1500, duracionMs: 1500, plano: null },
    ];
    const { mp4 } = await montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 },
        presentacion: PRESENTACION, marca: { color: '#1e3a8a' } }, { salida: dir, nombre: 'p.mp4' });
    assert.ok(Math.abs(duracion(mp4) - 3) < 0.15, `duración ${duracion(mp4)}`);
    const a = frameDe(mp4, 1920, 1080, 0.7);
    for (const [x, y] of [[10, 10], [200, 100]]) assert.ok(cerca(a(x, y), PETROLEO), `portada (${x},${y}) = ${a(x, y)}`);
    const b = frameDe(mp4, 1920, 1080, 2.2);
    assert.ok(!cerca(b(10, 10), PETROLEO, 6), `sin marco en el paso normal: ${b(10, 10)}`);
});

test('video.rotulos «marco»: la portada sigue dentro del marco, como en 1.14', async (t) => {
    const dir = temporal(t);
    const pistas = { operador: pistaDe(dir, 'op.mp4', PORTADA) };
    const pasos = [{ escena: 'portada', actor: 'operador', tLocal: 0, tGlobal: 0, duracionMs: 1500, plano: 'portada' }];
    const { mp4 } = await montar({
        pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400, rotulos: 'marco' }, presentacion: PRESENTACION,
        marca: { color: '#1e3a8a' }, superficies: SUPERFICIES, actores: { operador: { superficie: 'sala' } },
        dimensiones: { operador: { ancho: 640, alto: 400 } }, origenes: { operador: 0 },
    }, { salida: dir, nombre: 'm.mp4' });
    const px = frameDe(mp4, 1920, 1080, 0.7);
    assert.ok(!cerca(px(10, 10), PETROLEO, 6), `debía quedar el marco: ${px(10, 10)}`);
});

// ---- C5: montar con foco ------------------------------------------------------------------

test('montar dividido: la mitad del actor del paso es la grande, y cambia cuando actúa el otro', async (t) => {
    const dir = temporal(t);
    const pistas = {
        operador: pistaDe(dir, 'op.mp4', 'color=c=red:s=1600x1000:d=4'),
        supervisor: pistaDe(dir, 'sup.mp4', 'color=c=blue:s=1600x1000:d=4'),
    };
    const par = ['operador', 'supervisor'];
    const pasos = [
        { escena: 'a', actor: 'operador', tLocal: 0, tGlobal: 0, duracionMs: 1500, dividir: par },
        { escena: 'a', actor: 'supervisor', tLocal: 1500, tGlobal: 1500, duracionMs: 1500, dividir: par },
    ];
    const actores = { operador: { superficie: 'sala' }, supervisor: { superficie: 'sala' } };
    const dimensiones = { operador: { ancho: 1600, alto: 1000 }, supervisor: { ancho: 1600, alto: 1000 } };
    const { mp4 } = await montar({
        pistas, pasos, voz: vozMuda, video: { ancho: 1600, alto: 1000 }, presentacion: PRESENTACION,
        marca: { color: '#1e3a8a' }, superficies: SUPERFICIES, actores, dimensiones, origenes: { operador: 0, supervisor: 0 },
    }, { salida: dir, nombre: 'd.mp4' });

    // Con chip, como los arma montar(): el chip suma alto al panel y corre el hueco hacia abajo.
    const ventana = { tipo: 'ventana', aspecto: 1.6, chip: { nombre: 'Sala de operaciones' } };
    for (const [ss, activo] of [[0.7, 0], [2.2, 1]]) {
        const huecos = geometriaLienzo({ lienzo: LIENZO, paneles: [ventana, ventana], dividida: { modo: 'foco', foco: 0.72, activo } });
        const px = frameDe(mp4, 1920, 1080, ss);
        const [rojo, azul] = huecos;
        assert.ok(cerca(px(rojo.x + rojo.ancho / 2, rojo.y + rojo.alto / 2), [255, 0, 0], 40), `t=${ss} izquierda roja`);
        assert.ok(cerca(px(azul.x + azul.ancho / 2, azul.y + azul.alto / 2), [0, 0, 255], 40), `t=${ss} derecha azul`);
        assert.ok(huecos[activo].ancho > 2 * huecos[1 - activo].ancho, `t=${ss}: la activa es la grande`);
        // Justo afuera del borde de la activa ya no hay video: el tamaño es el calculado.
        const h = huecos[activo];
        const color = activo === 0 ? [255, 0, 0] : [0, 0, 255];
        assert.ok(cerca(px(h.x + 10, h.y + 10), color, 40), `t=${ss} esquina interna de la activa: ${px(h.x + 10, h.y + 10)} en ${JSON.stringify(h)}`);
    }
});

// ---- Grabador: de dónde sale `plano` ---------------------------------------------------------

test('grabar anota qué pasos terminaron en un rótulo plano; paso.marco lo fuerza en uno u otro sentido', async (t) => {
    const { iniciarJuguete } = await import('./juguete/servidor.mjs');
    const { declararEntornoDePruebas } = await import('./entorno.mjs');
    const { grabar } = await import('../src/grabador.mjs');
    const { prepararSesiones } = await import('../src/sesiones.mjs');
    declararEntornoDePruebas();
    const juguete = await iniciarJuguete({ puerto: 0 });
    t.after(() => juguete.cerrar());
    const salida = temporal(t, 'demo-grab-');
    const config = {
        baseURL: juguete.url,
        login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
        actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
        video: { ancho: 800, alto: 600, pausaMinima: 150 },
        marca: { nombre: 'Prueba', color: '#355a63' },
    };
    const sesiones = await prepararSesiones(config, { dirSesiones: temporal(t, 'demo-ses-') });
    const guion = { id: 'planos', escenas: [{ id: 'a', titulo: 'A', pasos: [
        { actor: 'funcionario', hacer: async (page, { config }) => portada(page, { titulo: 'Capítulo', marca: config.marca, esperaMs: 0 }) },
        { actor: 'funcionario', hacer: async (page) => { await page.goto(`${juguete.url}/panel`); } },
        { actor: 'funcionario', marco: false, hacer: async () => {} },
        { actor: 'funcionario', marco: true, hacer: async (page) => cierre(page, { mensaje: 'Fin', esperaMs: 0 }) },
    ] }] };
    const { pasos } = await grabar(guion, { config, sesiones, salida, voz: vozMuda });
    assert.deepEqual(pasos.map((p) => p.plano), ['portada', null, 'paso', null]);
});
