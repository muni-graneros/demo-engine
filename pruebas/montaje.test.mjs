import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { montar, clicsEnVideo } from '../src/montaje.mjs';

/** Fabrica una pista de color sólido de N segundos, como sustituto de una grabación. */
function pista(dir, nombre, segundos, color) {
    const archivo = join(dir, nombre);
    ff(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x400:d=${segundos}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', archivo]);
    return archivo;
}

const vozMuda = { motor: 'ninguno', disponible: () => false, sintetizar: () => null };

test('intercala los tramos de dos actores en orden narrativo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = {
        ciudadano: pista(dir, 'ciudadano.mp4', 10, 'blue'),
        funcionario: pista(dir, 'funcionario.mp4', 8, 'red'),
    };
    const pasos = [
        { escena: 'entrega',  actor: 'ciudadano',   tLocal: 0,    tGlobal: 0,     duracionMs: 4000 },
        { escena: 'revision', actor: 'funcionario', tLocal: 0,    tGlobal: 4000,  duracionMs: 5000 },
        { escena: 'cierre',   actor: 'ciudadano',   tLocal: 4000, tGlobal: 9000,  duracionMs: 3000 },
    ];

    const { mp4, segmentos } = await montar(
        { pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' });

    assert.ok(existsSync(mp4));
    const total = duracion(mp4);
    assert.ok(Math.abs(total - 12) < 1, `el total debe rondar 4+5+3=12 s, midió ${total}`);
    assert.deepEqual(segmentos.map((s) => s.inicioSeg), [0, 4, 9]);
});

test('emite el .vtt junto al mp4', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 6, 'green') };
    const pasos = [
        { escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 3000, narrar: 'Primer paso.' },
        { escena: 'b', actor: 'uno', tLocal: 3000, tGlobal: 3000, duracionMs: 3000, narrar: 'Segundo paso.' },
    ];
    const { vtt } = await montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' });

    assert.ok(existsSync(vtt));
    const texto = readFileSync(vtt, 'utf8');
    assert.match(texto, /^WEBVTT/);
    assert.match(texto, /Segundo paso\./);
});

test('un paso que se sale del largo de su pista falla en vez de producir un corte vacío', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 3, 'black') };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 10000, tGlobal: 0, duracionMs: 2000 }];
    await assert.rejects(() => montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' }), /fuera de la pista/);
});

test('un desborde pequeño se recorta y los tiempos siguen calzando con el video', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { largo: pista(dir, 'largo.mp4', 10, 'blue'), corto: pista(dir, 'corto.mp4', 3, 'green') };
    // El segundo tramo empieza en 1 s y "dura" 2,1 s sobre una pista de 3 s: desborda 0,1 s,
    // que es lo que pasa de verdad al cerrar la grabación de un actor justo tras su paso.
    const pasos = [
        { escena: 'a', actor: 'largo', tLocal: 0, tGlobal: 0, duracionMs: 2000, narrar: 'Primero.' },
        { escena: 'b', actor: 'corto', tLocal: 1000, tGlobal: 2000, duracionMs: 2100, narrar: 'Segundo.' },
    ];
    const { mp4, segmentos } = await montar(
        { pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' });

    // Lo que prometen los subtítulos tiene que coincidir con lo que el video dura de verdad.
    const prometido = segmentos.at(-1).finSeg;
    assert.ok(Math.abs(prometido - duracion(mp4)) < 0.3,
        `los subtítulos prometen ${prometido}s y el video dura ${duracion(mp4)}s: quedarían desfasados`);
});

test('limpia los archivos intermedios de la carpeta de salida al terminar', async () => {
    // Igual que ya se hizo en pegarCapitulos: la carpeta de salida debe contener solo lo
    // que el usuario quiere ver, no los trozos y el .srt intermedios del montaje.
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 3, 'green') };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 2000, narrar: 'Hola.' }];

    await montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' });

    assert.ok(!existsSync(join(dir, '.tmp')), 'la carpeta temporal ".tmp" debe limpiarse tras montar');
    assert.deepEqual(readdirSync(dir).sort(), ['final.mp4', 'final.vtt', 'uno.mp4'].sort(),
        'la carpeta de salida solo debe tener lo que produce el montaje, sin intermedios');
});

