import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { grabar } from '../src/grabador.mjs';

import { ff, duracion, RUTA_FFMPEG as ffmpegPath } from '../src/ffmpeg.mjs';
import { pulsar } from '../src/camara.mjs';
import { declararEntornoDePruebas } from './entorno.mjs';

// El guardián de privacidad ya no infiere el entorno por la IP: hay que declararlo.
declararEntornoDePruebas();

// Voz de mentira que devuelve un .wav REAL de la duración pedida: así el grabador ejercita
// el mismo camino que en producción (sintetizar → medir → esperar), sin depender de que
// haya modelos de voz instalados en la máquina donde corren los tests.
function vozDe(segundos, dir) {
    const wav = join(dir, `voz-${segundos}s.wav`);
    ff(['-y', '-f', 'lavfi', '-t', String(segundos), '-i', 'anullsrc=r=22050:cl=mono', wav]);
    return { motor: 'falsa', disponible: () => true, sintetizar: () => wav };
}

function guionDePrueba(url) {
    return {
        id: 'prueba',
        escenas: [
            { id: 'panel', titulo: 'El funcionario abre el panel', pasos: [
                { actor: 'funcionario', narrar: 'Abre el panel de solicitudes.',
                  hacer: async (page) => { await page.goto(`${url}/panel`); } },
            ] },
            { id: 'detalle', titulo: 'Y entra al detalle', pasos: [
                { actor: 'funcionario', narrar: 'Entra al detalle.',
                  hacer: async (page) => { await page.goto(`${url}/detalle/11111111-1`); } },
            ] },
        ],
    };
}

test('graba una pista por actor y devuelve pasos con reloj local y global', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 300 },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const { pistas, pasos } = await grabar(guionDePrueba(juguete.url),
            { config, sesiones, salida, voz: vozDe(2, salida) });

        assert.ok(existsSync(pistas.funcionario), 'no se escribió la pista del funcionario');
        assert.equal(pasos.length, 2);
        // Tolerancia, no igualdad exacta: `tLocal` es un delta de reloj de pared, y basta un
        // hipo del planificador para que salga 1 ms aunque el código sea correcto. Medido: con
        // igualdad estricta la suite falla ~1 de cada 5 corridas bajo carga.
        assert.ok(pasos[0].tLocal < 50,
            `el primer paso debe arrancar pegado al cero de su reloj local, y arrancó en ${pasos[0].tLocal} ms`);
        assert.ok(pasos[1].tGlobal > pasos[0].tGlobal, 'el reloj global avanza');
        assert.ok(pasos.every((p) => p.duracionMs > 0), 'todo paso debe traer duración');
    } finally {
        await juguete.cerrar();
    }
});

test('hacer(page, contexto) recibe la marca de la config: un guion puede pintar su propia identidad', async () => {
    // Defecto real: portada()/cierre() necesitan config.marca (nombre, color, escudo) para no
    // salir con el azul por defecto del paquete, pero `hacer` solo recibía `page`. Sin un
    // segundo argumento, ningún guion podía alcanzar la marca del sistema que está grabando.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 200 },
            marca: { nombre: 'Sistema de Prueba', color: '#123456' },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        let marcaRecibida = null;
        const guion = {
            id: 'con-marca',
            escenas: [{ id: 'a', titulo: 'Portada', pasos: [{
                actor: 'funcionario',
                hacer: async (page, { config }) => {
                    marcaRecibida = config.marca;
                    await page.goto(`${juguete.url}/panel`);
                },
            }] }],
        };

        await grabar(guion, { config, sesiones, salida, voz: vozDe(1, salida) });

        assert.deepEqual(marcaRecibida, config.marca,
            'hacer() debe recibir { config } como segundo argumento, con la marca del sistema');
    } finally {
        await juguete.cerrar();
    }
});

test('un guion que declara hacer(page) a secas sigue funcionando sin cambios', async () => {
    // Compatibilidad hacia atrás: el segundo argumento es adicional, no reemplaza al primero.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 200 },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const guion = {
            id: 'sin-marca',
            escenas: [{ id: 'a', titulo: 'Panel', pasos: [{
                actor: 'funcionario',
                hacer: async (page) => { await page.goto(`${juguete.url}/panel`); },
            }] }],
        };

        const { pasos } = await grabar(guion, { config, sesiones, salida, voz: vozDe(1, salida) });
        assert.equal(pasos.length, 1);
    } finally {
        await juguete.cerrar();
    }
});

