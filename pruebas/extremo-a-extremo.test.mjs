import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { cargarConfig } from '../src/configurar.mjs';
import { prepararSesiones } from '../src/sesiones.mjs';
import { grabar } from '../src/grabador.mjs';
import { montar } from '../src/montaje.mjs';
import { crearVoz } from '../src/voz/index.mjs';
import { duracion, RUTA_FFMPEG } from '../src/ffmpeg.mjs';
import { geometriaLienzo } from '../src/lienzo.mjs';
import { declararEntornoDePruebas } from './entorno.mjs';

// El guardián de privacidad ya no infiere el entorno por la IP: hay que declararlo.
declararEntornoDePruebas();

test('del guion al mp4 con subtítulos, sin tocar Laravel', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const proyecto = mkdtempSync(join(tmpdir(), 'demo-e2e-'));
    mkdirSync(join(proyecto, 'guiones'));
    writeFileSync(join(proyecto, 'demo.config.mjs'), `export default {
        baseURL: '${juguete.url}',
        marca: { nombre: 'Juguete' },
        login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
        actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
        guiones: './guiones',
        salida: './salida',
        video: { ancho: 800, alto: 600, pausaMinima: 600 },
    };`);

    try {
        const config = await cargarConfig(proyecto);
        const sesiones = await prepararSesiones(config, { dirSesiones: join(proyecto, '.sesiones') });
        const voz = crearVoz({ motor: 'ninguno', respaldo: 'ninguno' });

        const guion = { id: 'recorrido', titulo: 'Recorrido', escenas: [
            // El panel del juguete lista tres personas ficticias: fixture declarada, no fuga.
            { id: 'panel', titulo: 'Panel', pasos: [{ actor: 'funcionario', narrar: 'Abre el panel.',
              variasPersonas: true,
              hacer: async (page) => { await page.goto('/panel'); } }] },
            { id: 'detalle', titulo: 'Detalle', pasos: [{ actor: 'funcionario', narrar: 'Ve el detalle.',
              hacer: async (page) => { await page.goto('/detalle/11111111-1'); } }] },
        ] };

        const { pistas, pasos } = await grabar(guion,
            { config, sesiones, salida: config.salida, voz });
        const { mp4, vtt } = await montar({ pistas, pasos, voz, video: config.video },
            { salida: config.salida, nombre: 'recorrido.mp4' });

        assert.ok(existsSync(mp4));
        assert.ok(duracion(mp4) > 1, 'el video no puede quedar vacío');
        assert.match(readFileSync(vtt, 'utf8'), /Abre el panel\./);
    } finally {
        await juguete.cerrar();
    }
});

// --- Curso multi-superficie, de punta a punta por el CLI ----------------------------------
//
// Es la prueba del cableado completo: configurar → grabar (dos actores, uno móvil sin
// sesión) → montar en lienzo (chip, dividir, clic) → tarjetas del curso → transición 3D →
// pegado. Cada pieza tiene su prueba aparte; esta existe porque las opciones se pierden en
// los pasos de una a otra, no dentro de ninguna.

const CLI = join(import.meta.dirname, '..', 'cli.mjs');
const CAMARA = pathToFileURL(join(import.meta.dirname, '..', 'src', 'camara.mjs')).href;

/** `spawn` y no `spawnSync`: el juguete corre en este proceso y necesita el bucle libre. */
function correrCli(cwd, args) {
    return new Promise((resolver) => {
        const hijo = spawn(process.execPath, [CLI, ...args], { cwd });
        let stdout = '';
        let stderr = '';
        hijo.stdout.on('data', (d) => { stdout += d; });
        hijo.stderr.on('data', (d) => { stderr += d; });
        hijo.on('close', (status) => resolver({ status, stdout, stderr }));
    });
}