test('reutiliza el wav que ya trae el segmento, sin sintetizarlo de nuevo en el montaje', async () => {
    // Defecto real (raíz del defecto #4 del brief): construirLineaDeTiempo no propagaba
    // paso.wav a los segmentos, así que seg.wav SIEMPRE llegaba undefined a montar() —
    // grabar() dejaba el .wav ya sintetizado en el paso, pero montar() lo ignoraba y volvía
    // a sintetizar TODAS las locuciones, no solo las perdidas. Esto duplicaba el paso más
    // caro del pipeline en cada corrida.
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 3, 'green') };
    const wavListo = join(dir, 'ya-sintetizado.wav');
    // Un tono, no silencio: loudnorm no puede normalizar silencio puro a un loudness
    // objetivo (exige una ganancia infinita) y el encoder AAC revienta con NaN — un
    // artefacto de fixture, no del código bajo prueba. Con señal real esto no pasa.
    ff(['-y', '-f', 'lavfi', '-t', '1', '-i', 'sine=frequency=440:sample_rate=22050', wavListo]);

    let llamadas = 0;
    const voz = { motor: 'contadora', disponible: () => true, sintetizar: () => { llamadas++; return null; } };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 2000, narrar: 'Hola.', wav: wavListo }];

    await montar({ pistas, pasos, voz, video: { ancho: 640, alto: 400 } }, { salida: dir, nombre: 'final.mp4' });

    assert.equal(llamadas, 0, 'no debe sintetizar de nuevo: el grabador ya dejó el wav listo en el paso');
});

test('no reintenta una locución que grabar() ya dio por perdida (wav: null)', async () => {
    // Defecto #4 del brief: grabar() ya intenta sintetizar cada narración y, si falla,
    // guarda wav: null Y avisa por stderr (ver src/voz/proceso.mjs). montar() no debe
    // reintentarla: reintentar acá solo produce un SEGUNDO aviso por la MISMA pérdida, sin
    // indicar que es el mismo fallo.
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 3, 'green') };

    let llamadas = 0;
    const voz = { motor: 'contadora', disponible: () => true, sintetizar: () => { llamadas++; return null; } };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 2000, narrar: 'Se perdió.', wav: null }];

    await montar({ pistas, pasos, voz, video: { ancho: 640, alto: 400 } }, { salida: dir, nombre: 'final.mp4' });

    assert.equal(llamadas, 0, 'no debe reintentar una narración que grabar() ya dio por perdida');
});

test('si el paso no trae wav en absoluto (uso directo de montar() sin pasar por grabar()), sí sintetiza', async () => {
    // Compatibilidad: alguien puede llamar a montar() con pasos armados a mano, sin haber
    // pasado por grabar() nunca. Ahí wav es `undefined` (nunca se intentó), no `null`
    // (se intentó y se perdió), y montar() sigue siendo el único que puede sintetizar.
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 3, 'green') };
    const wavReal = join(dir, 'sintetizado-en-montaje.wav');
    ff(['-y', '-f', 'lavfi', '-t', '1', '-i', 'sine=frequency=440:sample_rate=22050', wavReal]);

    let llamadas = 0;
    const voz = { motor: 'contadora', disponible: () => true, sintetizar: () => { llamadas++; return wavReal; } };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 2000, narrar: 'Nunca se intentó.' }];

    await montar({ pistas, pasos, voz, video: { ancho: 640, alto: 400 } }, { salida: dir, nombre: 'final.mp4' });

    assert.equal(llamadas, 1, 'sin wav previo (undefined) debe sintetizar: nadie lo había intentado todavía');
});

test('un desborde grande falla, en vez de recortar media escena en silencio', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 3, 'black') };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 1000, tGlobal: 0, duracionMs: 5000 }];
    await assert.rejects(() => montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'final.mp4' }), /desfasados/);
});

test('sin presentacion, el video conserva las dimensiones de grabación', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 4, 'blue') };
    const pasos = [{ escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 3000 }];

    const { mp4 } = await montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'sin.mp4' });

    const r = spawnSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8' });
    assert.match(r.stderr, /640x400/);
});

