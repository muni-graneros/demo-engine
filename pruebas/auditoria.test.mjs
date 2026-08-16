import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff } from '../src/ffmpeg.mjs';
import { ErrorConfig } from '../src/configurar.mjs';
import {
    auditarVideo,
    auditarCapturas,
    contarIdentificadores,
    exigirAuditoriaConfigurada,
    muestrearFrames,
} from '../src/auditoria.mjs';

const PATRON = '\\d{7,8}-[\\dkK]';

// contarIdentificadores no depende del OCR real: es puro texto adentro, patrón afuera.

test('contarIdentificadores cuenta identificadores DISTINTOS, sin repetir', () => {
    const uno = contarIdentificadores('el RUT 11111111-1 aparece una vez', PATRON);
    assert.deepEqual(uno, ['11111111-1']);

    const dos = contarIdentificadores('vemos 12345678-5 y también 87654321-0 en la lista', PATRON);
    assert.equal(dos.length, 2);
    assert.ok(dos.includes('12345678-5') && dos.includes('87654321-0'));

    // El mismo identificador dos veces en el texto (por ejemplo el OCR lo leyó repetido, o
    // aparece en dos columnas de la misma fila) cuenta como UNO solo: no es una fuga de dos
    // personas distintas, es la misma persona vista dos veces.
    const repetido = contarIdentificadores('11111111-1 ... de nuevo 11111111-1', PATRON);
    assert.deepEqual(repetido, ['11111111-1']);
});

test('contarIdentificadores no necesita que el OCR acierte el valor, solo la forma', () => {
    // Caso real verificado a mano: el OCR leyó "12145678-5" donde decía "12345678-5" —un
    // dígito mal— pero el patrón lo reconoce igual, que es lo único que importa acá.
    const resultado = contarIdentificadores('texto ruidoso 12145678-5 más ruido', PATRON);
    assert.deepEqual(resultado, ['12145678-5']);
});

test('sin nada que matchee, no hay identificadores', () => {
    assert.deepEqual(contarIdentificadores('Solicitudes de hoy — Panel de gestión', PATRON), []);
});

// validar: caso real medido a mano (ver README, "Validación de identificadores"). Una sola
// persona en pantalla, RUT real 18039759-0, que aparece TRES veces en la interfaz (buscador,
// chip de filtro activo, celda de la tabla). El OCR —afinado para cédulas, no para texto de
// interfaz— lo transcribe distinto en dos de esas tres lecturas: "16030759-0" y "18023759-0"
// matchean el patrón (la FORMA de un RUT) pero no son RUT chilenos válidos (dígito
// verificador módulo 11 incorrecto). El motor no sabe qué es un RUT: `validarRutDePrueba`
// simula la función que el propio `demo.config.mjs` del sistema consumidor declararía en
// `auditoria.validar`.
function validarRutDePrueba(id) {
    const limpio = id.toUpperCase();
    const [cuerpo, dv] = limpio.split('-');
    if (!cuerpo || !dv) return false;
    let suma = 0;
    let multiplicador = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
        suma += Number(cuerpo[i]) * multiplicador;
        multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
    }
    const resto = 11 - (suma % 11);
    const dvEsperado = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
    return dv === dvEsperado;
}

test('contarIdentificadores con validador descarta lecturas que matchean el patrón pero no pasan la validación', () => {
    const texto = 'buscador: 16030759-0  filtro activo: 18023759-0  tabla: 18039759-0';

    const sinValidar = contarIdentificadores(texto, PATRON);
    assert.equal(sinValidar.length, 3,
        'sin validador, cada lectura distinta del OCR sigue contando como un identificador distinto (hoy)');

    const conValidar = contarIdentificadores(texto, PATRON, validarRutDePrueba);
    assert.deepEqual(conValidar, ['18039759-0'],
        'con validador, solo la lectura con dígito verificador correcto queda');
});