test('el paso dura al menos lo que la locución, no un tiempo fijo', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 300 },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const { pasos } = await grabar(guionDePrueba(juguete.url),
            { config, sesiones, salida, voz: vozDe(4, salida) });

        assert.ok(pasos[0].duracionMs >= 4000,
            `el paso duró ${pasos[0].duracionMs} ms y la locución 4000: la voz se cortaría`);
        assert.ok(pasos[0].wav, 'el paso debe llevar la ruta del wav para que el montaje lo reutilice');
    } finally {
        await juguete.cerrar();
    }
});

test('si un paso revienta, el error dice qué escena y qué paso fallaron, y la pista grabada hasta ahí queda bien cerrada', async () => {
    // Defecto real: un guion largo perdía TODA la grabación por un selector que cambió al
    // final, y el mensaje de error no decía dónde. Acá se verifica el diagnóstico Y que la
    // pista grabada hasta el fallo no quede a medio escribir (ffprobe debe poder leerla).
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 300 },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const guion = {
            id: 'con-fallo',
            escenas: [
                { id: 'panel', titulo: 'El funcionario abre el panel', pasos: [
                    { actor: 'funcionario', hacer: async (page) => { await page.goto(`${juguete.url}/panel`); } },
                ] },
                { id: 'detalle', titulo: 'Y entra al detalle', pasos: [
                    { actor: 'funcionario', hacer: async () => { throw new Error('el selector "#ya-no-existe" cambió'); } },
                ] },
            ],
        };

        await assert.rejects(
            () => grabar(guion, { config, sesiones, salida, voz: vozDe(1, salida) }),
            (error) => {
                assert.match(error.message, /detalle/, 'el error debe identificar la escena que falló');
                assert.match(error.message, /paso 1/, 'el error debe identificar qué paso falló');
                assert.match(error.message, /funcionario/, 'el error debe identificar el actor del paso');
                assert.match(error.message, /el selector "#ya-no-existe" cambió/, 'el error original no debe perderse');
                return true;
            },
        );

        const pistas = readdirSync(salida).filter((f) => f.startsWith('pista-') && f.endsWith('.mp4'));
        assert.equal(pistas.length, 1, 'la pista del primer paso, que sí corrió, debe haber quedado grabada');
        const seg = duracion(join(salida, pistas[0]));
        assert.ok(seg > 0, `la pista debe quedar bien cerrada y legible por ffprobe (duración: ${seg}s)`);
    } finally {
        await juguete.cerrar();
    }
});

// La protección por defecto: antes, `abrirFiltrado`/`abrirVerificado` eran OPT-IN — nada
// obligaba a un guion a llamarlas. Con `auditoria.patron` configurado, el grabador se niega a
// grabar un paso que deja más de un identificador a la vista, sin que el guion tenga que
// pedirlo. Ver src/privacidad.mjs (exigirUnaSolaPersona) y src/grabador.mjs.

const PATRON_RUT = '\\d{7,8}-[\\dkK]';

function configConAuditoria(juguete, extra = {}) {
    return {
        baseURL: juguete.url,
        login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
        actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
        video: { ancho: 800, alto: 600, pausaMinima: 200 },
        auditoria: { patron: PATRON_RUT },
        ...extra,
    };
}

test('un guion descuidado que abre un listado sin filtrar hace fallar la grabación (falla cerrado por defecto)', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = configConAuditoria(juguete);
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const guion = {
            id: 'descuidado',
            escenas: [{ id: 'panel', titulo: 'Panel sin filtrar', pasos: [{
                actor: 'funcionario',
                // Defecto real: abre el panel y NO llama a abrirFiltrado/abrirVerificado.
                // Las 3 personas de PERSONAS quedan a la vista en el mismo frame.
                hacer: async (page) => { await page.goto(`${juguete.url}/panel`); },
            }] }],
        };

        await assert.rejects(
            () => grabar(guion, { config, sesiones, salida, voz: vozDe(1, salida) }),
            (error) => {
                assert.match(error.message, /panel/, 'el error debe identificar la escena');
                assert.match(error.message, /paso 1/, 'el error debe identificar el paso');
                assert.match(error.message, /identificadores distintos/, 'el error debe decir qué encontró');
                return true;
            },
        );
    } finally {
        await juguete.cerrar();
    }
});

