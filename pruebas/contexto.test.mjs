import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { prepararSesiones } from '../src/sesiones.mjs';
import { capturarContexto } from '../src/contexto.mjs';
import { declararEntornoDePruebas } from './entorno.mjs';

// El guardián de privacidad ya no infiere el entorno por la IP: hay que declararlo.
declararEntornoDePruebas();

test('pasa por el guardián de entorno antes de abrir el navegador', async () => {
    // El hueco que fija este test: `capturarContexto` navegaba a `config.baseURL` con las
    // sesiones reales de los actores y dejaba los screenshots en disco sin pasar nunca por
    // `exigirEntornoDeDesarrollo`. Es la misma familia que ya se cerró en `prepararSesiones`
    // (commit 6d4dfec) y en `sesionSigueViva`, y acá duele igual o más: el pack de contexto
    // es justamente una captura de pantalla POR PANTALLA del sistema, sesión iniciada, y
    // queda en archivos PNG que después viajan a un generador de manuales.
    //
    // Las sesiones se preparan con el entorno declarado (que es lo que hace la suite) y
    // recién después se quita la declaración: eso reproduce el caso real, el de las sesiones
    // ya cacheadas en `.sesiones/` de una corrida anterior, donde nada vuelve a loguear y
    // por lo tanto nada volvía a pasar por el guardián.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-ctx-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    const declarado = process.env.DEMO_ENTORNO;
    const appEnv = process.env.APP_ENV;
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar', comprobar: null },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600 },
            contexto: { salida, pantallas: [{ id: 'panel', url: '/panel', actor: 'funcionario' }] },
        };
        const sesiones = await prepararSesiones(config, { dirSesiones });

        delete process.env.DEMO_ENTORNO;
        delete process.env.APP_ENV;
        await assert.rejects(() => capturarContexto({ config, sesiones, salida }), /sin declarar/);
        assert.ok(!existsSync(join(salida, 'pantallas', 'panel.png')),
            'no debe quedar ninguna captura del sistema en disco');
        assert.ok(!existsSync(join(salida, 'pantallas.json')),
            'ni el manifiesto: el guardián corta antes de tocar el disco');
    } finally {
        if (declarado === undefined) delete process.env.DEMO_ENTORNO; else process.env.DEMO_ENTORNO = declarado;
        if (appEnv === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = appEnv;
        await juguete.cerrar();
    }
});

test('captura el pack: público + con sesión + interacción, y anota las que fallan', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-ctx-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar', comprobar: null },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600 },
            contexto: {
                salida,
                pantallas: [
                    { id: 'publico', url: '/', actor: null },                    // sin sesión
                    { id: 'con-sesion', url: '/panel', actor: 'funcionario' },    // usa la sesión del actor
                    { id: 'con-interaccion', actor: null, hacer: async (page) => { await page.goto(`${juguete.url}/`); } },
                    { id: 'falla', url: '/', actor: null, esperaTexto: 'EstoNoExisteEnLaPagina', esperaMs: 0 }, // → falla y se anota
                ],
            },
        };

        const sesiones = await prepararSesiones(config, { dirSesiones });
        const { ok, fail, manifest } = await capturarContexto({ config, sesiones, salida });

        assert.equal(ok, 3, 'tres pantallas deben capturarse');
        assert.equal(fail, 1, 'la pantalla con esperaTexto inexistente debe fallar');
        assert.ok(existsSync(join(salida, 'pantallas', 'publico.png')));
        assert.ok(existsSync(join(salida, 'pantallas', 'con-sesion.png')));
        assert.ok(existsSync(join(salida, 'pantallas', 'con-interaccion.png')));
        assert.ok(!existsSync(join(salida, 'pantallas', 'falla.png')), 'la que falla no deja PNG');

        // El manifiesto anota lo capturado y el error de la que falló.
        assert.ok(existsSync(join(salida, 'pantallas.json')));
        const mani = JSON.parse(readFileSync(join(salida, 'pantallas.json'), 'utf8'));
        assert.equal(mani.ok, 3);
        assert.equal(mani.fail, 1);
        assert.ok(mani.pantallas.find((p) => p.id === 'falla')?.error, 'la fallida trae su mensaje de error');
        assert.equal(mani.pantallas.find((p) => p.id === 'con-sesion')?.actor, 'funcionario');
    } finally {
        await juguete.cerrar();
    }
});

