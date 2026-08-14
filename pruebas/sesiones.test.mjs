import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { prepararSesiones, prepararSesionesParaGuion, actoresDeGuion, totp } from '../src/sesiones.mjs';

test('genera el TOTP de referencia del RFC 6238', () => {
    // Secreto oficial del RFC 6238 (Apéndice B): "12345678901234567890" (20 bytes ASCII)
    // codificado en base32 completo. OJO: el brief trae este literal truncado a los
    // primeros 16 caracteres ("GEZDGNBVGY3TQOJQ"), que en base32 estándar solo decodifica
    // a los 10 bytes "1234567890" y NO reproduce el vector oficial (da 263420, no 287082).
    // Verificado por ida y vuelta: codificar "12345678901234567890" en base32 da
    // "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" (32 caracteres); con ese literal completo la
    // implementación del brief sí da el 287082 exigido por el vector oficial.
    const codigo = totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59);
    assert.equal(codigo, '287082');
});

test('entra por la segunda pantalla cuando el sistema pide el código', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]',
                     enviar: '#entrar', codigo: 'input[name=code]' },
            // El usuario "conmfa" del juguete manda a una segunda pantalla.
            actores: { profesional: { email: 'conmfa', password: 'password', totp: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' } },
        };
        const sesiones = await prepararSesiones(config, { dirSesiones: dir });
        const guardado = JSON.parse(readFileSync(sesiones.profesional, 'utf8'));
        assert.ok(guardado.cookies.some((c) => c.name === 'sesion'),
            'sin la cookie de sesión, la segunda pantalla no se superó');
    } finally {
        await juguete.cerrar();
    }
});

test('deja un storageState por actor', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: {
                funcionario: { email: 'f@x.cl', password: 'password' },
                director: { email: 'd@x.cl', password: 'password' },
            },
        };
        const sesiones = await prepararSesiones(config, { dirSesiones: dir });
        assert.deepEqual(Object.keys(sesiones).sort(), ['director', 'funcionario']);
        assert.ok(existsSync(sesiones.funcionario));
    } finally {
        await juguete.cerrar();
    }
});

test('pasa por el guardián de entorno antes de loguear: con host público no escribe ninguna sesión', async () => {
    // Defecto #3: prepararSesiones navegaba, logueaba y ESCRIBÍA cookies de sesión a disco
    // sin pasar nunca por exigirEntornoDeDesarrollo. Con una baseURL pública, ni siquiera
    // debe llegar a abrir el navegador ni tocar el disco de sesiones.
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    const config = {
        baseURL: 'https://ejemplo.cl',
        login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
        actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
    };
    await assert.rejects(() => prepararSesiones(config, { dirSesiones: dir }), /no es una dirección local/);
    assert.deepEqual(readdirSync(dir), [], 'no debe quedar ningún archivo de sesión en disco');
});

test('si el login no deja sesión, falla nombrando al actor', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]',
                     enviar: '#entrar', comprobar: '#no-existe-jamas' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
        };
        await assert.rejects(() => prepararSesiones(config, { dirSesiones: dir }), /funcionario/);
    } finally {
        await juguete.cerrar();
    }
});

test('sin "comprobar", igual detecta un login que en realidad falló (sin cookie, vuelve al login)', async () => {
    // Defecto real: sin `login.comprobar`, prepararSesiones daba por bueno CUALQUIER
    // resultado, incluida una página que seguía en el formulario de login. El actor
    // "malacontra" hace que el juguete responda como un login inválido de verdad: vuelve a
    // "/" (la URL de login) sin dejar cookie de sesión.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'malacontra', password: 'password' } },
        };
        await assert.rejects(() => prepararSesiones(config, { dirSesiones: dir }), /funcionario/);
        assert.deepEqual(readdirSync(dir), [], 'un login fallido no debe dejar sesión guardada en disco');
    } finally {
        await juguete.cerrar();
    }
});

