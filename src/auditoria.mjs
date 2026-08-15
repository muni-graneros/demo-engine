/**
 * Portero automático de privacidad: verifica el video YA GRABADO, no la intención de quien
 * escribió el guion. `abrirFiltrado`/`abrirVerificado` (ver privacidad.mjs) dependen de que
 * el guion las llame — una auditoría real encontró guiones que no lo hacían y dejaban varias
 * personas a la vista en un mismo frame. Esto mira el resultado: muestrea frames del MP4,
 * les pasa OCR, y cuenta cuántos identificadores DISTINTOS aparecen en cada uno. Más de uno
 * en la misma pantalla es la misma fuga que `abrirFiltrado` existe para evitar.
 *
 * Genérico a propósito: el motor no sabe qué es un RUT chileno ni en qué puerto vive el OCR
 * del sistema consumidor. Todo eso —`ocr`, `patron`, `cada`, `maximo`— sale de
 * `config.auditoria`, sin defecto para `ocr` (ver `exigirAuditoriaConfigurada`): un motor
 * genérico no puede adivinar a qué host conectarse, y "adivinar un endpoint" es exactamente
 * el tipo de decisión que tiene que tomar quien configura el sistema, no el motor.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { ff } from './ffmpeg.mjs';
import { ErrorConfig } from './configurar.mjs';

const DEFECTOS = {
    ocr: null,
    patron: '\\d{7,8}-[\\dkK]',
    cada: 10,
    maximo: 20,
};

/** Fusiona `auditoria` de la config con los defectos, igual que hace cargarConfig() con voz/video/marca. */
function conDefectos(auditoria) {
    return { ...DEFECTOS, ...auditoria };
}

/**
 * Sin `auditoria.ocr` no hay forma de auditar nada: se falla ACÁ, con un mensaje que dice
 * exactamente qué falta y un ejemplo, en vez de dejar que revienten los `fetch` de más abajo
 * con un `ECONNREFUSED` críptico contra `null`.
 */
export function exigirAuditoriaConfigurada(auditoria) {
    if (auditoria?.ocr) return;
    throw new ErrorConfig(
        'falta auditoria.ocr en demo.config.mjs: "demo auditar" necesita el endpoint del ' +
        'servicio OCR (recibe el archivo en el campo "file", responde { text }). Ejemplo:\n' +
        "  auditoria: { ocr: 'http://127.0.0.1:8110/ocr' }\n" +
        'Sin esto no hay dónde mandar los frames a leer, así que el comando no puede correr.',
    );
}

/**
 * Extrae un frame cada `cada` segundos (hasta `maximo` frames) y los deja en `dirSalida`.
 *
 * No depende de ffprobe (el binario estático de `ffmpeg-static` no lo trae, ver ffmpeg.mjs):
 * el filtro `fps=1/cada` de ffmpeg ya entrega los frames espaciados exactamente así, y el
 * segundo de cada uno es determinístico a partir de su posición (0, cada, 2·cada, …) — no
 * hace falta preguntarle nada al archivo para saberlo.
 *
 * @param {string} video ruta al MP4 ya grabado
 * @param {{cada:number, maximo:number, dirSalida:string}} opciones
 * @returns {{segundo:number, archivo:string}[]}
 */
export function muestrearFrames(video, { cada, maximo, dirSalida }) {
    mkdirSync(dirSalida, { recursive: true });
    ff(['-y', '-i', video, '-vf', `fps=1/${cada}`, '-frames:v', String(maximo), join(dirSalida, 'frame-%04d.png')]);

    const archivos = readdirSync(dirSalida)
        .filter((nombre) => /^frame-\d+\.png$/.test(nombre))
        .sort();
    return archivos.map((nombre, indice) => ({ segundo: indice * cada, archivo: join(dirSalida, nombre) }));
}

/**
 * Identificadores DISTINTOS que matchean `patron` en `texto`. El OCR real del ecosistema
 * está afinado para cédulas, no para texto de interfaz: lee mal alguna letra o dígito, pero
 * el PATRÓN se mantiene intacto (un caso real: leyó "12145678-5" donde decía "12345678-5").
 * Por eso alcanza con contar coincidencias del patrón — no hace falta que el OCR acierte el
 * valor exacto, solo que reconozca la FORMA.
 *
 * @param {string} texto
 * @param {string} patron fuente de un RegExp (sin flags; se le agrega 'g' acá)
 * @returns {string[]}
 */
export function contarIdentificadores(texto, patron) {
    const regex = new RegExp(patron, 'g');
    const vistos = new Set();
    for (const coincidencia of (texto ?? '').matchAll(regex)) vistos.add(coincidencia[0]);
    return [...vistos];
}

/**
 * Llama al servicio OCR configurado con los bytes del frame. Implementación por defecto de
 * `ocr` en `auditarVideo`: cualquier otra se puede inyectar (los tests lo hacen, para no
 * pagar los ~9,5s por frame del OCR real).
 */
