import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { cargarConfig } from '../src/configurar.mjs';
import { capitulosDe, buscarClip, vivo } from '../src/vivo/index.mjs';
import { exigirEntornoEnVivo, hostLocal } from '../src/vivo/guardian.mjs';
import { disposicionVentanas, ALTO_CROMO, ANCHO_MINIMO } from '../src/vivo/ventanas.mjs';
import { crearControl, ordenDeTecla, teclaDeTerminal } from '../src/vivo/control.mjs';
import { declararEntornoDePruebas } from './entorno.mjs';

// El guardián de privacidad ya no infiere el entorno por la IP: hay que declararlo.
declararEntornoDePruebas();

const DEV = { DEMO_ENTORNO: 'local' };

// --- Guardián -----------------------------------------------------------------------------

test('guardián en vivo: solo loopback, localhost y *.test, y además el entorno declarado', () => {
    const cfg = (baseURL, actores = {}) => ({ baseURL, actores });
    for (const url of ['http://127.0.0.1:8071', 'http://localhost:8071', 'http://seguridad.test', 'http://[::1]:8071']) {
        assert.doesNotThrow(() => exigirEntornoEnVivo(cfg(url), { env: DEV }), url);
    }
    // Una IP privada pasa el guardián de grabación, pero en la red municipal puede ser producción.
    assert.throws(() => exigirEntornoEnVivo(cfg('http://192.168.1.20:8071'), { env: DEV }), /no es local.*--permitir-host=192\.168\.1\.20/);
    assert.doesNotThrow(() => exigirEntornoEnVivo(cfg('http://192.168.1.20:8071'), { env: DEV, permitirHosts: ['192.168.1.20'] }));
    assert.doesNotThrow(() => exigirEntornoEnVivo({ ...cfg('http://10.0.0.5'), vivo: { permitirHosts: ['10.0.0.5'] } }, { env: DEV }));
    // Lo público no lo salva ni --permitir-host: lo niega el guardián de siempre.
    assert.throws(() => exigirEntornoEnVivo(cfg('https://seguridad.municipalidadgraneros.cl'), { env: DEV, permitirHosts: ['seguridad.municipalidadgraneros.cl'] }), /no es una dirección local/);
    // La baseURL de cada actor también.
    assert.throws(() => exigirEntornoEnVivo(cfg('http://127.0.0.1:1', { apk: { baseURL: 'http://10.1.1.1:8073' } }), { env: DEV }), /actores\.apk\.baseURL/);
    // Sin entorno declarado, nada.
    assert.throws(() => exigirEntornoEnVivo(cfg('http://127.0.0.1:1'), { env: {} }), /sin declarar/);
    // Y DEMO_FORZAR no es un escape en vivo.
    assert.throws(() => exigirEntornoEnVivo(cfg('http://127.0.0.1:1'), { env: { ...DEV, DEMO_FORZAR: '1' } }), /DEMO_FORZAR/);
    assert.equal(hostLocal('127.0.0.1.nip.io'), false, 'un dominio que empieza como loopback no es loopback');
});

// --- Ventanas -----------------------------------------------------------------------------

test('ventanas: un escritorio llena la pantalla, un teléfono va centrado a su tamaño', () => {
    const pantalla = { x: 0, y: 0, ancho: 1920, alto: 1080 };
    assert.deepEqual(disposicionVentanas({ pantalla, paneles: [{ nombre: 'op', tipo: 'escritorio' }] }),
        [{ nombre: 'op', left: 0, top: 0, width: 1920, height: 1080 }]);
    const [tel] = disposicionVentanas({ pantalla, paneles: [{ nombre: 'v', tipo: 'telefono', ancho: 412, alto: 840 }] });
    assert.equal(tel.width, ANCHO_MINIMO, 'Chromium no achica una ventana por debajo de su mínimo');
    assert.equal(tel.height, 840 + ALTO_CROMO);
    assert.equal(tel.left, (1920 - ANCHO_MINIMO) / 2);
    // En un proyector bajo, el teléfono se recorta al alto disponible.
    const [bajo] = disposicionVentanas({ pantalla: { x: 0, y: 0, ancho: 1280, alto: 720 }, paneles: [{ nombre: 'v', tipo: 'telefono', ancho: 412, alto: 840 }] });
    assert.equal(bajo.height, 720);
    assert.equal(bajo.top, 0);
});

