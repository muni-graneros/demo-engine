import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ff, duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { montar } from '../src/montaje.mjs';

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