test('con presentacion, el video sale en las dimensiones de salida y dura lo mismo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 6, 'blue') };
    const pasos = [
        { escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 3000 },
        { escena: 'b', actor: 'uno', tLocal: 3000, tGlobal: 3000, duracionMs: 2000 },
    ];
    const presentacion = {
        fondo: null, padding: 40, radio: 16, sombra: true, barra: true,
        salida: { ancho: 960, alto: 540 },
        transicion3d: { activa: false, ms: 900, gradosMax: 12 },
    };

    const { mp4, segmentos } = await montar({
        pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 },
        presentacion, marca: { color: '#1e3a8a' }, baseURL: 'http://localhost:8000',
    }, { salida: dir, nombre: 'con.mp4' });

    const r = spawnSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8' });
    assert.match(r.stderr, /960x540/);
    // la presentación NO puede mover el reloj: los tiempos de los segmentos son los mismos
    assert.deepEqual(segmentos.map((s) => s.inicioSeg), [0, 3]);
    assert.ok(Math.abs(duracion(mp4) - 5) < 0.5, `duración ${duracion(mp4)}`);
});

// ---- Montaje en lienzo por superficie (multisuperficie) ------------------------------------

/** Pista sintética de cualquier tamaño y fuente lavfi (color sólido o testsrc). */
function pistaDe(dir, nombre, fuente) {
    const archivo = join(dir, nombre);
    ff(['-y', '-f', 'lavfi', '-i', fuente, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', archivo]);
    return archivo;
}

/** Un frame del mp4 como función (x, y) → [r, g, b]. */
function frameDe(mp4, ancho, alto, ss) {
    const r = spawnSync(RUTA_FFMPEG, ['-v', 'error', '-ss', String(ss), '-i', mp4, '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
    assert.equal(r.stdout.length, ancho * alto * 3);
    return (x, y) => { const i = (y * ancho + x) * 3; return [r.stdout[i], r.stdout[i + 1], r.stdout[i + 2]]; };
}

const SUPERFICIES = {
    app: { nombre: 'App vecinal', tipo: 'telefono', icono: 'phone', color: '#166534' },
    sala: { nombre: 'Sala de monitoreo', tipo: 'escritorio', icono: 'monitor', color: '#1e3a8a' },
};
const ACTORES = { vecina: { superficie: 'app', dispositivo: 'Pixel 7' }, operador: { superficie: 'sala' } };
const DIMENSIONES = { vecina: { ancho: 412, alto: 840 }, operador: { ancho: 1280, alto: 800 } };
const VIDEO = { ancho: 1280, alto: 800 };
/** Mismos paneles que arma montar() para esos actores, para saber dónde caen los huecos. */
const panel = (actor) => ({
    tipo: actor === 'vecina' ? 'telefono' : 'ventana',
    aspecto: DIMENSIONES[actor].ancho / DIMENSIONES[actor].alto,
    chip: { nombre: SUPERFICIES[ACTORES[actor].superficie].nombre, icono: SUPERFICIES[ACTORES[actor].superficie].icono, color: SUPERFICIES[ACTORES[actor].superficie].color },
    url: 'http://localhost:8000',
});

test('compatibilidad: sin superficies ni dividir ni audio, montar produce lo mismo que antes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 6, 'blue') };
    const pasos = [
        { escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 3000, dividir: null },
        { escena: 'b', actor: 'uno', tLocal: 3000, tGlobal: 3000, duracionMs: 2000, dividir: null },
    ];
    const { mp4 } = await montar({ pistas, pasos, voz: vozMuda, video: { ancho: 640, alto: 400 } },
        { salida: dir, nombre: 'compat.mp4' });

    const r = spawnSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8' });
    assert.match(r.stderr, /Video: h264.* 640x400/);
    // La cadena vieja: silencio mono (sin voz pasa directo a 44,1 kHz mono).
    assert.match(r.stderr, /Audio: aac.*44100 Hz, mono/);
    assert.ok(Math.abs(duracion(mp4) - 5) < 0.05, `duración ${duracion(mp4)}`);
});

test('con superficies: un actor teléfono sale en un lienzo de video.ancho x video.alto y con audio estéreo 48 kHz', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { vecina: pistaDe(dir, 'vecina.mp4', 'color=c=red:s=412x840:d=3') };
    const pasos = [{ escena: 'a', actor: 'vecina', tLocal: 0, tGlobal: 0, duracionMs: 2000, dividir: null }];

    const { mp4 } = await montar({
        pistas, pasos, voz: vozMuda, video: VIDEO, baseURL: 'http://localhost:8000',
        superficies: SUPERFICIES, actores: ACTORES, dimensiones: DIMENSIONES, origenes: { vecina: 0 },
        clics: [500], audio: { musica: null, clic: { activo: true, volumen: 0.5 } },
    }, { salida: dir, nombre: 'telefono.mp4' });

    const r = spawnSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8' });
    assert.match(r.stderr, /Video: h264.* 1280x800/);
    assert.match(r.stderr, /Audio: aac.*48000 Hz, stereo/);
    assert.ok(Math.abs(duracion(mp4) - 2) < 0.1, `duración ${duracion(mp4)}`);

    // El teléfono va en su hueco (rojo en el centro) y alrededor está el lienzo, no la pista
    // estirada: la esquina del lienzo no es roja.
    const { geometriaLienzo } = await import('../src/lienzo.mjs');
    const [h] = geometriaLienzo({ lienzo: VIDEO, paneles: [panel('vecina')] });
    const px = frameDe(mp4, VIDEO.ancho, VIDEO.alto, 1);
    const [r1, g1, b1] = px(h.x + h.ancho / 2, h.y + h.alto / 2);
    assert.ok(r1 > 180 && g1 < 80 && b1 < 80, `el hueco debía ser rojo y es ${[r1, g1, b1]}`);
    const [r2, g2, b2] = px(10, 10);
    assert.ok(!(r2 > 180 && g2 < 80 && b2 < 80), 'la esquina del lienzo salió roja: la pista no está en su hueco');
});

test('dividir: el tramo muestra las dos pistas y dura lo mismo que el segmento', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = {
        vecina: pistaDe(dir, 'vecina.mp4', 'color=c=red:s=412x840:d=3'),
        operador: pistaDe(dir, 'operador.mp4', 'color=c=blue:s=1280x800:d=3'),
    };
    const pasos = [
        { escena: 'a', actor: 'vecina', tLocal: 0, tGlobal: 0, duracionMs: 1000, dividir: null },
        { escena: 'b', actor: 'vecina', tLocal: 1000, tGlobal: 1000, duracionMs: 1500, dividir: ['vecina', 'operador'] },
    ];
    const { mp4, segmentos } = await montar({
        pistas, pasos, voz: vozMuda, video: VIDEO, baseURL: 'http://localhost:8000',
        superficies: SUPERFICIES, actores: ACTORES, dimensiones: DIMENSIONES,
        // El operador arrancó a grabar 0,5 s después: su tramo se toma desde 0,5 s de su pista.
        origenes: { vecina: 0, operador: 500 },
    }, { salida: dir, nombre: 'dividido.mp4' });

    assert.deepEqual(segmentos.map((s) => s.inicioSeg), [0, 1]);
    assert.ok(Math.abs(duracion(mp4) - 2.5) < 0.1, `duración ${duracion(mp4)}`);
    const { geometriaLienzo } = await import('../src/lienzo.mjs');
    const [a, b] = geometriaLienzo({ lienzo: VIDEO, paneles: [panel('vecina'), panel('operador')] });
    const px = frameDe(mp4, VIDEO.ancho, VIDEO.alto, 1.8);
    const [r1, g1, b1] = px(a.x + a.ancho / 2, a.y + a.alto / 2);
    const [r2, g2, b2] = px(b.x + b.ancho / 2, b.y + b.alto / 2);
    assert.ok(r1 > 180 && g1 < 80 && b1 < 80, `el teléfono debía ser rojo y es ${[r1, g1, b1]}`);
    assert.ok(b2 > 180 && r2 < 80 && g2 < 80, `la ventana debía ser azul y es ${[r2, g2, b2]}`);
});

test('dividir: si el otro actor empezó a grabar después del tramo, falla con un mensaje claro', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = {
        vecina: pistaDe(dir, 'vecina.mp4', 'color=c=red:s=412x840:d=3'),
        operador: pistaDe(dir, 'operador.mp4', 'color=c=blue:s=1280x800:d=3'),
    };
    const pasos = [{ escena: 'b', actor: 'vecina', tLocal: 0, tGlobal: 0, duracionMs: 1000, dividir: ['vecina', 'operador'] }];
    await assert.rejects(() => montar({
        pistas, pasos, voz: vozMuda, video: VIDEO, superficies: SUPERFICIES, actores: ACTORES,
        dimensiones: DIMENSIONES, origenes: { vecina: 0, operador: 800 },
    }, { salida: dir, nombre: 'x.mp4' }), /el actor operador empezó a grabar después del tramo dividido/);
});