async function ocrPorDefecto(endpoint, archivoFrame) {
    const datos = readFileSync(archivoFrame);
    const formulario = new FormData();
    formulario.append('file', new Blob([datos]), basename(archivoFrame));

    let respuesta;
    try {
        respuesta = await fetch(endpoint, { method: 'POST', body: formulario });
    } catch (error) {
        throw new Error(`no se pudo llamar al servicio OCR (${endpoint}) para ${archivoFrame}: ${error.message}`, { cause: error });
    }
    if (!respuesta.ok) {
        throw new Error(`el servicio OCR (${endpoint}) respondió ${respuesta.status} para ${archivoFrame}`);
    }
    const cuerpo = await respuesta.json();
    return { text: cuerpo?.text ?? '' };
}

/**
 * Audita un video ya grabado: muestrea frames, les pasa OCR, y marca como SOSPECHOSO
 * cualquier frame con más de un identificador distinto — eso es una lista sin filtrar a la
 * vista. Cada sospechoso trae el segundo exacto y la ruta del frame ya guardado en disco
 * (lo dejó `muestrearFrames`), para que alguien lo pueda inspeccionar.
 *
 * Comando aparte y no algo automático en cada grabación: el OCR real tarda ~9,5s por frame
 * (ver README, "Costo"), así que auditar un video de varios minutos es un proceso de
 * minutos, no algo que se pueda pagar en cada `demo grabar`.
 *
 * @param {string} video ruta al MP4 a auditar
 * @param {{auditoria?: object}} config trae `config.auditoria` (ver DEFECTOS arriba)
 * @param {{dirFrames?: string, ocr?: (archivo:string) => Promise<{text:string}>}} [opciones]
 *   `ocr` es inyectable para pruebas; sin él usa el endpoint real de `auditoria.ocr`.
 * @returns {Promise<{total:number, sospechosos:{segundo:number, archivo:string, identificadores:string[]}[]}>}
 */
export async function auditarVideo(video, config, { dirFrames, ocr } = {}) {
    const auditoria = conDefectos(config?.auditoria);
    exigirAuditoriaConfigurada(auditoria);

    const carpeta = dirFrames ?? join(dirname(video), 'auditoria', basename(video, extname(video)));
    const frames = muestrearFrames(video, { cada: auditoria.cada, maximo: auditoria.maximo, dirSalida: carpeta });
    const leerFrame = ocr ?? ((archivo) => ocrPorDefecto(auditoria.ocr, archivo));

    const sospechosos = [];
    for (const frame of frames) {
        const { text } = await leerFrame(frame.archivo);
        const identificadores = contarIdentificadores(text, auditoria.patron);
        if (identificadores.length > 1) {
            sospechosos.push({ segundo: frame.segundo, archivo: frame.archivo, identificadores });
        }
    }
    return { total: frames.length, sospechosos };
}

/**
 * Audita las capturas que `grabar()` deja para el manual (una por paso, en `capturas/`
 * dentro de `config.salida` — ver `src/grabador.mjs`). `generarManual` (`src/manual.mjs`)
 * las incrusta en el `.md`/`.html`/`.pdf`, pero hasta acá `demo auditar` solo miraba el
 * `.mp4`: un guion descuidado (que se saltea `abrirFiltrado`) podía dejar una captura sin
 * filtrar publicada en el manual sin que el portero automático la tocara nunca.
 *
 * Mismo criterio que `auditarVideo` (contar identificadores DISTINTOS con el mismo servicio
 * OCR), pero SIN muestreo: a diferencia de un video, acá no hay una corriente continua de la
 * que recortar cada `cada` segundos — cada paso ya deja UNA sola imagen — así que se audita
 * cada captura. Tampoco hace falta copiar evidencia a ningún lado: la captura sospechosa YA
 * vive en disco (es la misma que embebe el manual), así que `archivo` apunta directo a ella.
 *
 * @param {string} dirCapturas carpeta con los PNG (`config.salida/capturas`)
 * @param {{auditoria?: object}} config trae `config.auditoria` (ver DEFECTOS arriba)
 * @param {{ocr?: (archivo:string) => Promise<{text:string}>}} [opciones]
 *   `ocr` es inyectable para pruebas; sin él usa el endpoint real de `auditoria.ocr`.
 * @returns {Promise<{total:number, sospechosos:{archivo:string, identificadores:string[]}[]}>}
 */
export async function auditarCapturas(dirCapturas, config, { ocr } = {}) {
    const auditoria = conDefectos(config?.auditoria);
    exigirAuditoriaConfigurada(auditoria);

    // Sin carpeta de capturas (por ejemplo, auditando un .mp4 que no salió de este motor):
    // no hay nada que auditar acá, y no es un error — el video se audita igual por su lado.
    const nombres = existsSync(dirCapturas)
        ? readdirSync(dirCapturas).filter((nombre) => nombre.endsWith('.png')).sort()
        : [];
    const leerFrame = ocr ?? ((archivo) => ocrPorDefecto(auditoria.ocr, archivo));

    const sospechosos = [];
    for (const nombre of nombres) {
        const archivo = join(dirCapturas, nombre);
        const { text } = await leerFrame(archivo);
        const identificadores = contarIdentificadores(text, auditoria.patron);
        if (identificadores.length > 1) {
            sospechosos.push({ archivo, identificadores });
        }
    }
    return { total: nombres.length, sospechosos };
}
