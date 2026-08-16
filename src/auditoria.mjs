/**
 * Portero automático de privacidad: verifica el video YA GRABADO, no la intención de quien
 * escribió el guion. `abrirFiltrado`/`abrirVerificado` (ver privacidad.mjs) dependen de que
 * el guion las llame — una auditoría real encontró guiones que no lo hacían y dejaban varias
 * personas a la vista en un mismo frame. Esto mira el resultado: muestrea frames del MP4,
 * les pasa OCR, y cuenta cuántos identificadores DISTINTOS aparecen en cada uno. Más de uno
 * en la misma pantalla es la misma fuga que `abrirFiltrado` existe para evitar.
 *
 * Genérico a propósito: el motor no sabe qué es un RUT chileno ni en qué puerto vive el OCR
 * del sistema consumidor. Todo eso —`ocr`, `patron`, `cada`, `maximo`, `validar`— sale de
 * `config.auditoria`, sin defecto para `ocr` (ver `exigirAuditoriaConfigurada`): un motor
 * genérico no puede adivinar a qué host conectarse, y "adivinar un endpoint" es exactamente
 * el tipo de decisión que tiene que tomar quien configura el sistema, no el motor. `validar`
 * es la misma idea aplicada a los identificadores: una función OPCIONAL que descarta
 * coincidencias del patrón que no son un identificador real (ver `contarIdentificadores`),
 * porque el motor tampoco sabe calcular un dígito verificador de RUT.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { ff, duracion } from './ffmpeg.mjs';
import { ErrorConfig } from './configurar.mjs';

const DEFECTOS = {
    ocr: null,
    patron: '\\d{7,8}-[\\dkK]',
    cada: 10,
    maximo: 20,
    // Sin defecto, a propósito: el motor no sabe qué es un RUT chileno ni ningún otro
    // identificador concreto. Es un filtro OPCIONAL que aporta quien configura el sistema
    // (ver contarIdentificadores más abajo); sin declararlo, el comportamiento es el de
    // siempre: contar toda forma que matchee `patron`.
    validar: null,
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
 * El filtro `fps=1/cada` de ffmpeg agenda su primer punto de muestreo en el segundo `cada`
 * exacto — no en 0. Con un video MÁS CORTO que `cada` (un guion de una sola escena, por
 * ejemplo: unos pocos segundos contra el `cada` por defecto de 10s) ese punto cae después de
 * que el video ya terminó, y ffmpeg no entrega NINGÚN frame. Eso es "0 de 0 sospechosos" con
 * código de salida 0: el portero aprobando sin haber mirado un solo frame.
 *
 * Por eso el paso efectivo nunca es mayor que la duración real del video: así el primer
 * punto de muestreo (t=0) siempre cae dentro del video, y se examina al menos un frame
 * mientras haya contenido. Esto sí depende de preguntarle al archivo su duración (ver
 * `duracion()` en ffmpeg.mjs, que tampoco depende de ffprobe) — ya no alcanza con calcular
 * el segundo de cada frame a partir de su posición sin mirar el archivo.
 *
 * Si la duración no se puede determinar (video sin contenido, corrupto, o vacío) no se
 * intenta nada con ffmpeg — dividir por una duración de 0 no tiene un frame válido que dar—
 * y se devuelve sin frames. `auditarVideo` es quien decide qué hacer con "cero frames": acá
 * solo se reporta el hecho.
 *
 * @param {string} video ruta al MP4 ya grabado
 * @param {{cada:number, maximo:number, dirSalida:string}} opciones
 * @returns {{segundo:number, archivo:string}[]}
 */