test('ventanas: un tramo dividido pone las dos lado a lado en el orden de dividir, dentro de la pantalla', () => {
    const pantalla = { x: 1920, y: 0, ancho: 1920, alto: 1080 };   // el proyector como segundo monitor
    const [a, b] = disposicionVentanas({ pantalla, paneles: [
        { nombre: 'patrullero', tipo: 'telefono', ancho: 412, alto: 840 },
        { nombre: 'operador', tipo: 'escritorio' },
    ] });
    assert.equal(a.nombre, 'patrullero');
    assert.ok(a.left >= 1920 && a.left + a.width < b.left, 'el teléfono a la izquierda, sin montarse');
    assert.ok(b.left + b.width <= 1920 * 2, 'el escritorio no se sale del proyector');
    assert.equal(b.height, 1080);
    const [x, y] = disposicionVentanas({ pantalla: { x: 0, y: 0, ancho: 1920, alto: 1080 }, paneles: [
        { nombre: 'op', tipo: 'escritorio' }, { nombre: 'sup', tipo: 'escritorio' },
    ] });
    assert.equal(x.width, y.width, 'dos escritorios se reparten la pantalla por igual');
    assert.throws(() => disposicionVentanas({ pantalla, paneles: [] }), /1 o 2 paneles/);
});

// --- Control ------------------------------------------------------------------------------

test('teclas: las del clicker y las de la terminal dan la misma orden', () => {
    assert.deepEqual(ordenDeTecla('PageDown'), { tipo: 'siguiente' });
    assert.deepEqual(ordenDeTecla('ArrowRight'), { tipo: 'siguiente' });
    assert.deepEqual(ordenDeTecla(' '), { tipo: 'siguiente' });
    assert.deepEqual(ordenDeTecla('PageUp'), { tipo: 'reintentar' });
    assert.deepEqual(ordenDeTecla('b'), { tipo: 'negro' });
    assert.deepEqual(ordenDeTecla('.'), { tipo: 'negro' });
    assert.deepEqual(ordenDeTecla('P'), { tipo: 'pausa' });
    assert.deepEqual(ordenDeTecla('3'), { tipo: 'ir', valor: 2 });
    assert.equal(ordenDeTecla('z'), null);
    assert.equal(teclaDeTerminal(undefined, { name: 'pagedown' }), 'PageDown');
    assert.equal(teclaDeTerminal(' ', { name: 'space' }), ' ');
    assert.equal(teclaDeTerminal('s', { name: 's' }), 's');
});

