import { test } from 'node:test';
import assert from 'node:assert/strict';
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