test('contarIdentificadores sin validador no cambia su comportamiento (compatibilidad hacia atrás)', () => {
    const resultado = contarIdentificadores('11111111-1 y 87654321-0', PATRON);
    assert.equal(resultado.length, 2, 'sin validar declarado, se cuenta todo lo que matchea el patrón, como hoy');
});

test('contarIdentificadores propaga un error claro si el validador lanza', () => {
    const validadorRoto = () => { throw new Error('boom'); };
    assert.throws(() => contarIdentificadores('11111111-1', PATRON, validadorRoto),
        (e) => {
            assert.match(e.message, /auditoria\.validar/);
            assert.match(e.message, /11111111-1/);
            return true;
        });
});

// exigirAuditoriaConfigurada: sin auditoria.ocr, el comando debe fallar con un mensaje claro
// (qué falta y un ejemplo), no con un error críptico de conexión contra `null`.

test('exigirAuditoriaConfigurada falla con un mensaje accionable si falta auditoria.ocr', () => {
    assert.throws(() => exigirAuditoriaConfigurada({ patron: PATRON, cada: 10, maximo: 20 }),
        (e) => {
            assert.ok(e instanceof ErrorConfig);
            assert.match(e.message, /auditoria\.ocr/);
            assert.match(e.message, /http/);   // trae un ejemplo de endpoint
            return true;
        });
    assert.throws(() => exigirAuditoriaConfigurada(undefined), ErrorConfig);
});

test('exigirAuditoriaConfigurada no lanza si auditoria.ocr está presente', () => {
    assert.doesNotThrow(() => exigirAuditoriaConfigurada({ ocr: 'http://127.0.0.1:8110/ocr' }));
});

// muestrearFrames sí usa ffmpeg de verdad (el mismo binario estático que ya trae el motor):
// es la parte que se puede probar sin pagar el costo del OCR real.

test('muestrearFrames extrae un frame cada N segundos y respeta el tope', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-audit-frames-'));
    const video = join(dir, 'clip.mp4');
    // 5 segundos de video: con cada=1 daría para ~5 frames, pero el tope de 3 debe cortar ahí.
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=5', '-c:v', 'libx264', video]);

    const frames = muestrearFrames(video, { cada: 1, maximo: 3, dirSalida: join(dir, 'frames') });

    assert.equal(frames.length, 3, 'debe respetar el tope de frames aunque el video dé para más');
    for (const [indice, frame] of frames.entries()) {
        assert.equal(frame.segundo, indice * 1, 'el segundo de cada frame es determinístico por su posición');
        assert.ok(existsSync(frame.archivo), `el frame debe quedar guardado en disco: ${frame.archivo}`);
    }
});

// auditarVideo: lógica completa (muestrear + contar + decidir) con un OCR FALSO — el OCR
// real tarda ~9,5s por frame, así que la suite no puede depender de él.