test('control: pausa frena el avance, una interrupción durante un paso queda pendiente', async () => {
    const control = crearControl({ capitulos: [{ id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' }] });
    // Sin espera en curso, «siguiente» no hace nada (el paso está actuando).
    control.actualizar({ fase: 'actuando' });
    assert.equal((await control.orden({ tipo: 'siguiente' })).aceptada, false);
    // Una interrupción, en cambio, espera al próximo punto de espera.
    assert.equal((await control.orden({ tipo: 'ir', valor: 1 })).aceptada, false);
    assert.deepEqual(await control.esperar(['siguiente', 'ir']), { tipo: 'ir', valor: 1 });
    // Capítulo inexistente: rechazado.
    assert.equal((await control.orden({ tipo: 'ir', valor: 9 })).aceptada, false);

    const espera = control.esperar(['siguiente']);
    await control.orden({ tipo: 'pausa' });
    assert.equal(control.estado.pausado, true);
    assert.equal((await control.orden({ tipo: 'siguiente' })).aceptada, false, 'en pausa no se avanza');
    await control.orden({ tipo: 'pausa' });
    assert.equal((await control.orden({ tipo: 'siguiente' })).aceptada, true);
    assert.deepEqual(await espera, { tipo: 'siguiente', valor: undefined });
});

test('control: en automático avanza solo, y la pausa detiene el reloj', async () => {
    const control = crearControl({ auto: true });
    const t0 = Date.now();
    assert.equal((await control.esperar(['siguiente'], { msAuto: 60 })).auto, true);
    assert.ok(Date.now() - t0 >= 55);
    const espera = control.esperar(['siguiente'], { msAuto: 60 });
    await control.orden({ tipo: 'pausa' });
    let resuelta = false;
    espera.then(() => { resuelta = true; });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(resuelta, false, 'en pausa el automático no avanza');
    await control.orden({ tipo: 'pausa' });
    await espera;
});

function http(url, { method = 'GET', headers = {}, body = null } = {}) {
    return new Promise((resolver, rechazar) => {
        const req = request(url, { method, headers }, (res) => {
            let datos = '';
            res.on('data', (d) => { datos += d; });
            res.on('end', () => resolver({ status: res.statusCode, datos }));
        });
        req.on('error', rechazar);
        if (body) req.write(body);
        req.end();
    });
}

test('consola: sirve la página accesible en 127.0.0.1, rechaza Host ajeno y órdenes sin JSON', async () => {
    const control = crearControl({ capitulos: [{ id: '01', titulo: 'Uno' }] });
    const { url, cerrar } = await control.servir({ puerto: 0 });
    try {
        assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
        const pagina = await http(url);
        assert.equal(pagina.status, 200);
        assert.match(pagina.datos, /<html lang="es">/);
        for (const nombre of ['Siguiente paso', 'Pausa', 'Reintentar paso', 'Saltar paso', 'Reiniciar capítulo', 'Modo seguro', 'Pantalla negra', 'Ir al capítulo']) {
            assert.match(pagina.datos, new RegExp(`<button[^>]*>${nombre}`), `falta el botón «${nombre}»`);
        }
        assert.match(pagina.datos, /:focus-visible/);
        assert.match(pagina.datos, /"PageDown":"siguiente"/, 'las teclas se inyectan desde el motor');

        // DNS rebinding: una página ajena que resuelve a 127.0.0.1 manda su propio Host.
        const ajeno = await http(url, { headers: { host: 'atacante.example:80' } });
        assert.equal(ajeno.status, 403);
        const sinJson = await http(`${url}orden`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"tipo":"pausa"}' });
        assert.equal(sinJson.status, 415);
        const ok = await http(`${url}orden`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"tipo":"pausa"}' });
        assert.equal(JSON.parse(ok.datos).aceptada, true);
        assert.equal(JSON.parse((await http(`${url}estado`)).datos).pausado, true);
    } finally {
        await cerrar();
    }
});

test('buscarClip: final/<guion>/<guion>.mp4, luego <guion>.mp4, o la función de la config', () => {
    const salida = mkdtempSync(join(tmpdir(), 'vivo-clip-'));
    try {
        assert.equal(buscarClip({ salida }, 'c06').encontrado, null);
        writeFileSync(join(salida, 'c06.mp4'), '');
        assert.equal(buscarClip({ salida }, 'c06').encontrado, join(salida, 'c06.mp4'));
        mkdirSync(join(salida, 'final', 'c06'), { recursive: true });
        writeFileSync(join(salida, 'final', 'c06', 'c06.mp4'), '');
        assert.equal(buscarClip({ salida }, 'c06').encontrado, join(salida, 'final', 'c06', 'c06.mp4'));
        assert.deepEqual(buscarClip({ salida, vivo: { clips: (g) => `/otro/${g}.mp4` } }, 'c06').buscados, ['/otro/c06.mp4']);
    } finally { rmSync(salida, { recursive: true, force: true }); }
});

test('capitulosDe: un maestro da sus capítulos y un guion suelto es un capítulo con su escena', () => {
    const maestro = { default: { capitulos: [{ id: '01', guion: 'c01', escena: 'inicio' }] } };
    assert.deepEqual(capitulosDe(maestro, 'curso'), [{ id: '01', guion: 'c01', escena: 'inicio', titulo: '01' }]);
    const suelto = { default: { id: 'c06', titulo: 'Asignar', escenas: [] }, escena: 'inicio' };
    assert.deepEqual(capitulosDe(suelto, 'c06-asignar'), [{ id: 'c06', guion: 'c06-asignar', titulo: 'Asignar', escena: 'inicio' }]);
    assert.throws(() => capitulosDe({ default: {} }, 'x'), /no declara/);
});

// --- De punta a punta, headless, contra el juguete ----------------------------------------

/** Espera a que el estado de la consola cumpla `condicion` (lo empuja el motor por SSE). */
function esperarEstado(control, condicion, ms = 20000) {
    if (condicion(control.estado)) return Promise.resolve(control.estado);
    return new Promise((resolver, rechazar) => {
        const t = setTimeout(() => { quitar(); rechazar(new Error(`timeout; estado: ${JSON.stringify({ ...control.estado, capitulos: undefined })}`)); }, ms);
        const quitar = control.suscribir((foto, e) => {
            if (condicion(e)) { clearTimeout(t); quitar(); resolver(e); }
        });
    });
}

async function ordenHttp(url, orden) {
    const r = await http(`${url}orden`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(orden) });
    return JSON.parse(r.datos);
}

function proyectoVivo(juguete) {
    const proyecto = mkdtempSync(join(tmpdir(), 'demo-vivo-'));
    mkdirSync(join(proyecto, 'guiones'));
    writeFileSync(join(proyecto, 'demo.config.mjs'), `export default {
        baseURL: '${juguete.url}',
        marca: { nombre: 'Juguete en vivo' },
        login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
        superficies: {
            vecino: { nombre: 'App del vecino', tipo: 'telefono', color: '#9a3412' },
            sala: { nombre: 'Sala de operaciones', tipo: 'escritorio', color: '#1e3a8a' },
        },
        actores: {
            funcionario: { email: 'f@x.cl', password: 'password', superficie: 'sala' },
            vecina: { sesion: false, dispositivo: 'Pixel 7', superficie: 'vecino' },
        },
        auditoria: { patron: '(?<![\\\\d-])\\\\d{7,8}-[\\\\dkK](?![\\\\dkK])' },
        sembrar: ({ escena = 'sin-escena' } = {}) => 'echo ' + escena + ' >> sembrados.txt',
        guiones: './guiones',
        salida: './salida',
        video: { ancho: 800, alto: 600, pausaMinima: 50 },
    };`);
    writeFileSync(join(proyecto, 'guiones', 'curso.mjs'), `export default { id: 'curso', titulo: 'Curso', capitulos: [
        { id: 'A', guion: 'avisa', titulo: 'La vecina avisa', escena: 'uno' },
        { id: 'B', guion: 'recibe', titulo: 'La sala recibe' },
    ] };`);
    writeFileSync(join(proyecto, 'guiones', 'avisa.mjs'), `
        import { appendFileSync } from 'node:fs';
        export const escena = 'uno';
        export function limpiar() { appendFileSync('limpiezas.txt', 'avisa\\n'); }
        export default { id: 'avisa', titulo: 'Avisa', escenas: [{ id: 'e', titulo: 'Avisa', pasos: [
            { actor: 'funcionario', narrar: 'La sala mira el panel.', variasPersonas: true,
              hacer: async (page) => { await page.goto('/panel'); } },
            { actor: 'vecina', narrar: 'La vecina abre la app.', dividir: ['vecina', 'funcionario'], variasPersonas: true,
              hacer: async (page) => { await page.goto('/'); } },
        ] }] };`);
    writeFileSync(join(proyecto, 'guiones', 'recibe.mjs'), `
        import { appendFileSync } from 'node:fs';
        export const escena = 'dos';
        let intentos = 0;
        export function limpiar() { appendFileSync('limpiezas.txt', 'recibe\\n'); }
        export default { id: 'recibe', titulo: 'Recibe', escenas: [{ id: 'e', titulo: 'Recibe', pasos: [
            { actor: 'funcionario', narrar: 'Un paso frágil.', hacer: async (page) => {
                intentos++;
                if (intentos === 1) throw new Error('el selector no apareció');
                await page.goto('/detalle/11111111-1');
            } },
            { actor: 'funcionario', narrar: 'Un paso que se salta.', hacer: async () => { appendFileSync('no-debio-correr.txt', 'x'); } },
        ] }] };`);
    return proyecto;
}

test('demo en vivo headless: pasos a la orden, dividir con ventanas, fallo y reintento, saltar, reiniciar, modo seguro y limpieza', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const proyecto = proyectoVivo(juguete);
    const cwd = process.cwd();
    process.chdir(proyecto);   // sembrar y limpiar escriben relativo al proyecto, como en el CLI
    const clips = [];
    let control = null;
    let corrida = null;
    try {
        const config = await cargarConfig(proyecto);
        mkdirSync(join(config.salida, 'final', 'recibe'), { recursive: true });
        writeFileSync(join(config.salida, 'final', 'recibe', 'recibe.mp4'), '');
        const capitulos = capitulosDe(await import(join(proyecto, 'guiones', 'curso.mjs')), 'curso');

        let consola;
        const listo = new Promise((r) => { consola = r; });
        corrida = vivo({
            config, capitulos, headless: true, teclado: false, puerto: 0, ordenarVentanas: true,
            dirSesiones: join(proyecto, '.sesiones'),
            reproductor: (archivo) => { clips.push(archivo); return { detener: () => clips.push('detenido') }; },
            alListo: consola,
        });
        corrida.catch(() => {});
        const consolaLista = await listo;
        ({ control } = consolaLista);
        const { url, actores } = consolaLista;

        // Capítulo A, paso 1: el teleprompter muestra este paso y el siguiente, y nada actuó aún.
        let e = await esperarEstado(control, (s) => s.fase === 'esperando' && s.paso?.numero === 1);
        assert.equal(e.capitulos[e.capitulo].id, 'A');
        assert.equal(e.paso.narrar, 'La sala mira el panel.');
        assert.equal(e.siguiente.narrar, 'La vecina abre la app.');
        assert.equal(e.paso.superficie, 'Sala de operaciones');
        assert.equal(readFileSync('sembrados.txt', 'utf8'), 'uno\n', 'sembró con la escena del maestro');

        assert.equal((await ordenHttp(url, { tipo: 'siguiente' })).aceptada, true);
        e = await esperarEstado(control, (s) => s.fase === 'esperando' && s.paso?.numero === 2);
        assert.deepEqual(e.paso.dividir, ['vecina', 'funcionario']);
        assert.match(actores.get('funcionario').page.url(), /\/panel$/, 'el paso 1 actuó con la sesión del funcionario');

        // Pantalla dividida: las dos ventanas en su lugar, la del teléfono a la izquierda.
        const bounds = async (nombre) => {
            const d = actores.get(nombre);
            return (await d.cdp.send('Browser.getWindowBounds', { windowId: d.idVentana })).bounds;
        };
        const bv = await bounds('vecina');
        const bf = await bounds('funcionario');
        assert.equal(bv.windowState, 'normal');
        assert.ok(bv.left + bv.width <= bf.left, `teléfono a la izquierda del escritorio: ${JSON.stringify({ bv, bf })}`);

        // Pantalla negra: telón en las ventanas de los actores, y avanzar lo levanta.
        await ordenHttp(url, { tipo: 'negro' });
        assert.equal(await actores.get('funcionario').page.locator('#__telon_vivo').count(), 1);
        await ordenHttp(url, { tipo: 'siguiente' });
        e = await esperarEstado(control, (s) => s.fase === 'esperando' && s.paso === null && /terminado/.test(s.aviso ?? ''));
        assert.equal(e.negro, false);
        assert.equal(await actores.get('funcionario').page.locator('#__telon_vivo').count(), 0);
        assert.equal(readFileSync('limpiezas.txt', 'utf8'), 'avisa\n', 'limpiar() corre al terminar el capítulo');

        // Capítulo B: el primer paso falla, la ventana se tapa y se reintenta.
        await ordenHttp(url, { tipo: 'siguiente' });
        await esperarEstado(control, (s) => s.capitulos[s.capitulo]?.id === 'B' && s.fase === 'esperando' && s.paso?.numero === 1);
        assert.equal(readFileSync('sembrados.txt', 'utf8'), 'uno\ndos\n', 'sin escena en el maestro, la del guion');
        await ordenHttp(url, { tipo: 'siguiente' });
        e = await esperarEstado(control, (s) => s.fase === 'fallo');
        assert.match(e.error, /escena "e".*paso 1.*el selector no apareció/);
        assert.equal(await actores.get('funcionario').page.locator('#__cubridor').count(), 1, 'el panel queda tapado');
        assert.equal((await ordenHttp(url, { tipo: 'reintentar' })).aceptada, true);
        await esperarEstado(control, (s) => s.fase === 'esperando' && s.paso?.numero === 2);
        assert.match(actores.get('funcionario').page.url(), /\/detalle\/11111111-1$/);

        // Saltar: el paso no corre.
        await ordenHttp(url, { tipo: 'saltar' });
        await esperarEstado(control, (s) => /terminado/.test(s.aviso ?? ''));
        assert.equal(existsSync('no-debio-correr.txt'), false);

        // Reiniciar el capítulo: vuelve a sembrar y limpia antes.
        await ordenHttp(url, { tipo: 'reiniciar' });
        await esperarEstado(control, (s) => s.fase === 'esperando' && s.paso?.numero === 1);
        assert.equal(readFileSync('sembrados.txt', 'utf8'), 'uno\ndos\ndos\n');

        // Modo seguro: se abre el clip grabado del capítulo y, con siguiente, se sigue.
        await ordenHttp(url, { tipo: 'seguro' });
        e = await esperarEstado(control, (s) => s.fase === 'clip');
        assert.equal(e.clip, join(config.salida, 'final', 'recibe', 'recibe.mp4'));
        assert.deepEqual(clips, [e.clip]);
        await ordenHttp(url, { tipo: 'siguiente' });
        await esperarEstado(control, (s) => s.fase === 'fin');
        assert.equal(clips.at(-1), 'detenido', 'el reproductor se cierra al seguir');
        assert.equal(readFileSync('limpiezas.txt', 'utf8'), 'avisa\nrecibe\nrecibe\n', 'limpiar() corre al salir por cualquier camino');

        // Fin: ir a un capítulo vuelve a empezar desde ahí; salir termina.
        await ordenHttp(url, { tipo: 'salir' });
        await corrida;
        // La sesión del funcionario se preparó una sola vez para toda la demo.
        assert.ok(existsSync(join(proyecto, '.sesiones', 'funcionario.json')));
    } finally {
        // Si una aserción falló a mitad de camino, la demo sigue esperando órdenes: sin esto
        // el navegador y la consola quedan vivos y el proceso de pruebas no termina.
        if (control && control.estado.fase !== 'fin') await control.orden({ tipo: 'salir' });
        await corrida?.catch(() => {});
        process.chdir(cwd);
        await juguete.cerrar();
        rmSync(proyecto, { recursive: true, force: true });
    }
});

// --- Por el CLI ---------------------------------------------------------------------------

const CLI = join(import.meta.dirname, '..', 'cli.mjs');

function correrCli(cwd, args, env = {}) {
    return new Promise((resolver) => {
        const hijo = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, ...env } });
        let stdout = '';
        let stderr = '';
        hijo.stdout.on('data', (d) => { stdout += d; });
        hijo.stderr.on('data', (d) => { stderr += d; });
        hijo.on('close', (status) => resolver({ status, stdout, stderr }));
    });
}