test('el mismo paso con paso.variasPersonas = true graba sin problema (excepción declarada a propósito)', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = configConAuditoria(juguete);
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const guion = {
            id: 'reporte-agregado',
            escenas: [{ id: 'panel', titulo: 'Panel agregado, mostrado a propósito', pasos: [{
                actor: 'funcionario',
                variasPersonas: true,
                hacer: async (page) => { await page.goto(`${juguete.url}/panel`); },
            }] }],
        };

        const { pasos } = await grabar(guion, { config, sesiones, salida, voz: vozDe(1, salida) });
        assert.equal(pasos.length, 1);
    } finally {
        await juguete.cerrar();
    }
});

test('un guion que usa abrirFiltrado correctamente no se ve afectado por la comprobación en vivo', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = configConAuditoria(juguete);
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });
        const { abrirFiltrado } = await import('../src/privacidad.mjs');

        const guion = {
            id: 'filtrado-correcto',
            escenas: [{ id: 'panel', titulo: 'Panel filtrado a una persona', pasos: [{
                actor: 'funcionario',
                hacer: async (page) => {
                    await abrirFiltrado(page, `${juguete.url}/panel`, {
                        filtro: '#filtro', valor: '11111111-1', selectorFilas: 'tr.fila',
                    });
                },
            }] }],
        };

        const { pasos } = await grabar(guion, { config, sesiones, salida, voz: vozDe(1, salida) });
        assert.equal(pasos.length, 1);
    } finally {
        await juguete.cerrar();
    }
});

test('sin auditoria.patron declarado, la comprobación en vivo no interfiere (compatibilidad hacia atrás)', async () => {
    // Los tests de arriba en este archivo ya cubren esto (ninguno declara `auditoria`), pero
    // se deja un caso explícito: un guion descuidado, sin patron configurado, sigue grabando
    // igual que en v1.0.x. Es la vía de apagado "patron sin declarar" del punto 4 del diseño.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = configConAuditoria(juguete, { auditoria: undefined });
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const guion = {
            id: 'sin-auditoria-configurada',
            escenas: [{ id: 'panel', titulo: 'Panel sin filtrar', pasos: [{
                actor: 'funcionario',
                hacer: async (page) => { await page.goto(`${juguete.url}/panel`); },
            }] }],
        };

        const { pasos } = await grabar(guion, { config, sesiones, salida, voz: vozDe(1, salida) });
        assert.equal(pasos.length, 1);
    } finally {
        await juguete.cerrar();
    }
});

test('la locución suena mientras el paso actúa: lo que tarda la acción se descuenta de la espera', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-solape-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 100 },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        // Un paso cuya ACCIÓN tarda casi tanto como su locución: antes el paso duraba
        // acción + locución entera (una pantalla muda y después una congelada hablando).
        const guion = {
            id: 'solape',
            titulo: 'Solape',
            escenas: [{
                id: 'unica',
                titulo: 'Única',
                pasos: [{
                    actor: 'funcionario',
                    narrar: 'Una locución de dos segundos.',
                    hacer: async (page) => { await page.waitForTimeout(1500); },
                }],
            }],
        };

        const t0 = Date.now();
        await grabar(guion, { config, sesiones, salida, voz: vozDe(2, salida) });
        const transcurrido = Date.now() - t0;

        // Con solape el paso dura ~2 s (la locución), no ~3,5 s (1,5 de acción + 2 de voz).
        // El margen es generoso a propósito: acá adentro hay un login y un arranque de
        // navegador reales, y lo que se afirma es que NO se suman los dos tiempos.
        assert.ok(transcurrido < 3400,
            `el paso debió durar lo que la locución, no la acción MÁS la locución (tardó ${transcurrido} ms)`);
    } finally {
        await juguete.cerrar();
        rmSync(salida, { recursive: true, force: true });
        rmSync(dirSesiones, { recursive: true, force: true });
    }
});