test('clics traducidos al reloj del video: un clic en tGlobal cae dentro de su segmento', () => {
    const segmentos = [
        { tGlobal: 0, inicioSeg: 0, finSeg: 2 },
        { tGlobal: 5000, inicioSeg: 2, finSeg: 3 },
    ];
    // 3000 ms cae en el hueco entre segmentos (tiempo que el montaje no muestra) y 9000 ms
    // después del último: ambos se descartan.
    const t = clicsEnVideo(segmentos, [500, 5200, 3000, 9000, 0]);
    assert.equal(t.length, 3);
    assert.ok(Math.abs(t[0] - 0.5) < 1e-9 && Math.abs(t[1] - 2.2) < 1e-9 && t[2] === 0, JSON.stringify(t));
});

test('audio nuevo con voz, clics y subtítulos: la pista de subtítulos sale del índice contado, no supuesto', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = { uno: pista(dir, 'uno.mp4', 4, 'green') };
    const wav = join(dir, 'voz.wav');
    ff(['-y', '-f', 'lavfi', '-t', '1', '-i', 'sine=frequency=440:sample_rate=22050', wav]);
    const voz = { motor: 'fija', disponible: () => true, sintetizar: () => wav };
    const pasos = [
        { escena: 'a', actor: 'uno', tLocal: 0, tGlobal: 0, duracionMs: 1500, narrar: 'Uno.', wav },
        { escena: 'b', actor: 'uno', tLocal: 1500, tGlobal: 1500, duracionMs: 1500, narrar: 'Dos.', wav },
    ];
    const { mp4 } = await montar({
        pistas, pasos, voz, video: { ancho: 640, alto: 400 },
        clics: [200, 1700, 2000], audio: { musica: null, clic: { activo: true, volumen: 0.5 } },
    }, { salida: dir, nombre: 'audio.mp4' });

    const r = spawnSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8' });
    assert.match(r.stderr, /Video: h264.* 640x400/, 'sin superficies el video sigue por el camino de siempre');
    assert.match(r.stderr, /Audio: aac.*48000 Hz, stereo/);
    assert.match(r.stderr, /Subtitle: mov_text/);
    assert.ok(Math.abs(duracion(mp4) - 3) < 0.1, `duración ${duracion(mp4)}`);
});