test('demo vivo --headless --auto recorre el maestro de punta a punta y termina solo', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const proyecto = proyectoVivo(juguete);
    // Sin el paso frágil: en automático un fallo espera al presentador (no hay nadie en CI).
    writeFileSync(join(proyecto, 'guiones', 'recibe.mjs'), `export default { id: 'recibe', titulo: 'Recibe', escenas: [
        { id: 'e', titulo: 'E', pasos: [{ actor: 'funcionario', narrar: 'Detalle.', hacer: async (page) => { await page.goto('/detalle/11111111-1'); } }] },
    ] };`);
    try {
        const r = await correrCli(proyecto, ['vivo', '--headless', '--auto', '--puerto=0', '--sin-teclado']);
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /consola del presentador: http:\/\/127\.0\.0\.1:\d+\//);
        assert.equal(readFileSync(join(proyecto, 'sembrados.txt'), 'utf8'), 'uno\nsin-escena\n');

        const desde = await correrCli(proyecto, ['vivo', '--headless', '--auto', '--puerto=0', '--sin-teclado', '--capitulos=B']);
        assert.equal(desde.status, 0, desde.stderr);
    } finally {
        await juguete.cerrar();
        rmSync(proyecto, { recursive: true, force: true });
    }
});

test('demo vivo se niega contra un host que no es local, y con banderas desconocidas', async () => {
    const proyecto = mkdtempSync(join(tmpdir(), 'demo-vivo-host-'));
    mkdirSync(join(proyecto, 'guiones'));
    writeFileSync(join(proyecto, 'demo.config.mjs'), `export default {
        baseURL: 'http://192.168.50.10:8071', marca: { nombre: 'X' }, guiones: './guiones',
        actores: { a: { sesion: false } },
    };`);
    writeFileSync(join(proyecto, 'guiones', 'g.mjs'), `export default { id: 'g', escenas: [{ id: 'e', titulo: 'E', pasos: [{ actor: 'a', hacer: async () => {} }] }] };`);
    try {
        const r = await correrCli(proyecto, ['vivo', 'g', '--headless', '--auto', '--puerto=0', '--sin-teclado']);
        assert.notEqual(r.status, 0);
        assert.match(r.stderr, /no es local/);
        const b = await correrCli(proyecto, ['vivo', 'g', '--rapido']);
        assert.notEqual(b.status, 0);
        assert.match(b.stdout, /Bandera desconocida: --rapido/);
    } finally {
        rmSync(proyecto, { recursive: true, force: true });
    }
});