test('las locuciones se sintetizan ANTES de grabar, y una repetida se sintetiza una sola vez', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-presint-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 100 },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        // Voz de mentira que cuenta cuándo y cuántas veces la llaman.
        const base = vozDe(1, salida);
        let sintesis = 0;
        let sintesisAntesDeGrabar = 0;
        let grabando = false;
        const voz = {
            ...base,
            sintetizar: (texto) => {
                sintesis++;
                if (!grabando) sintesisAntesDeGrabar++;
                return base.sintetizar(texto);
            },
        };

        const guion = {
            id: 'presint',
            titulo: 'Presíntesis',
            escenas: [{
                id: 'unica',
                titulo: 'Única',
                pasos: [
                    { actor: 'funcionario', narrar: 'Frase que se repite.',
                      hacer: async (page) => { grabando = true; await page.waitForTimeout(50); } },
                    { actor: 'funcionario', narrar: 'Frase que se repite.',
                      hacer: async (page) => { await page.waitForTimeout(50); } },
                    { actor: 'funcionario', narrar: 'Otra frase distinta.',
                      hacer: async (page) => { await page.waitForTimeout(50); } },
                ],
            }],
        };

        await grabar(guion, { config, sesiones, salida, voz });

        // Dos textos distintos, no tres pasos: la repetida se cachea.
        assert.equal(sintesis, 2, `debió sintetizar 2 textos distintos y sintetizó ${sintesis}`);
        // Y las dos ocurrieron antes de que el primer paso empezara a actuar: si
        // se sintetizara dentro del bucle, el costo quedaría DENTRO del video.
        assert.equal(sintesisAntesDeGrabar, 2,
            'las locuciones deben sintetizarse antes de que la grabación empiece a correr');
    } finally {
        await juguete.cerrar();
        rmSync(salida, { recursive: true, force: true });
        rmSync(dirSesiones, { recursive: true, force: true });
    }
});

// --- Actores con dispositivo, sin sesión, pantalla dividida y clics ------------------------
//
// Todos estos usan actores `sesion: false`: no hace falta loguear para probar el contexto,
// el tamaño de la pista ni la pantalla dividida, y así cada test se ahorra el login.

function configMulti(url, actores) {
    return {
        baseURL: url,
        video: { ancho: 800, alto: 500, pausaMinima: 100, calidad: 80, fps: 25, msCursor: 50 },
        auditoria: { patron: 'x^', chequeoEnVivo: false },
        actores,
    };
}

const SIN_VOZ = { disponible: () => false };

test('actor con dispositivo graba a su tamaño y actor sin sesión no pide storageState', async () => {
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    try {
        const config = configMulti(url, { vecina: { sesion: false, dispositivo: 'Pixel 7' } });
        const guion = { id: 'm', escenas: [{ id: 'e', titulo: 'E', pasos: [
            { actor: 'vecina', hacer: async (page) => { await page.goto(`${url}/panel`); } }] }] };
        const r = await grabar(guion, { config, sesiones: {}, salida: dir, voz: SIN_VOZ });
        // Pixel 7: viewport CSS 412×839, redondeado a par → 412×840.
        assert.deepEqual(r.dimensiones.vecina, { ancho: 412, alto: 840 });
        assert.equal(r.origenes.vecina >= 0, true);
        const info = spawnSync(ffmpegPath, ['-i', r.pistas.vecina]).stderr.toString();
        assert.match(info, /412x840/);
    } finally { await cerrar(); rmSync(dir, { recursive: true, force: true }); }
});

test('la pista de un teléfono no se agranda: mide lo que su viewport CSS, redondeado a par', async () => {
    // El screencast de Chromium headless entrega frames en píxeles CSS (412×839 en un
    // Pixel 7) aunque el dispositivo tenga densidad 2,625. Pedir una pista más grande solo
    // hacía que ffmpeg estirara esos frames: más peso, cero nitidez real.
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    try {
        const { devices } = await import('playwright');
        const par = (n) => Math.round(n / 2) * 2;
        for (const dispositivo of ['Pixel 7', 'iPhone 13']) {
            const vp = devices[dispositivo].viewport;
            const config = configMulti(url, { tel: { sesion: false, dispositivo } });
            const guion = { id: 'm', escenas: [{ id: 'e', titulo: 'E', pasos: [
                { actor: 'tel', hacer: async (page) => { await page.goto(`${url}/`); } }] }] };
            const r = await grabar(guion, { config, sesiones: {}, salida: dir, voz: SIN_VOZ });
            const esperado = { ancho: par(vp.width), alto: par(vp.height) };
            assert.deepEqual(r.dimensiones.tel, esperado, dispositivo);
            const info = spawnSync(ffmpegPath, ['-i', r.pistas.tel]).stderr.toString();
            const [, w, h] = info.match(/, (\d+)x(\d+)/);
            assert.deepEqual({ ancho: Number(w), alto: Number(h) }, esperado,
                `${dispositivo}: la pista no debe ser más grande que el viewport del teléfono`);
        }
    } finally { await cerrar(); rmSync(dir, { recursive: true, force: true }); }
});