test('dividir sin superficies declaradas también compone las dos pistas (sin chips)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-mon-'));
    const pistas = {
        vecina: pistaDe(dir, 'vecina.mp4', 'color=c=red:s=412x840:d=2'),
        operador: pistaDe(dir, 'operador.mp4', 'color=c=blue:s=1280x800:d=2'),
    };
    const pasos = [{ escena: 'b', actor: 'vecina', tLocal: 0, tGlobal: 0, duracionMs: 1000, dividir: ['vecina', 'operador'] }];
    const actores = { vecina: { dispositivo: 'Pixel 7' }, operador: {} };
    const { mp4 } = await montar({
        pistas, pasos, voz: vozMuda, video: VIDEO, actores, dimensiones: DIMENSIONES, origenes: { vecina: 0, operador: 0 },
    }, { salida: dir, nombre: 'sin-sup.mp4' });

    const { geometriaLienzo } = await import('../src/lienzo.mjs');
    const [a, b] = geometriaLienzo({ lienzo: VIDEO, paneles: [
        { tipo: 'telefono', aspecto: 412 / 840, chip: null }, { tipo: 'ventana', aspecto: 1.6, chip: null }] });
    const px = frameDe(mp4, VIDEO.ancho, VIDEO.alto, 0.5);
    const [r1, , b1] = px(a.x + a.ancho / 2, a.y + a.alto / 2);
    const [r2, , b2] = px(b.x + b.ancho / 2, b.y + b.alto / 2);
    assert.ok(r1 > 180 && b1 < 80 && b2 > 180 && r2 < 80, `teléfono ${[r1, b1]} / ventana ${[r2, b2]}`);
});