/** Brillo medio (0-255) de un recuadro de `lado` px centrado en (x, y), en el segundo `seg`. */
function brilloMedio(mp4, seg, x, y, lado = 24) {
    const r = spawnSync(RUTA_FFMPEG, ['-ss', String(seg), '-i', mp4, '-frames:v', '1',
        '-vf', `crop=${lado}:${lado}:${Math.round(x - lado / 2)}:${Math.round(y - lado / 2)}:exact=1`,
        '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1e7 });
    const px = [...r.stdout];
    return px.reduce((s, v) => s + v, 0) / px.length;
}

/** Diferencia media por pixel (gris, 0-255) entre dos cuadros del mismo video. */
function diferencia(mp4, segA, segB) {
    const cuadro = (seg) => spawnSync(RUTA_FFMPEG, ['-ss', String(seg), '-i', mp4, '-frames:v', '1',
        '-vf', 'scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1e7 }).stdout;
    const a = cuadro(segA);
    const b = cuadro(segB);
    let suma = 0;
    for (let i = 0; i < a.length; i++) suma += Math.abs(a[i] - b[i]);
    return suma / a.length;
}

test('curso multi-superficie: mapa, teléfono, pantalla dividida, clic y transición 3D en lienzo', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const proyecto = mkdtempSync(join(tmpdir(), 'demo-e2e-multi-'));
    mkdirSync(join(proyecto, 'guiones'));
    writeFileSync(join(proyecto, 'demo.config.mjs'), `export default {
        baseURL: '${juguete.url}',
        marca: { nombre: 'Juguete' },
        login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
        superficies: {
            vecino: { nombre: 'App del vecino', tipo: 'telefono', color: '#9a3412', quien: 'Vecina' },
            sala: { nombre: 'Sala de operaciones', tipo: 'escritorio', color: '#1e3a8a', quien: 'Funcionario' },
        },
        flujo: [['vecino', 'sala']],
        actores: {
            funcionario: { email: 'f@x.cl', password: 'password', superficie: 'sala' },
            vecina: { sesion: false, dispositivo: 'Pixel 7', superficie: 'vecino' },
        },
        audio: { clic: { activo: true, volumen: 0.8 } },
        guiones: './guiones',
        salida: './salida',
        voz: { motor: 'ninguno', respaldo: 'ninguno' },
        video: { ancho: 800, alto: 600, pausaMinima: 1500, presentacion: {
            salida: { ancho: 960, alto: 540 }, mapaMs: 1500,
            transicion3d: { activa: true, ms: 400, gradosMax: 12 },
        } },
    };`);
    writeFileSync(join(proyecto, 'guiones', 'curso.mjs'), `export default {
        id: 'curso', titulo: 'Curso multi-superficie',
        capitulos: [
            { id: 'mapa', titulo: 'El mapa', tipo: 'mapa', ms: 2000 },
            { id: 'avisa', titulo: 'La vecina avisa', guion: 'avisa', superficie: 'vecino' },
            { id: 'sala', titulo: 'La sala lo recibe', guion: 'sala', superficie: 'sala' },
        ],
    };`);
    writeFileSync(join(proyecto, 'guiones', 'avisa.mjs'), `import { pulsar } from '${CAMARA}';
    export default { id: 'avisa', titulo: 'Avisa', escenas: [{ id: 'e', titulo: 'Avisa', pasos: [
        { actor: 'vecina', narrar: 'La vecina abre la app.',
          hacer: async (page) => { await page.goto('/'); await pulsar(page, 'input[name=usuario]'); } },
    ] }] };`);
    writeFileSync(join(proyecto, 'guiones', 'sala.mjs'), `export default {
        id: 'sala', titulo: 'Sala', escenas: [{ id: 'e', titulo: 'Sala', pasos: [
            { actor: 'vecina', narrar: 'La vecina envía.', hacer: async (page) => { await page.goto('/'); } },
            // El panel del juguete lista tres personas ficticias: fixture declarada, no fuga.
            { actor: 'funcionario', narrar: 'La sala lo ve entrar.', dividir: ['vecina', 'funcionario'],
              variasPersonas: true, hacer: async (page) => { await page.goto('/panel'); } },
        ] }] };`);

    try {
        const r = await correrCli(proyecto, ['curso']);
        assert.equal(r.status, 0, r.stderr);
        const mp4 = join(proyecto, 'salida', 'curso.mp4');
        assert.ok(existsSync(mp4));

        const info = spawnSync(RUTA_FFMPEG, ['-i', mp4], { encoding: 'utf8' }).stderr;
        assert.equal((info.match(/Chapter #0:\d+/g) ?? []).length, 3, 'el curso debe tener 3 capítulos');
        assert.match(info, /Audio: aac.*48000 Hz, stereo/);
        assert.match(info, /960x540/);

        const md = readFileSync(join(proyecto, 'salida', 'curso.md'), 'utf8');
        for (const t of ['El mapa', 'La vecina avisa', 'La sala lo recibe']) assert.match(md, new RegExp(t));

        // El clic suena: sin voz ni música, lo único audible del capítulo 2 es el clic.
        const vol = spawnSync(RUTA_FFMPEG, ['-i', join(proyecto, 'salida', 'avisa.mp4'), '-af', 'volumedetect',
            '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
        const max = Number(vol.match(/max_volume: (-?[\d.]+) dB/)?.[1] ?? -Infinity);
        assert.ok(max > -30, `el clic debería oírse en el capítulo, max_volume=${max} dB`);

        const capitulos = [...info.matchAll(/Chapter #0:\d+: start (\d+\.\d+), end (\d+\.\d+)/g)]
            .map((m) => ({ inicio: +m[1], fin: +m[2] }));
        // Tramo dividido: el final del capítulo 3. Cada hueco (teléfono a la izquierda, ventana
        // a la derecha) tiene que mostrar su página (fondo claro del juguete), no el fondo
        // oscuro del lienzo ni un panel negro.
        const huecos = geometriaLienzo({ lienzo: { ancho: 960, alto: 540 }, paneles: [
            { tipo: 'telefono', aspecto: 412 / 840, chip: {} },
            { tipo: 'ventana', aspecto: 800 / 600, chip: {} },
        ] });
        const tDividido = capitulos[2].fin - 0.6;
        for (const [i, h] of huecos.entries()) {
            const b = brilloMedio(mp4, tDividido, h.x + h.ancho / 2, h.y + h.alto / 4);
            assert.ok(b > 120, `el hueco ${i} del tramo dividido debería tener contenido, brillo medio ${b.toFixed(0)}`);
        }

        // Transición 3D en modo lienzo: el capítulo 3 empieza con el movimiento (0,4 s) y
        // después la tarjeta quieta (1,5 s). A mitad de la transición el cuadro no es todavía
        // la tarjeta asentada; si la transición no estuviera, serían el mismo cuadro.
        const d = diferencia(mp4, capitulos[2].inicio + 0.12, capitulos[2].inicio + 0.4 + 0.8);
        assert.ok(d > 3, `a mitad de la transición el cuadro debería moverse respecto de la tarjeta, difieren ${d.toFixed(1)}`);
        const quieta = diferencia(mp4, capitulos[2].inicio + 0.4 + 0.5, capitulos[2].inicio + 0.4 + 1.0);
        assert.ok(quieta < 1, `la tarjeta es una imagen fija, difieren ${quieta.toFixed(1)}`);
    } finally {
        await juguete.cerrar();
    }
});
