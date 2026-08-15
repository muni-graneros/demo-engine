import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

function proyectoDeJuguete(juguete, extra = '') {
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
        ${extra}
    };`);
    return proyecto;
}

/** OCR de juguete: ignora el cuerpo (no le interesa el frame) y devuelve `texto` siempre. */
function iniciarOcrDeJuguete(texto) {
    const servidor = createServer((req, res) => {
        req.resume();
        req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ text: texto }));
        });
    });
    return new Promise((listo) => {
        servidor.listen(0, '127.0.0.1', () => {
            const { port } = servidor.address();
            listo({ url: `http://127.0.0.1:${port}/ocr`, cerrar: () => new Promise((f) => servidor.close(f)) });
        });
    });
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

        // La limpieza de capturas/ (ver limpiarCapturas en cli.mjs) corre UNA vez al empezar
        // la corrida, no dentro de cada grabar(): un guion maestro llama a grabar() una vez
        // POR CAPÍTULO, y si limpiara en cada llamada, grabar cap2 dejaría vacía la carpeta
        // de capturas justo antes de arrancar, en vez de solo pisar lo de la corrida anterior.
        const dirCapturas = join(proyecto, 'salida', 'capturas');
        const capturas = readdirSync(dirCapturas).filter((f) => f.endsWith('.png'));
        assert.ok(capturas.length > 0, 'deben sobrevivir capturas de la corrida del guion maestro');
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

test('demo auditar sin auditoria.ocr en la config falla con mensaje claro', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    try {
        const proyecto = proyectoDeJuguete(juguete);
        escribirGuionPanel(proyecto, 'panel', juguete.url);
        await correrCli(proyecto, ['grabar', 'panel']);

        const resultado = await correrCli(proyecto, ['auditar', 'panel']);
        assert.notEqual(resultado.status, 0);
        assert.match(resultado.stderr, /auditoria\.ocr/, 'debe decir exactamente qué falta en la config');
    } finally {
        await juguete.cerrar();
    }
});

test('demo auditar sin argumento imprime el uso y sale con código != 0', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    try {
        const proyecto = proyectoDeJuguete(juguete);
        const resultado = await correrCli(proyecto, ['auditar']);
        assert.notEqual(resultado.status, 0);
        assert.match(resultado.stdout, /Uso: demo auditar/);
    } finally {
        await juguete.cerrar();
    }
});

test('demo auditar detecta un frame sospechoso, lo guarda en disco y sale con código 1', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    // Este OCR de juguete ignora el frame de verdad y siempre "lee" dos identificadores: no
    // hace falta un video con texto real —el patrón se aplica al texto que devuelva el
    // OCR—, así que alcanza con probar que la tubería completa (frames → OCR → conteo →
    // decisión → reporte) queda bien conectada.
    const ocr = await iniciarOcrDeJuguete('12345678-5 y también 87654321-0');
    try {
        const proyecto = proyectoDeJuguete(juguete,
            `auditoria: { ocr: '${ocr.url}', cada: 0.1, maximo: 3 },`);
        escribirGuionPanel(proyecto, 'panel', juguete.url);
        const grabado = await correrCli(proyecto, ['grabar', 'panel']);
        assert.equal(grabado.status, 0, `demo grabar falló: ${grabado.stderr}`);

        const resultado = await correrCli(proyecto, ['auditar', 'panel']);

        assert.equal(resultado.status, 1, `debía salir con código != 0 al encontrar frames sospechosos: ${resultado.stderr}`);
        assert.match(resultado.stdout, /SOSPECHOSO/);
        assert.match(resultado.stdout, /segundo 0s/);
        assert.match(resultado.stdout, /sospechosos/);

        const carpetaFrames = join(proyecto, 'salida', 'auditoria', 'panel');
        assert.ok(existsSync(carpetaFrames), 'debe guardar los frames muestreados en disco');
        const frames = readdirSync(carpetaFrames).filter((f) => f.endsWith('.png'));
        assert.ok(frames.length > 0, 'debe haber al menos un frame guardado para inspeccionar');
    } finally {
        await ocr.cerrar();
        await juguete.cerrar();
    }
});