// --- Con ventanas de verdad (headed) ------------------------------------------------------

/**
 * Cómo abrir ventanas en esta máquina: el escritorio si hay DISPLAY/WAYLAND_DISPLAY, o un
 * Xvfb de 1920×1080 con `xvfb-run` (servidores, CI, el sandbox). Sin ninguno, la prueba se
 * salta diciendo por qué: `demo vivo` sin --headless necesita una pantalla.
 */
function lanzadorConPantalla() {
    if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return { programa: process.execPath, prefijo: [] };
    const xvfb = spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' });
    if (xvfb.status !== 0) return null;
    return { programa: xvfb.stdout.trim(), prefijo: ['-a', '-s', '-screen 0 1920x1080x24', process.execPath] };
}

test('demo vivo con ventanas reales (headed): Chromium visible, ventanas ordenadas en la pantalla y el maestro de punta a punta', async (t) => {
    const lanzador = lanzadorConPantalla();
    if (!lanzador) {
        t.skip('sin DISPLAY ni xvfb-run: no hay dónde abrir ventanas');
        return;
    }
    // Sondeo: ¿arranca aquí un Chromium con ventanas? Un sandbox que niega sockets unix
    // (bubblewrap) no deja levantar Xvfb ni el singleton de Chromium, y xvfb-run se queda
    // esperando 2 minutos. No es un defecto del motor: se informa y se salta.
    const sondeo = spawnSync(lanzador.programa, [...lanzador.prefijo, '--input-type=module', '-e',
        "const { chromium } = await import('playwright'); const b = await chromium.launch({ headless: false }); await b.close();"],
    { cwd: join(import.meta.dirname, '..'), timeout: 30000, encoding: 'utf8' });
    if (sondeo.status !== 0) {
        t.skip(`Chromium con ventanas no arranca en este entorno (${(sondeo.error?.code ?? sondeo.stderr.match(/socket\(\) failed[^\n]*|Missing X server[^\n]*/)?.[0] ?? 'sin motivo').toString().trim()}); correr fuera del sandbox`);
        return;
    }
    const juguete = await iniciarJuguete({ puerto: 0 });
    const proyecto = proyectoVivo(juguete);
    // Cada paso anota desde la página dónde quedó SU ventana y si el navegador es headless.
    const anotar = `async (page, nombre) => { const v = await page.evaluate(() => ({ x: screenX, y: screenY, ancho: outerWidth, alto: outerHeight, headless: /Headless/.test(navigator.userAgent) })); (await import('node:fs')).appendFileSync('ventanas.jsonl', JSON.stringify({ nombre, ...v }) + '\\n'); }`;
    writeFileSync(join(proyecto, 'guiones', 'avisa.mjs'), `
        const anotar = ${anotar};
        export const escena = 'uno';
        export default { id: 'avisa', titulo: 'Avisa', escenas: [{ id: 'e', titulo: 'Avisa', pasos: [
            { actor: 'funcionario', narrar: 'La sala mira el panel.', variasPersonas: true,
              hacer: async (page) => { await page.goto('/panel'); await page.waitForTimeout(300); await anotar(page, 'funcionario-solo'); } },
            { actor: 'vecina', narrar: 'La vecina abre la app.', dividir: ['vecina', 'funcionario'], variasPersonas: true,
              hacer: async (page) => { await page.goto('/'); await page.waitForTimeout(300); await anotar(page, 'vecina-dividida'); } },
        ] }] };`);
    writeFileSync(join(proyecto, 'guiones', 'recibe.mjs'), `export default { id: 'recibe', titulo: 'Recibe', escenas: [
        { id: 'e', titulo: 'E', pasos: [{ actor: 'funcionario', narrar: 'Detalle.', hacer: async (page) => { await page.goto('/detalle/11111111-1'); } }] },
    ] };`);
    try {
        const r = await new Promise((resolver) => {
            const hijo = spawn(lanzador.programa, [...lanzador.prefijo, CLI, 'vivo', '--auto', '--puerto=0', '--sin-teclado'],
                { cwd: proyecto, env: { ...process.env } });
            let stdout = '';
            let stderr = '';
            hijo.stdout.on('data', (d) => { stdout += d; });
            hijo.stderr.on('data', (d) => { stderr += d; });
            hijo.on('close', (status) => resolver({ status, stdout, stderr }));
        });
        assert.equal(r.status, 0, r.stderr);
        assert.doesNotMatch(r.stdout + r.stderr, /No pude ordenar/);
        assert.equal(readFileSync(join(proyecto, 'sembrados.txt'), 'utf8'), 'uno\nsin-escena\n');
        const ventanas = readFileSync(join(proyecto, 'ventanas.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        assert.deepEqual(ventanas.map((v) => v.nombre), ['funcionario-solo', 'vecina-dividida']);
        for (const v of ventanas) assert.equal(v.headless, false, `${v.nombre}: el navegador corrió headless`);
        const [solo, dividida] = ventanas;
        // Solo, el escritorio llena la pantalla (1920×1080 de vivo.pantalla por defecto).
        assert.ok(solo.ancho >= 1800 && solo.alto >= 1000, `escritorio solo: ${JSON.stringify(solo)}`);
        // En el tramo dividido la vecina (primera del par) va a la izquierda y no ocupa todo.
        assert.ok(dividida.x < 960 && dividida.ancho < 1920, `vecina en dividida: ${JSON.stringify(dividida)}`);
    } finally {
        await juguete.cerrar();
        rmSync(proyecto, { recursive: true, force: true });
    }
});
