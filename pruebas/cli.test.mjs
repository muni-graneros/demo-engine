import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarJuguete } from './juguete/servidor.mjs';

// cli.mjs es el punto de entrada de todo el motor y hasta ahora solo se había verificado a
// mano. No hace falta una suite exhaustiva (cada comando ya tiene su lógica de fondo probada
// en detalle en los otros archivos de pruebas): alcanza con ejercitar, contra el sistema de
// juguete, los caminos que de verdad importan del propio cli.mjs.

const CLI = join(import.meta.dirname, '..', 'cli.mjs');

/**
 * Corre `demo <orden> [argumento]` como lo haría un usuario real, contra `cwd`.
 *
 * A propósito NO usa `spawnSync`: el sistema de juguete corre EN ESTE MISMO proceso (Node,
 * un solo hilo), y `spawnSync` bloquea su bucle de eventos hasta que el hijo termina. Con el
 * bucle bloqueado, el juguete no puede responder ni una sola petición HTTP del cli.mjs hijo,
 * y todo termina en timeout de navegación. `spawn` (asíncrono) deja el bucle libre para que
 * el juguete siga atendiendo mientras el hijo corre.
 */
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

function proyectoDeJuguete(juguete) {
    const proyecto = mkdtempSync(join(tmpdir(), 'demo-cli-'));
    mkdirSync(join(proyecto, 'guiones'));
    writeFileSync(join(proyecto, 'demo.config.mjs'), `export default {
        baseURL: '${juguete.url}',
        marca: { nombre: 'Juguete CLI' },
        login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
        actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
        guiones: './guiones',
        salida: './salida',
        voz: { motor: 'ninguno', respaldo: 'ninguno' },
        video: { ancho: 640, alto: 480, pausaMinima: 150 },
    };`);
    return proyecto;
}

function escribirGuionPanel(proyecto, id, url) {
    writeFileSync(join(proyecto, 'guiones', `${id}.mjs`), `export default {
        id: '${id}',
        titulo: 'Guion ${id}',
        escenas: [{ id: 'ver-panel', titulo: 'Ver panel (${id})', pasos: [{
            actor: 'funcionario',
            narrar: 'Abrimos el panel.',
            hacer: async (page) => { await page.goto('${url}/panel'); },
        }] }],
    };`);
}

test('demo grabar reutiliza la sesión ya preparada en vez de rehacerla', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    try {
        const proyecto = proyectoDeJuguete(juguete);
        escribirGuionPanel(proyecto, 'panel', juguete.url);

        const primera = await correrCli(proyecto, ['grabar', 'panel']);
        assert.equal(primera.status, 0, `demo grabar falló: ${primera.stderr}`);

        const archivoSesion = join(proyecto, '.sesiones', 'funcionario.json');
        assert.ok(existsSync(archivoSesion), 'demo grabar debió dejar la sesión guardada en disco');
        const mtimeAntes = statSync(archivoSesion).mtimeMs;

        await new Promise((listo) => setTimeout(listo, 20));

        const segunda = await correrCli(proyecto, ['grabar', 'panel']);
        assert.equal(segunda.status, 0, `demo grabar (segunda vez) falló: ${segunda.stderr}`);
        const mtimeDespues = statSync(archivoSesion).mtimeMs;

        assert.equal(mtimeDespues, mtimeAntes,
            'la sesión se reescribió en disco: demo grabar volvió a loguear en vez de reutilizar');
    } finally {
        await juguete.cerrar();
    }
});

test('con una config inválida, sale con mensaje accionable y código de salida distinto de cero', async () => {
    // Proyecto vacío: sin demo.config.mjs. cargarConfig debe fallar con ErrorConfig, y
    // cli.mjs debe imprimir su mensaje (que nombra el archivo y qué falta) y salir con
    // código != 0, en vez de un stack trace críptico o un exit 0 silencioso.
    const proyecto = mkdtempSync(join(tmpdir(), 'demo-cli-inv-'));

    const resultado = await correrCli(proyecto, ['preparar']);

    assert.notEqual(resultado.status, 0, 'una config inválida no debe salir con código 0');
    assert.match(resultado.stderr, /demo\.config\.mjs/,
        'el mensaje de error debe nombrar demo.config.mjs para ser accionable');
});

test('demo manual sin argumento detecta el guion maestro y encadena el manual de sus capítulos', async () => {
    // Defecto real: sin argumento, cli.mjs cargaba el guion maestro (curso.mjs, que declara
    // `capitulos`, no `escenas`) y se lo pasaba tal cual a grabar(), que revienta o no hace
    // nada útil. Acá se detecta el caso maestro y se encadena el manual de todos los
    // capítulos que sean guiones grabables.
    const juguete = await iniciarJuguete({ puerto: 0 });
    try {
        const proyecto = proyectoDeJuguete(juguete);
        escribirGuionPanel(proyecto, 'cap1', juguete.url);
        escribirGuionPanel(proyecto, 'cap2', juguete.url);
        writeFileSync(join(proyecto, 'guiones', 'curso.mjs'), `export default {
            id: 'curso',
            titulo: 'Curso completo de prueba',
            capitulos: [
                { id: 'capitulo-1', titulo: 'Capítulo 1', guion: 'cap1' },
                { id: 'capitulo-2', titulo: 'Capítulo 2', guion: 'cap2' },
            ],
        };`);

        const resultado = await correrCli(proyecto, ['manual']);
        assert.equal(resultado.status, 0, `demo manual falló: ${resultado.stderr}`);

        const md = join(proyecto, 'salida', 'curso.md');
        assert.ok(existsSync(md), 'debió generar salida/curso.md');
        const texto = readFileSync(md, 'utf8');
        assert.match(texto, /# Curso completo de prueba/);
        assert.match(texto, /Ver panel \(cap1\)/, 'debe traer las escenas del capítulo 1');
        assert.match(texto, /Ver panel \(cap2\)/, 'debe traer las escenas del capítulo 2');
        assert.ok(existsSync(join(proyecto, 'salida', 'curso.pdf')));
    } finally {
        await juguete.cerrar();
    }
});

test('demo manual con un guion normal sigue funcionando como antes', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    try {
        const proyecto = proyectoDeJuguete(juguete);
        escribirGuionPanel(proyecto, 'panel', juguete.url);

        const resultado = await correrCli(proyecto, ['manual', 'panel']);
        assert.equal(resultado.status, 0, `demo manual panel falló: ${resultado.stderr}`);

        const md = join(proyecto, 'salida', 'panel.md');
        assert.ok(existsSync(md));
        assert.match(readFileSync(md, 'utf8'), /Ver panel \(panel\)/);
    } finally {
        await juguete.cerrar();
    }
});