test('demo auditar también revisa las capturas del manual, no solo el .mp4', async () => {
    // Defecto crítico del cierre de rama: grabador.mjs deja una captura por paso en
    // capturas/ (para el manual), pero demo auditar solo miraba el video. Un guion
    // descuidado (sin abrirFiltrado) podía dejar una captura sin filtrar publicada en el
    // PDF sin que el portero automático la tocara nunca.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const ocr = await iniciarOcrDeJuguete('12345678-5 y también 87654321-0');
    try {
        const proyecto = proyectoDeJuguete(juguete,
            `auditoria: { ocr: '${ocr.url}', cada: 0.1, maximo: 3 },`);
        escribirGuionPanel(proyecto, 'panel', juguete.url);
        const grabado = await correrCli(proyecto, ['grabar', 'panel']);
        assert.equal(grabado.status, 0, `demo grabar falló: ${grabado.stderr}`);

        const dirCapturas = join(proyecto, 'salida', 'capturas');
        assert.ok(existsSync(dirCapturas), 'demo grabar debe dejar capturas para el manual');
        const capturas = readdirSync(dirCapturas).filter((f) => f.endsWith('.png'));
        assert.ok(capturas.length > 0);

        const resultado = await correrCli(proyecto, ['auditar', 'panel']);

        assert.equal(resultado.status, 1, `debía salir con código != 0: ${resultado.stderr}`);
        assert.match(resultado.stdout, /CAPTURA/, 'debe reportar también capturas sospechosas, no solo frames de video');
        assert.match(resultado.stdout, /capturas sospechosas/);
    } finally {
        await ocr.cerrar();
        await juguete.cerrar();
    }
});

test('demo grabar limpia capturas/ de una corrida anterior antes de grabar de nuevo', async () => {
    // Sin esto, una captura sin filtrar que quedó de una grabación vieja sobrevive
    // indefinidamente en un directorio que termina incrustado en el PDF publicado —a
    // diferencia de .tmp/.tmp-curso, que sí se limpian.
    const juguete = await iniciarJuguete({ puerto: 0 });
    try {
        const proyecto = proyectoDeJuguete(juguete);
        escribirGuionPanel(proyecto, 'panel', juguete.url);

        await correrCli(proyecto, ['grabar', 'panel']);
        const dirCapturas = join(proyecto, 'salida', 'capturas');
        assert.ok(existsSync(dirCapturas));
        writeFileSync(join(dirCapturas, 'vieja-sin-filtrar.png'), 'contenido-viejo');

        await correrCli(proyecto, ['grabar', 'panel']);

        assert.ok(!existsSync(join(dirCapturas, 'vieja-sin-filtrar.png')),
            'una captura de una corrida anterior no debe sobrevivir a la siguiente grabación');
    } finally {
        await juguete.cerrar();
    }
});

test('demo auditar con un solo identificador por frame sale con código 0', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const ocr = await iniciarOcrDeJuguete('única persona a la vista: 11111111-1');
    try {
        const proyecto = proyectoDeJuguete(juguete,
            `auditoria: { ocr: '${ocr.url}', cada: 0.1, maximo: 3 },`);
        escribirGuionPanel(proyecto, 'panel', juguete.url);
        await correrCli(proyecto, ['grabar', 'panel']);

        const resultado = await correrCli(proyecto, ['auditar', 'panel']);
        assert.equal(resultado.status, 0, `no debía fallar sin frames sospechosos: ${resultado.stderr}`);
        assert.doesNotMatch(resultado.stdout, /SOSPECHOSO/);
    } finally {
        await ocr.cerrar();
        await juguete.cerrar();
    }
});