test('dividir abre el contexto del otro actor antes del paso y viaja en el paso', async () => {
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    try {
        const config = configMulti(url, { a: { sesion: false }, b: { sesion: false, dispositivo: 'Pixel 7' } });
        const guion = { id: 'm', escenas: [{ id: 'e', titulo: 'E', pasos: [
            { actor: 'b', hacer: async (page) => { await page.goto(`${url}/`); } },
            { actor: 'a', dividir: ['b', 'a'], hacer: async (page) => { await page.goto(`${url}/`); } },
        ] }] };
        const r = await grabar(guion, { config, sesiones: {}, salida: dir, voz: SIN_VOZ });
        assert.deepEqual(r.pasos[1].dividir, ['b', 'a']);
        assert.equal(r.pasos[0].dividir, null, 'antes de declararlo, el paso no va dividido');
        assert.ok(existsSync(r.pistas.b), 'la pista del otro actor tiene que existir');
        assert.ok(r.origenes.b <= r.pasos[1].tGlobal,
            'el otro actor tiene que estar grabando desde antes del tramo dividido');
    } finally { await cerrar(); rmSync(dir, { recursive: true, force: true }); }
});

test('dividir queda vigente hasta un paso con dividir:null y no cruza de escena', async () => {
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    try {
        const config = configMulti(url, { a: { sesion: false }, b: { sesion: false } });
        const ir = async (page) => { await page.goto(`${url}/`); };
        const guion = { id: 'm', escenas: [
            { id: 'e1', titulo: 'E1', pasos: [
                { actor: 'b', hacer: ir },
                { actor: 'a', dividir: ['a', 'b'], hacer: ir },
                { actor: 'b', hacer: ir },
                { actor: 'a', dividir: null, hacer: ir },
                { actor: 'a', dividir: ['a', 'b'], hacer: ir },
            ] },
            { id: 'e2', titulo: 'E2', pasos: [{ actor: 'a', hacer: ir }] },
        ] };
        const r = await grabar(guion, { config, sesiones: {}, salida: dir, voz: SIN_VOZ });
        assert.deepEqual(r.pasos.map((p) => p.dividir),
            [null, ['a', 'b'], ['a', 'b'], null, ['a', 'b'], null]);
    } finally { await cerrar(); rmSync(dir, { recursive: true, force: true }); }
});

test('Review Focus #2: dividir con un actor que no navegó avisa por stderr', async () => {
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    const avisos = [];
    const warnOriginal = console.warn;
    console.warn = (...args) => { avisos.push(args.join(' ')); };
    try {
        const config = configMulti(url, { a: { sesion: false }, b: { sesion: false } });
        const guion = { id: 'm', escenas: [{ id: 'e', titulo: 'E', pasos: [
            { actor: 'a', dividir: ['a', 'b'], hacer: async (page) => { await page.goto(`${url}/`); } },
        ] }] };
        await grabar(guion, { config, sesiones: {}, salida: dir, voz: SIN_VOZ });
        assert.ok(avisos.some((m) => /dividir: el actor "b"/.test(m)),
            `debió avisar que el panel de "b" sale en blanco; avisos: ${JSON.stringify(avisos)}`);
        assert.ok(!avisos.some((m) => /dividir: el actor "a"/.test(m)),
            'el actor del paso navega en su propio `hacer`: no hay que avisar por él');
    } finally {
        console.warn = warnOriginal;
        await cerrar(); rmSync(dir, { recursive: true, force: true });
    }
});

test('dividir inválido (un solo actor, o sin el actor del paso) falla con escena y paso', async () => {
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    try {
        const config = configMulti(url, { a: { sesion: false }, b: { sesion: false }, c: { sesion: false } });
        const ir = async (page) => { await page.goto(`${url}/`); };
        for (const dividir of [['a'], ['b', 'c'], ['a', 'a'], ['a', 'b', 'c'], 'b', false, '', 0]) {
            const guion = { id: 'm', escenas: [{ id: 'e', titulo: 'E', pasos: [{ actor: 'a', dividir, hacer: ir }] }] };
            await assert.rejects(
                () => grabar(guion, { config, sesiones: {}, salida: dir, voz: SIN_VOZ }),
                (error) => {
                    assert.match(error.message, /dividir/);
                    assert.match(error.message, /escena "e"/);
                    assert.match(error.message, /paso 1/);
                    return true;
                },
                `dividir ${JSON.stringify(dividir)} debió rechazarse`,
            );
        }
    } finally { await cerrar(); rmSync(dir, { recursive: true, force: true }); }
});