test('un actor sin sesión abre su contexto sin storageState y con su dispositivo', async () => {
    // Antes, `paginaDe` tiraba "no hay sesión suya" para cualquier actor ausente de
    // `sesiones`, incluso para los declarados `sesion: false` (la app del vecino, un APK),
    // que por diseño no tienen sesión que guardar.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-ctx-'));
    try {
        let ancho = null;
        const config = {
            baseURL: juguete.url,
            actores: { vecina: { sesion: false, dispositivo: 'Pixel 7' } },
            video: { ancho: 800, alto: 600 },
            contexto: { salida, pantallas: [{ id: 'movil', url: '/', actor: 'vecina', esperaMs: 0,
                hacer: async (page) => { ancho = page.viewportSize().width; } }] },
        };
        const { ok, fail, manifest } = await capturarContexto({ config, sesiones: { vecina: null }, salida });
        assert.equal(fail, 0, `no debió fallar: ${JSON.stringify(manifest)}`);
        assert.equal(ok, 1);
        assert.equal(ancho, 412, 'la pantalla del actor móvil se captura con el viewport del Pixel 7');
    } finally {
        await juguete.cerrar();
    }
});

test('un actor CON sesión que falta en sesiones sigue fallando la pantalla', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-ctx-'));
    try {
        const config = {
            baseURL: juguete.url,
            actores: { funcionario: {} },
            video: { ancho: 800, alto: 600 },
            contexto: { salida, pantallas: [{ id: 'p', url: '/', actor: 'funcionario', esperaMs: 0 }] },
        };
        const { fail, manifest } = await capturarContexto({ config, sesiones: {}, salida });
        assert.equal(fail, 1);
        assert.match(manifest[0].error, /funcionario/);
    } finally {
        await juguete.cerrar();
    }
});

// D96: el motor lanzaba `chromium.launch()` sin argumentos y el consumidor no podía pasar
// `--host-resolver-rules` (para que el APK y «Enlace generado» muestren el dominio real y no
// localhost). Ahora `navegador.args` de la config llega a cada lanzamiento que toca el sistema.
test('navegador.args llega al Chromium: un dominio mapeado con --host-resolver-rules resuelve al servidor local', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const puerto = new URL(juguete.url).port;
    const dominio = `http://seguridad.graneros.test:${puerto}/`;
    const pantallas = [{ id: 'dominio', hacer: async (page) => { await page.goto(dominio, { timeout: 8000 }); } }];
    const proxies = {};
    try {
        const base = { baseURL: juguete.url, actores: {}, video: { ancho: 800, alto: 600 } };
        // Sin proxy en este test: con HTTP(S)_PROXY en el entorno (un sandbox, una red
        // corporativa) Chromium le pasa el nombre al proxy, que lo resuelve él y devuelve su
        // propia página (407), así que el dominio «resolvía» sin la regla y con la regla nunca
        // llegaba al juguete. Medido: `--no-proxy-server` solo NO alcanza mientras las variables
        // sigan en el entorno que hereda Chromium; hay que sacarlas mientras corre el test. La
        // limitación es real y está en docs/CONFIGURACION.md (navegador.args).
        const sinProxy = '--no-proxy-server';
        for (const k of Object.keys(process.env)) {
            if (/^(https?|all|no)_proxy$/i.test(k)) { proxies[k] = process.env[k]; delete process.env[k]; }
        }
        const sin = mkdtempSync(join(tmpdir(), 'demo-ctx-'));
        const r1 = await capturarContexto({ config: { ...base, navegador: { args: [sinProxy] }, contexto: { salida: sin, pantallas } }, sesiones: {}, salida: sin });
        assert.equal(r1.fail, 1, 'sin la regla, el dominio no debería resolver (si resuelve, el test no prueba nada)');

        const con = mkdtempSync(join(tmpdir(), 'demo-ctx-'));
        const navegador = { args: [sinProxy, `--host-resolver-rules=MAP seguridad.graneros.test 127.0.0.1`] };
        const r2 = await capturarContexto({ config: { ...base, navegador, contexto: { salida: con, pantallas } }, sesiones: {}, salida: con });
        assert.equal(r2.ok, 1, JSON.stringify(r2.manifest));
    } finally {
        Object.assign(process.env, proxies);
        await juguete.cerrar();
    }
});

test('todos los lanzamientos de Chromium que tocan el sistema grabado pasan por opcionesDeLanzamiento', async () => {
    const { readFileSync } = await import('node:fs');
    for (const archivo of ['grabador.mjs', 'contexto.mjs', 'sesiones.mjs']) {
        const fuente = readFileSync(new URL(`../src/${archivo}`, import.meta.url), 'utf8');
        const lanzamientos = fuente.match(/chromium\.launch\([^)]*\)/g) ?? [];
        assert.ok(lanzamientos.length > 0, archivo);
        for (const l of lanzamientos) assert.match(l, /opcionesDeLanzamiento\(config\)/, `${archivo}: ${l}`);
    }
});
