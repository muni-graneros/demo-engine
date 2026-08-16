import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { grabar } from '../src/grabador.mjs';

import { ff, duracion } from '../src/ffmpeg.mjs';

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