test('los clics hechos con pulsar() quedan en clics con tiempo global', async () => {
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    try {
        const config = configMulti(url, { a: { sesion: false } });
        // Sin sesión, el juguete muestra el login: su botón «Entrar» es el clic a registrar.
        const guion = { id: 'm', escenas: [{ id: 'e', titulo: 'E', pasos: [
            { actor: 'a', hacer: async (page) => { await page.goto(`${url}/`); await pulsar(page, '#entrar'); } },
        ] }] };
        const r = await grabar(guion, { config, sesiones: {}, salida: dir, voz: SIN_VOZ });
        assert.equal(r.clics.length, 1);
        assert.ok(r.clics[0] > 0, `el clic tiene que caer después del cero global (${r.clics[0]})`);
        assert.ok(r.clics[0] >= r.pasos[0].tGlobal && r.clics[0] <= r.pasos[0].tGlobal + r.pasos[0].duracionMs,
            'el clic cae dentro del paso que lo hizo, en el reloj global');
    } finally { await cerrar(); rmSync(dir, { recursive: true, force: true }); }
});

test('un actor con sesión que falta en sesiones sigue siendo un error', async () => {
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    try {
        const config = configMulti(url, { a: {} });
        const guion = { id: 'm', escenas: [{ id: 'e', titulo: 'E', pasos: [{ actor: 'a', hacer: async () => {} }] }] };
        await assert.rejects(() => grabar(guion, { config, sesiones: {}, salida: dir, voz: SIN_VOZ }),
            /no está en la config/);
    } finally { await cerrar(); rmSync(dir, { recursive: true, force: true }); }
});

test('la baseURL de un actor también pasa por el guardián de entorno', async () => {
    const { url, cerrar } = await iniciarJuguete();
    const dir = mkdtempSync(join(tmpdir(), 'grab-'));
    try {
        const config = configMulti(url, { a: { sesion: false, baseURL: 'https://www.graneros.cl' } });
        const guion = { id: 'm', escenas: [{ id: 'e', titulo: 'E', pasos: [{ actor: 'a', hacer: async () => {} }] }] };
        await assert.rejects(() => grabar(guion, { config, sesiones: {}, salida: dir, voz: SIN_VOZ }),
            /no es una dirección local/);
    } finally { await cerrar(); rmSync(dir, { recursive: true, force: true }); }
});

test('Ley 21.719: en un tramo dividido, la pantalla del OTRO actor también pasa por la auditoría', async () => {
    // El panel pasivo está a la vista en el video igual que el activo: si solo se auditara
    // la página del actor que actúa, el listado completo del otro saldría sin control.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = configConAuditoria(juguete, {
            actores: { funcionario: { email: 'f@x.cl', password: 'password' }, vecina: { sesion: false } },
        });
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const guionCon = (variasPersonas) => ({
            id: 'dividido',
            escenas: [{ id: 'traspaso', titulo: 'Traspaso', pasos: [
                // El funcionario deja abierto el listado completo (excepción declarada en SU paso).
                { actor: 'funcionario', variasPersonas: true,
                  hacer: async (page) => { await page.goto(`${juguete.url}/panel`); } },
                // La vecina actúa en una pantalla limpia, pero con el listado al lado.
                { actor: 'vecina', dividir: ['vecina', 'funcionario'], variasPersonas,
                  hacer: async (page) => { await page.goto(`${juguete.url}/`); } },
            ] }],
        });

        await assert.rejects(
            () => grabar(guionCon(false), { config, sesiones, salida, voz: vozDe(1, salida) }),
            (error) => {
                assert.match(error.message, /traspaso/);
                assert.match(error.message, /paso 2/);
                assert.match(error.message, /identificadores distintos/);
                return true;
            },
        );

        const { pasos } = await grabar(guionCon(true), { config, sesiones, salida, voz: vozDe(1, salida) });
        assert.equal(pasos.length, 2, 'con variasPersonas:true el tramo dividido graba');
    } finally {
        await juguete.cerrar();
        rmSync(salida, { recursive: true, force: true });
        rmSync(dirSesiones, { recursive: true, force: true });
    }
});