test('cada actor puede traer su propio login, fusionado sobre el global', async () => {
    // El sistema real tiene DOS superficies de autenticación (/admin/login para el panel,
    // /login para el ciudadano). Un solo bloque `login` global obliga a elegir una y deja a
    // los actores de la otra sin forma de entrar. Aquí el actor "ciudadano" solo pisa `url`
    // (entra por /portal) y hereda los selectores del login global.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: {
                funcionario: { email: 'f@x.cl', password: 'password' },
                ciudadano: { email: 'c@x.cl', password: 'password', login: { url: '/portal' } },
            },
        };
        const sesiones = await prepararSesiones(config, { dirSesiones: dir });

        const guardadoCiudadano = JSON.parse(readFileSync(sesiones.ciudadano, 'utf8'));
        assert.ok(guardadoCiudadano.cookies.some((c) => c.value === 'portalciudadano'),
            'el actor con login propio debió entrar por /portal, no por el login global');

        const guardadoFuncionario = JSON.parse(readFileSync(sesiones.funcionario, 'utf8'));
        assert.ok(guardadoFuncionario.cookies.some((c) => c.value === 'funcionario'),
            'el actor sin login propio debe seguir entrando por el login global');
    } finally {
        await juguete.cerrar();
    }
});

test('actoresDeGuion recorre escenas y pasos y deduce qué actores usa el guion', () => {
    const guion = {
        id: 'panel',
        escenas: [
            { id: 'a', pasos: [{ actor: 'funcionario', hacer: async () => {} }] },
            { id: 'b', pasos: [
                { actor: 'funcionario', hacer: async () => {} },
                { actor: 'director', hacer: async () => {} },
            ] },
        ],
    };
    assert.deepEqual(actoresDeGuion(guion).sort(), ['director', 'funcionario']);
});

test('prepararSesionesParaGuion solo prepara los actores que el guion usa, no todos los de la config', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: {
                funcionario: { email: 'f@x.cl', password: 'password' },
                director: { email: 'd@x.cl', password: 'password' },
            },
        };
        const guion = { id: 'panel', escenas: [
            { id: 'a', pasos: [{ actor: 'funcionario', hacer: async () => {} }] },
        ] };

        const sesiones = await prepararSesionesParaGuion(guion, config, { dirSesiones: dir });

        assert.deepEqual(Object.keys(sesiones), ['funcionario'],
            'no debe preparar al actor "director", que el guion no usa');
        assert.deepEqual(readdirSync(dir), ['funcionario.json'],
            'no debe quedar en disco sesión de un actor que el guion no usa');
    } finally {
        await juguete.cerrar();
    }
});

test('prepararSesionesParaGuion no reutiliza una sesión que caducó del lado del servidor: relogueá de forma transparente', async () => {
    // Defecto real: se reutilizaba el storageState por el solo hecho de que el archivo
    // existiera en disco, sin comprobar que la sesión siguiera sirviendo. Si caducó entre una
    // grabación y la siguiente, el fallo aparecía a mitad de la grabación siguiente, confuso,
    // en vez de acá, claro, y resuelto solo con un nuevo login.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
        };
        const guion = { id: 'panel', escenas: [
            { id: 'a', pasos: [{ actor: 'funcionario', hacer: async () => {} }] },
        ] };

        const primera = await prepararSesionesParaGuion(guion, config, { dirSesiones: dir });
        const epocaAntes = JSON.parse(readFileSync(primera.funcionario, 'utf8'))
            .cookies.find((c) => c.name === 'epoca').value;

        await juguete.expirar();

        const segunda = await prepararSesionesParaGuion(guion, config, { dirSesiones: dir });
        const guardado = JSON.parse(readFileSync(segunda.funcionario, 'utf8'));
        const epocaDespues = guardado.cookies.find((c) => c.name === 'epoca')?.value;
        assert.ok(guardado.cookies.some((c) => c.name === 'sesion'),
            'debió volver a loguear al mismo actor, dejando una sesión nueva con cookie de sesión');
        assert.notEqual(epocaDespues, epocaAntes,
            'la sesión guardada sigue siendo la vieja (caducada): no se relogueó de verdad');
    } finally {
        await juguete.cerrar();
    }
});

test('prepararSesionesParaGuion reutiliza el storageState que ya está en disco, no vuelve a loguear', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
        };
        const guion = { id: 'panel', escenas: [
            { id: 'a', pasos: [{ actor: 'funcionario', hacer: async () => {} }] },
        ] };

        const primera = await prepararSesionesParaGuion(guion, config, { dirSesiones: dir });
        const mtimeAntes = statSync(primera.funcionario).mtimeMs;

        await new Promise((listo) => setTimeout(listo, 20));

        const segunda = await prepararSesionesParaGuion(guion, config, { dirSesiones: dir });
        const mtimeDespues = statSync(segunda.funcionario).mtimeMs;

        assert.equal(mtimeDespues, mtimeAntes,
            'la sesión se reescribió en disco: no se reutilizó la que ya estaba, se volvió a loguear');
    } finally {
        await juguete.cerrar();
    }
});