export function muestrearFrames(video, { cada, maximo, dirSalida }) {
    mkdirSync(dirSalida, { recursive: true });

    const total = duracion(video);
    if (total <= 0) return [];

    const efectivo = Math.min(cada, total);
    ff(['-y', '-i', video, '-vf', `fps=1/${efectivo}`, '-frames:v', String(maximo), join(dirSalida, 'frame-%04d.png')]);

    const archivos = readdirSync(dirSalida)
        .filter((nombre) => /^frame-\d+\.png$/.test(nombre))
        .sort();
    return archivos.map((nombre, indice) => ({ segundo: indice * efectivo, archivo: join(dirSalida, nombre) }));
}

/**
 * Identificadores DISTINTOS que matchean `patron` en `texto`. El OCR real del ecosistema
 * está afinado para cédulas, no para texto de interfaz: lee mal alguna letra o dígito, pero
 * el PATRÓN se mantiene intacto (un caso real: leyó "12145678-5" donde decía "12345678-5").
 * Por eso alcanza con contar coincidencias del patrón — no hace falta que el OCR acierte el
 * valor exacto, solo que reconozca la FORMA.
 *
 * `validar`, si se pasa, descarta coincidencias que matchean la FORMA pero no son un
 * identificador real — el caso medido a mano que motiva esto: una sola persona en pantalla
 * cuyo RUT aparece 3 veces en la interfaz (buscador, chip de filtro, celda), y el OCR lo
 * transcribe distinto en dos de esas tres lecturas. Ambas matchean `patron` (parecen un RUT)
 * pero no pasan el dígito verificador — un chequeo que el motor no puede aplicar SOLO porque
 * no sabe qué es un RUT chileno. `validar` es exactamente ese conocimiento, aportado por
 * quien configura el sistema (`auditoria.validar` en demo.config.mjs); el motor se limita a
 * llamarlo. Sin `validar`, el comportamiento es el de siempre: se cuenta todo lo que matchea
 * `patron`, sin descartar nada.
 *
 * @param {string} texto
 * @param {string} patron fuente de un RegExp (sin flags; se le agrega 'g' acá)
 * @param {(id: string) => boolean} [validar] opcional; si se pasa, descarta lo que no aprueba
 * @returns {string[]}
 */
export function contarIdentificadores(texto, patron, validar) {
    const regex = new RegExp(patron, 'g');
    const vistos = new Set();
    for (const coincidencia of (texto ?? '').matchAll(regex)) {
        const id = coincidencia[0];
        if (validar) {
            let aprueba;
            try {
                aprueba = validar(id);
            } catch (error) {
                throw new Error(
                    `auditoria.validar lanzó un error al validar "${id}": ${error.message}`,
                    { cause: error },
                );
            }
            if (!aprueba) continue;
        }
        vistos.add(id);
    }
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

    // Cero frames nunca es sinónimo de "aprobado". Con el paso efectivo de muestrearFrames,
    // solo se llega acá con 0 frames si el video no tiene contenido examinable (duración
    // cero, corrupto). Devolver { total: 0, sospechosos: [] } sería indistinguible de una
    // auditoría real que sí miró y no encontró nada — exactamente la garantía falsa que este
    // comando existe para evitar. Se corta acá, con un mensaje inequívoco, y SIN salir con
    // código 0 (ver cli.mjs: cualquier excepción que no sea ErrorConfig también sale != 0).
    if (frames.length === 0) {
        throw new ErrorConfig(
            `auditoria: no se examinó ningún frame de ${video} — el video no tiene contenido ` +
            'examinable (duración cero o no detectable por ffmpeg). No se puede dar por ' +
            'aprobado sin haber mirado un solo frame.',
        );
    }

    const leerFrame = ocr ?? ((archivo) => ocrPorDefecto(auditoria.ocr, archivo));

    const sospechosos = [];
    for (const frame of frames) {
        const { text } = await leerFrame(frame.archivo);
        const identificadores = contarIdentificadores(text, auditoria.patron, auditoria.validar);
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
        const identificadores = contarIdentificadores(text, auditoria.patron, auditoria.validar);
        if (identificadores.length > 1) {
            sospechosos.push({ archivo, identificadores });
        }
    }
    return { total: nombres.length, sospechosos };
}