function videoDePrueba(segundos = 3) {
    const dir = mkdtempSync(join(tmpdir(), 'demo-audit-video-'));
    const video = join(dir, 'clip.mp4');
    ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=320x240:d=${segundos}`, '-c:v', 'libx264', video]);
    return { dir, video };
}

test('un frame con dos identificadores distintos queda marcado como sospechoso', async () => {
    const { dir, video } = videoDePrueba(2);
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON, cada: 1, maximo: 2 } };

    // El primer frame "trae" dos identificadores (fuga: una lista sin filtrar); el resto,
    // uno solo. El servicio real nunca se llama: se inyecta un lector falso.
    let llamada = 0;
    const ocrFalso = async () => {
        llamada++;
        return llamada === 1
            ? { text: 'fila 1: 12345678-5   fila 2: 87654321-0' }
            : { text: 'fila 1: 11111111-1' };
    };

    const resultado = await auditarVideo(video, config, { dirFrames: join(dir, 'frames'), ocr: ocrFalso });

    assert.equal(resultado.total, 2);
    assert.equal(resultado.sospechosos.length, 1, 'debe marcar exactamente el frame con dos identificadores');
    assert.equal(resultado.sospechosos[0].segundo, 0, 'el segundo exacto del frame sospechoso');
    assert.equal(resultado.sospechosos[0].identificadores.length, 2);
    assert.ok(existsSync(resultado.sospechosos[0].archivo), 'el frame sospechoso debe estar guardado en disco para inspeccionarlo');
});

test('con un solo identificador por frame, no hay sospechosos', async () => {
    const { dir, video } = videoDePrueba(2);
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON, cada: 1, maximo: 2 } };

    const ocrFalso = async () => ({ text: 'única persona a la vista: 11111111-1' });

    const resultado = await auditarVideo(video, config, { dirFrames: join(dir, 'frames'), ocr: ocrFalso });

    assert.equal(resultado.sospechosos.length, 0);
    assert.equal(resultado.total, 2);
});

// auditoria.validar de punta a punta: el falso positivo real que motivó esta condición
// (ver README) — una sola persona, RUT real 18039759-0 leído 3 veces, con dos lecturas del
// OCR que matchean el patrón pero no el dígito verificador.

test('auditarVideo con validador no marca sospechoso un frame con dos lecturas erróneas del mismo RUT', async () => {
    const { dir, video } = videoDePrueba(2);
    const config = {
        auditoria: {
            ocr: 'http://fake.local/ocr', patron: PATRON, cada: 1, maximo: 1,
            validar: validarRutDePrueba,
        },
    };
    const ocrFalso = async () => ({ text: 'buscador: 16030759-0 filtro: 18023759-0 tabla: 18039759-0' });

    const resultado = await auditarVideo(video, config, { dirFrames: join(dir, 'frames'), ocr: ocrFalso });

    assert.equal(resultado.sospechosos.length, 0,
        'con validador, dos lecturas erróneas del mismo RUT no deben marcar la pantalla como sospechosa');
});

test('auditarVideo SIN validador declarado sigue marcando el mismo caso (comportamiento de hoy sin cambios)', async () => {
    const { dir, video } = videoDePrueba(2);
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON, cada: 1, maximo: 1 } };
    const ocrFalso = async () => ({ text: 'buscador: 16030759-0 filtro: 18023759-0 tabla: 18039759-0' });

    const resultado = await auditarVideo(video, config, { dirFrames: join(dir, 'frames'), ocr: ocrFalso });

    assert.equal(resultado.sospechosos.length, 1,
        'sin auditoria.validar, el comportamiento no cambia: sigue contando toda forma que matchea el patrón');
});

// Bug real medido a mano: con el `cada` por defecto (10s), un video más corto que eso no
// entrega NINGÚN frame al filtro fps=1/cada de ffmpeg (el primer punto de muestreo cae
// después de que el video ya terminó) — el portero "aprueba" sin haber mirado nada.

test('muestrearFrames con un video más corto que "cada" igual examina al menos un frame', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-audit-corto-'));
    const video = join(dir, 'clip.mp4');
    // 2 segundos de contenido real, muy por debajo del "cada" por defecto (10s).
    ff(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=2', '-c:v', 'libx264', video]);

    const frames = muestrearFrames(video, { cada: 10, maximo: 20, dirSalida: join(dir, 'frames') });

    assert.ok(frames.length >= 1,
        'un video con contenido nunca debe quedar con 0 frames examinados solo porque es más corto que "cada"');
    assert.equal(frames[0].segundo, 0);
    assert.ok(existsSync(frames[0].archivo));
});

test('auditarVideo con la config por defecto sobre un video corto SÍ examina frames (no "0 de 0")', async () => {
    // Sin `cada` en la config: usa el DEFECTO (10s) — exactamente el caso medido a mano.
    const { dir, video } = videoDePrueba(2);
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON } };
    const ocrFalso = async () => ({ text: 'única persona a la vista: 11111111-1' });

    const resultado = await auditarVideo(video, config, { dirFrames: join(dir, 'frames'), ocr: ocrFalso });

    assert.ok(resultado.total >= 1,
        'un video con contenido real no puede quedar auditado como "0 de 0": eso es aprobar sin mirar');
});

test('auditarVideo sobre un video SIN contenido (duración no detectable) no se puede dar por aprobado', async () => {
    // Ni siquiera un video de verdad: un archivo cualquiera con extensión .mp4. duracion()
    // no logra leer un "Duration:" del stderr de ffmpeg y devuelve 0 — el caso de "sin
    // contenido" que pide el requisito, distinto de "corto pero con contenido".
    const dir = mkdtempSync(join(tmpdir(), 'demo-audit-vacio-'));
    const video = join(dir, 'no-es-un-video.mp4');
    writeFileSync(video, 'esto no es un video');
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON } };

    await assert.rejects(
        () => auditarVideo(video, config, { dirFrames: join(dir, 'frames'), ocr: async () => ({ text: '' }) }),
        (e) => {
            // Nunca debe devolver un resultado "limpio" (0 sospechosos) sin más: eso es
            // indistinguible de una auditoría real que sí miró y no encontró nada.
            assert.match(e.message, /ningún frame|ning[uú]n frame/i);
            return true;
        },
        'un video sin contenido examinable no puede resolver como si estuviera auditado y limpio',
    );
});

test('auditarVideo sin auditoria.ocr configurado falla claro, sin siquiera intentar muestrear', async () => {
    const { video } = videoDePrueba(1);
    await assert.rejects(
        () => auditarVideo(video, {}, { ocr: async () => ({ text: '' }) }),
        (e) => {
            assert.ok(e instanceof ErrorConfig);
            assert.match(e.message, /auditoria\.ocr/);
            return true;
        },
    );
});

// auditarCapturas: mismo criterio que auditarVideo (contar identificadores DISTINTOS por
// imagen con el mismo OCR), pero sobre las capturas que `grabar()` deja para el manual
// (docs/manual/capturas/*.png) — `demo auditar` solo miraba el .mp4 y estas quedaban
// completamente fuera del portero automático.

function dirCapturasDePrueba(nombres) {
    const dir = mkdtempSync(join(tmpdir(), 'demo-audit-capturas-'));
    for (const nombre of nombres) writeFileSync(join(dir, nombre), 'contenido-de-mentira');
    return dir;
}

test('una captura con dos identificadores distintos queda marcada como sospechosa', async () => {
    const dir = dirCapturasDePrueba(['panel-0.png', 'panel-1.png']);
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON } };

    let llamada = 0;
    const ocrFalso = async () => {
        llamada++;
        return llamada === 1
            ? { text: 'fila 1: 12345678-5   fila 2: 87654321-0' }
            : { text: 'fila 1: 11111111-1' };
    };

    const resultado = await auditarCapturas(dir, config, { ocr: ocrFalso });

    assert.equal(resultado.total, 2);
    assert.equal(resultado.sospechosos.length, 1, 'debe marcar exactamente la captura con dos identificadores');
    assert.equal(resultado.sospechosos[0].identificadores.length, 2);
    assert.ok(existsSync(resultado.sospechosos[0].archivo), 'la captura sospechosa ya vive en disco: es su propia evidencia');
});

test('con un solo identificador por captura, no hay sospechosos', async () => {
    const dir = dirCapturasDePrueba(['panel-0.png']);
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON } };
    const ocrFalso = async () => ({ text: 'única persona a la vista: 11111111-1' });

    const resultado = await auditarCapturas(dir, config, { ocr: ocrFalso });

    assert.equal(resultado.sospechosos.length, 0);
    assert.equal(resultado.total, 1);
});

test('auditarCapturas con validador no marca sospechosa una captura con dos lecturas erróneas del mismo RUT', async () => {
    const dir = dirCapturasDePrueba(['panel-0.png']);
    const config = {
        auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON, validar: validarRutDePrueba },
    };
    const ocrFalso = async () => ({ text: 'buscador: 16030759-0 filtro: 18023759-0 tabla: 18039759-0' });

    const resultado = await auditarCapturas(dir, config, { ocr: ocrFalso });

    assert.equal(resultado.sospechosos.length, 0,
        'con validador, dos lecturas erróneas del mismo RUT no deben marcar la captura como sospechosa');
});

test('auditarCapturas SIN validador declarado sigue marcando el mismo caso (comportamiento de hoy sin cambios)', async () => {
    const dir = dirCapturasDePrueba(['panel-0.png']);
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON } };
    const ocrFalso = async () => ({ text: 'buscador: 16030759-0 filtro: 18023759-0 tabla: 18039759-0' });

    const resultado = await auditarCapturas(dir, config, { ocr: ocrFalso });

    assert.equal(resultado.sospechosos.length, 1,
        'sin auditoria.validar, el comportamiento no cambia: sigue contando toda forma que matchea el patrón');
});

test('auditarCapturas ignora archivos que no son PNG en la carpeta', async () => {
    const dir = dirCapturasDePrueba(['panel-0.png', 'notas.txt']);
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON } };
    const ocrFalso = async () => ({ text: 'sin identificadores acá' });

    const resultado = await auditarCapturas(dir, config, { ocr: ocrFalso });

    assert.equal(resultado.total, 1, 'solo debe procesar el .png, no el .txt');
});

test('auditarCapturas sin carpeta de capturas no revienta: total 0, sin sospechosos', async () => {
    const config = { auditoria: { ocr: 'http://fake.local/ocr', patron: PATRON } };
    const resultado = await auditarCapturas('/no/existe/jamas', config, { ocr: async () => ({ text: '' }) });
    assert.deepEqual(resultado, { total: 0, sospechosos: [] });
});

test('auditarCapturas sin auditoria.ocr configurado falla claro, sin siquiera intentar leer la carpeta', async () => {
    await assert.rejects(
        () => auditarCapturas('/lo/que/sea', {}, { ocr: async () => ({ text: '' }) }),
        (e) => {
            assert.ok(e instanceof ErrorConfig);
            assert.match(e.message, /auditoria\.ocr/);
            return true;
        },
    );
});

// Reintento ante fallos TRANSITORIOS del OCR real (implementación por defecto, la que usan
// auditarVideo/auditarCapturas cuando NO se inyecta `ocr` — la que de verdad habla por HTTP).
//
// El caso motivador es real: "demo auditar" sobre un curso completo (31 peticiones a ~9,5s
// cada una, ~5 minutos) murió con UND_ERR_SOCKET tras procesar todo; la segunda corrida,
// idéntica, terminó limpia con código 0. Un parpadeo de red tirando cinco minutos de trabajo
// empuja a la gente a saltarse el control.
//
// Estas pruebas NO inyectan `ocr`: levantan un servidor HTTP real (mismo patrón que
// `iniciarOcrDeJuguete` en pruebas/cli.test.mjs) para ejercitar la implementación por
// defecto tal como la usa un usuario real.

/**
 * Servidor OCR de juguete con fallos controlables:
 * - `fallosTransitorios`: cuántas peticiones iniciales cortan el socket ANTES de responder
 *   (`req.socket.destroy()`), simulando el UND_ERR_SOCKET real — un fallo de RED, no una
 *   respuesta del servidor. Verificado a mano (ver informe): esto es justo lo que produce
 *   fetch() cuando el otro lado cierra la conexión, mismo `error.code` que el incidente real.
 * - `siempreDevuelve404`: cada petición responde 404 — una respuesta HTTP REAL (el servidor
 *   sí contestó), el caso de "endpoint mal configurado", que reintentar no arregla.
 */
function iniciarOcrDeJugueteConFallos({ fallosTransitorios = 0, siempreDevuelve404 = false, texto = '' } = {}) {
    let llamadas = 0;
    const servidor = createServer((req, res) => {
        llamadas++;
        if (siempreDevuelve404) {
            req.resume();
            res.writeHead(404);
            return res.end('no existe ese endpoint');
        }
        if (llamadas <= fallosTransitorios) {
            req.socket.destroy();
            return;
        }
        req.resume();
        req.on('end', () => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ text: texto }));
        });
    });
    return new Promise((listo) => {
        servidor.listen(0, '127.0.0.1', () => {
            const { port } = servidor.address();
            listo({
                url: `http://127.0.0.1:${port}/ocr`,
                llamadas: () => llamadas,
                cerrar: () => new Promise((f) => servidor.close(f)),
            });
        });
    });
}

