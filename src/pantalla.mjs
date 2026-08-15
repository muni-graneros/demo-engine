/**
 * Grabación de pantalla propia, por CDP, en reemplazo de `recordVideo` de Playwright.
 *
 * `recordVideo` solo deja elegir tamaño y modo: el bitrate queda fijado adentro, y para el
 * tipo de video que produce este motor (paneles con texto fino) sale bajo — el texto se ve
 * blando. Acá se maneja el screencast directo (`Page.startScreencast` / evento
 * `Page.screencastFrame`) y se encodea con nuestro propio ffmpeg, con calidad configurable.
 *
 * El desafío real no es capturar los frames: es que el screencast los emite a RITMO
 * VARIABLE. Una pantalla quieta no emite nada; una animación (el cursor moviéndose, un
 * zoom) emite varios seguidos. Si se tratara cada frame como equidistante, el video
 * saldría acelerado en lo quieto y lento en lo agitado, y la narración —que se alinea por
 * segundos contra `tLocal`/`tGlobal` de cada paso— quedaría desacoplada de lo que se ve.
 *
 * La solución es dejar que ffmpeg reconstruya el ritmo: cada frame JPEG se anota con CUÁNTO
 * debe durar en pantalla (el tiempo hasta el frame siguiente, o hasta que se detiene la
 * grabación para el último), y el demuxer `concat` arma con eso una línea de tiempo a ritmo
 * variable que después se fuerza a fps constante (`-r`). Ahí es donde ffmpeg repite el
 * último frame en los huecos — no hace falta duplicar archivos a mano.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ff } from './ffmpeg.mjs';

const CALIDAD_DEFECTO = 90;   // calidad JPEG (0-100) del screencast; alta, porque el texto es lo que se cuida
const FPS_DEFECTO = 25;       // fps de salida del video ya montado a ritmo constante
const DURACION_MINIMA_SEG = 1 / 60;   // piso para que ffmpeg nunca vea una duración cero o negativa

/**
 * Arranca la grabación de `page` por CDP y devuelve `{ detener }`.
 *
 * `detener()` cierra el screencast, encodea lo capturado a `salida` (la ruta completa del
 * archivo de video, no un directorio) y devuelve esa misma ruta. Es seguro llamarlo aunque
 * no haya llegado ningún frame todavía (por ejemplo, un paso que revienta apenas empieza):
 * en ese caso arma un video de un solo frame en negro, para que la pista quede legible en
 * vez de faltante.
 *
 * @param {import('playwright').Page} page
 * @param {{ ancho:number, alto:number, salida:string, calidad?:number, fps?:number }} opciones
 * @returns {Promise<{ detener: () => Promise<string> }>}
 */
export async function iniciarGrabacion(page, { ancho, alto, salida, calidad = CALIDAD_DEFECTO, fps = FPS_DEFECTO }) {
    const cdp = await page.context().newCDPSession(page);
    const dirFrames = mkdtempSync(join(tmpdir(), 'demo-frames-'));
    const frames = [];        // { archivo, t } — t en ms desde que arrancó la grabación (t0)
    const pendientes = new Set();   // promesas de frames en proceso (escritura + ack), para drenar en detener()
    let indice = 0;
    let detenido = false;

    async function procesar({ data, sessionId }) {
        const t = Date.now() - t0;
        const archivo = join(dirFrames, `f-${String(indice++).padStart(6, '0')}.jpg`);
        writeFileSync(archivo, Buffer.from(data, 'base64'));
        frames.push({ archivo, t });
        // El ack es obligatorio: sin él, CDP deja de mandar frames nuevos después del primero.
        await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    }

    cdp.on('Page.screencastFrame', (evento) => {
        if (detenido) return;
        const promesa = procesar(evento).catch(() => {});
        pendientes.add(promesa);
        promesa.finally(() => pendientes.delete(promesa));
    });

    // El reloj arranca ACÁ, no con el primer frame: bajo carga, ese primer frame puede tardar
    // cientos de ms en llegar (ver docstring del módulo), y si t0 se fijara recién ahí, todo
    // ese tramo inicial quedaría fuera de la cuenta — el video saldría más corto que el tiempo
    // real cubierto y desalinearía voz/subtítulos, que se ajustan por segundos transcurridos.
    const t0 = Date.now();
    await cdp.send('Page.startScreencast', {
        format: 'jpeg',
        quality: calidad,
        maxWidth: ancho,
        maxHeight: alto,
        everyNthFrame: 1,
    });

    return {
        async detener() {
            detenido = true;
            const finT = Date.now() - t0;
            await cdp.send('Page.stopScreencast').catch(() => {});
            // Drena los frames que ya estaban en vuelo (escritos antes de `detenido`, pero
            // con el ack todavía pendiente) antes de armar la línea de tiempo final.
            await Promise.all([...pendientes]);
            try {
                return construirVideo(frames, { dirFrames, salida, ancho, alto, fps, finT });
            } finally {
                rmSync(dirFrames, { recursive: true, force: true });
            }
        },
    };
}

