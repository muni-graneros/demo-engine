import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff } from '../src/ffmpeg.mjs';
import { ErrorConfig } from '../src/configurar.mjs';
import {
    auditarVideo,
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