test('un fallo TRANSITORIO (socket cortado) en la primera petición se reintenta y la auditoría termina limpia', async () => {
    const ocr = await iniciarOcrDeJugueteConFallos({ fallosTransitorios: 1, texto: 'única persona a la vista: 11111111-1' });
    try {
        const dir = dirCapturasDePrueba(['panel-0.png']);
        const config = { auditoria: { ocr: ocr.url, patron: PATRON } };

        const resultado = await auditarCapturas(dir, config);

        assert.equal(resultado.total, 1);
        assert.equal(resultado.sospechosos.length, 0);
        assert.equal(ocr.llamadas(), 2, 'debe haber reintentado una vez tras el fallo transitorio, igual que sintetizar() en voz/proceso.mjs');
    } finally {
        await ocr.cerrar();
    }
});

test('un fallo PERMANENTE (404: el servidor SÍ contestó) no se reintenta y la auditoría falla en el acto', async () => {
    const ocr = await iniciarOcrDeJugueteConFallos({ siempreDevuelve404: true });
    try {
        const dir = dirCapturasDePrueba(['panel-0.png']);
        const config = { auditoria: { ocr: ocr.url, patron: PATRON } };

        await assert.rejects(
            () => auditarCapturas(dir, config),
            (e) => {
                assert.match(e.message, /404/, 'el mensaje debe traer el código de estado que devolvió el servidor');
                assert.match(e.message, /panel-0\.png/, 'el mensaje debe decir qué imagen no se pudo auditar');
                return true;
            },
        );
        assert.equal(ocr.llamadas(), 1,
            'un 404 es una respuesta REAL del servidor: reintentar no cambia el resultado, así que no debe reintentarse');
    } finally {
        await ocr.cerrar();
    }
});