/**
 * Arma, a partir de los frames JPEG con marca de tiempo, un video a fps constante.
 *
 * Cada frame dura hasta que llega el siguiente; el último dura hasta `finT` (el instante en
 * que se pidió detener la grabación). El demuxer `concat` de ffmpeg, con esas duraciones
 * explícitas, entiende el ritmo real; forzar `-r fps` a la salida es lo que convierte eso
 * en fps constante, repitiendo frames en los tramos quietos.
 *
 * El PRIMER frame es un caso especial: `frames[0].t` no es 0 sino el tiempo que tardó en
 * llegar el primer aviso de CDP desde que arrancó la grabación (t0). Ese tramo inicial ya
 * pasó en pantalla —tal como se veía al llegar el frame, porque nada cambió antes—, así que
 * se sostiene el primer frame desde el instante cero en vez de arrancar recién en `frames[0].t`.
 * De lo contrario ese tramo desaparecería del video (más corto que lo realmente grabado).
 */
function construirVideo(frames, { dirFrames, salida, ancho, alto, fps, finT }) {
    if (frames.length === 0) {
        // Nunca llegó un frame (por ejemplo, la página reventó antes del primer repintado).
        // Se arma un video negro de un instante, para que la pista exista y sea legible en
        // vez de que el montaje se encuentre con un archivo faltante.
        ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${ancho}x${alto}:d=${DURACION_MINIMA_SEG}`,
            '-r', String(fps), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', salida]);
        return salida;
    }

    const lista = join(dirFrames, 'lista.txt');
    const linea = [];
    for (let i = 0; i < frames.length; i++) {
        const actual = frames[i];
        const inicioT = i === 0 ? 0 : actual.t;   // el primer frame se sostiene desde t=0
        const siguienteT = i + 1 < frames.length ? frames[i + 1].t : finT;
        const duracionSeg = Math.max((siguienteT - inicioT) / 1000, DURACION_MINIMA_SEG);
        linea.push(`file '${actual.archivo}'`);
        linea.push(`duration ${duracionSeg.toFixed(3)}`);
    }
    // El demuxer concat ignora el `duration` del último bloque salvo que el archivo se repita
    // una vez más sin duración: es la forma documentada de que la duración del ÚLTIMO frame
    // (el que queda en pantalla hasta que se detiene la grabación) se respete de verdad.
    linea.push(`file '${frames[frames.length - 1].archivo}'`);
    writeFileSync(lista, linea.join('\n'));

    ff(['-y', '-f', 'concat', '-safe', '0', '-i', lista,
        '-vf', `scale=${ancho}:${alto}:force_original_aspect_ratio=decrease,pad=${ancho}:${alto}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`,
        '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', salida]);
    return salida;
}