test('si el fallo transitorio persiste incluso tras el reintento, la auditoría sigue fallando (nunca "limpia")', async () => {
    // Los DOS intentos cortan el socket: el reintento no alcanza a salvar la corrida.
    const ocr = await iniciarOcrDeJugueteConFallos({ fallosTransitorios: 2 });
    try {
        const dir = dirCapturasDePrueba(['panel-0.png']);
        const config = { auditoria: { ocr: ocr.url, patron: PATRON } };

        await assert.rejects(
            () => auditarCapturas(dir, config),
            (e) => {
                assert.match(e.message, /panel-0\.png/, 'el mensaje debe decir qué imagen no se pudo auditar');
                assert.match(e.message, /ocr|OCR/, 'el mensaje debe explicar que fue el servicio OCR el que falló, no un error genérico');
                return true;
            },
            'nunca debe reportarse "limpio" (sin sospechosos) sobre una imagen que no se pudo auditar de verdad',
        );
        assert.equal(ocr.llamadas(), 2, 'debe haber reintentado exactamente una vez, ni cero ni más');
    } finally {
        await ocr.cerrar();
    }
});

test('el reintento transitorio también aplica a auditarVideo (frames del .mp4, no solo capturas)', async () => {
    const ocr = await iniciarOcrDeJugueteConFallos({ fallosTransitorios: 1, texto: 'única persona a la vista: 11111111-1' });
    try {
        const { dir, video } = videoDePrueba(2);
        const config = { auditoria: { ocr: ocr.url, patron: PATRON, cada: 1, maximo: 2 } };

        const resultado = await auditarVideo(video, config, { dirFrames: join(dir, 'frames') });

        assert.equal(resultado.total, 2);
        assert.equal(resultado.sospechosos.length, 0);
        assert.ok(ocr.llamadas() >= 3, 'al menos un reintento debió ocurrir entre los frames procesados');
    } finally {
        await ocr.cerrar();
    }
});
