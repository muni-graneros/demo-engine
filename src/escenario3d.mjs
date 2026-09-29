import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conPagina } from './render-web.mjs';
import { fondoDelMarco } from './marco.mjs';
import { ff } from './ffmpeg.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
// Igual que el marco: interno del motor, servido desde el paquete y fuera de plantillas/,
// que es lo que `demo init` copia al proyecto del usuario.
const PLANTILLA = join(AQUI, 'escenario', 'escena.html');

/**
 * Corre un paso de la escena y, si falla, lo informa como falla de la transición 3D con su
 * motivo. Sin esto el error llegaba —cuando llegaba— como un `page.evaluate: Error: ...`
 * suelto, sin decir que era la transición ni qué hacer al respecto.
 */
async function enEscena(paso, accion) {
    try {
        return await accion();
    } catch (error) {
        const motivo = String(error?.message ?? error).split('\n')[0]
            .replace(/^page\.evaluate:\s*(Error:\s*)?/, '');
        throw new Error(`transición 3D: no se pudo ${paso}. ${motivo}. Si el navegador no `
            + 'decodifica el MP4 (p. ej. un Chromium sin H.264), desactivá '
            + '`video.presentacion.transicion3d.activa` o instalá el Chromium de Playwright.',
        { cause: error });
    }
}

/**
 * Renderiza la transición 3D de entrada a un capítulo, frame a frame.
 *
 * NO se graba el canvas en tiempo real, y esa es la decisión central: el screencast por CDP
 * emite a ritmo variable (ver src/pantalla.mjs), así que grabar una animación en vivo pierde
 * frames y desacopla la narración, que ya está montada contra el reloj del video. Fijando
 * `currentTime` y capturando de a un frame, la cantidad de frames es exacta por construcción.
 *
 * Medido en el equipo de referencia: ~94 ms por frame. Por eso solo pasan por acá las
 * transiciones y no el video completo.
 *
 * DEUDA CONOCIDA (no es la captura JPEG, se probó y no cambia nada): los MP4 del motor se
 * codifican sin etiqueta de colorspace (swscale usa BT.601) y Chromium decodifica HD como
 * BT.709: los colores 100% saturados llegan a la textura con un desvío de hasta ~40 niveles
 * en un canal (rojo puro → [255,24,0]). El arreglo es transversal —etiquetar/convertir a
 * BT.709 donde el motor codifica desde RGB (pantalla.mjs, presentacion.mjs, escenario3d.mjs)—
 * y queda fuera de esta rama.
 */
export async function renderizarTransicion({
    mp4, desdeSeg, salida, presentacion, marca = null, fps = 25, codecEscena = 'auto',
}) {
    const { ancho, alto } = presentacion.salida;
    const { ms, gradosMax } = presentacion.transicion3d;
    const total = Math.max(1, Math.round((ms / 1000) * fps));
    const dirFrames = mkdtempSync(join(tmpdir(), 'demo-3d-frames-'));

    // dirFrames vive en el tmp del SISTEMA, no dentro de `salida`: a diferencia de los
    // temporales de montaje.mjs (que quedan adentro de la carpeta de salida y se barren en
    // la corrida siguiente), acá nadie más los va a limpiar. Si `conPagina` o `ff` explotan
    // a mitad de camino, los JPEG intermedios quedan huérfanos para siempre. Por eso todo el
    // trabajo que los produce y consume va en try/finally: el clip solo se devuelve si todo
    // salió bien, pero la limpieza corre siempre, haya éxito o error.
    try {
        // El extracto VP9 se sirve desde dirFrames y se escribe SOLO si hace falta: el servidor
        // lee cada archivo al pedirlo, así que la ruta puede declararse antes de que exista.
        const extracto = join(dirFrames, 'cap.webm');
        await conPagina({ '/escena.html': PLANTILLA, '/cap.mp4': mp4, '/cap.webm': extracto }, async (page, baseUrl) => {
            await page.setViewportSize({ width: ancho, height: alto });
            await page.goto(baseUrl + '/escena.html');
            await page.waitForFunction(() => typeof window.__preparar === 'function');

            // Todos los MP4 del motor son H.264, y no todo Chromium lo decodifica: el de
            // algunos contenedores (build open source) devuelve canPlayType('avc1') vacío y el
            // <video> falla con DEMUXER_ERROR_NO_SUPPORTED_STREAMS. En ese caso la escena
            // recibe un extracto VP9 (libvpx viene en ffmpeg-static, VP9 lo decodifica
            // cualquier Chromium) del tramo que la transición necesita, sin pérdida para no
            // correr colores; el tiempo pasa a contarse desde el inicio del extracto.
            const sinH264 = codecEscena === 'vp9' || !(await page.evaluate(() =>
                document.createElement('video').canPlayType('video/mp4; codecs="avc1.64001F"')));
            let src = '/cap.mp4';
            let origen = desdeSeg;
            if (sinH264) {
                await enEscena(`preparar el extracto VP9 de ${mp4}`, async () => ff(['-y',
                    '-ss', String(desdeSeg), '-i', mp4, '-t', String(ms / 1000 + 1),
                    '-an', '-c:v', 'libvpx-vp9', '-lossless', '1', '-pix_fmt', 'yuv420p',
                    '-deadline', 'realtime', '-cpu-used', '8', extracto]));
                src = '/cap.webm';
                origen = 0;
            }
            // El fondo sale de la MISMA función que usa el marco: si acá se resolviera aparte
            // (antes: `presentacion.fondo ?? '#0f172a'`), con el defecto `fondo:null` el video
            // saltaba del gradiente de marca al gris en cada transición.
            await enEscena(`preparar la escena con ${mp4}`, () => page.evaluate((args) => window.__preparar(args),
                { ancho, alto, src, fondo: fondoDelMarco(presentacion, marca) }));

            for (let i = 0; i < total; i++) {
                await enEscena(`renderizar el frame ${i + 1}/${total}`, () => page.evaluate((args) => window.__frame(args), {
                    t: origen + i / fps,
                    p: total === 1 ? 1 : i / (total - 1),
                    gradosMax,
                }));
                await page.locator('canvas').screenshot({
                    path: join(dirFrames, `f-${String(i).padStart(5, '0')}.jpg`),
                    type: 'jpeg', quality: 92,
                });
            }
        });

        const clip = join(salida, `transicion-${Math.round(desdeSeg * 1000)}.mp4`);
        ff(['-y', '-framerate', String(fps), '-i', join(dirFrames, 'f-%05d.jpg'),
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(fps), clip]);
        return clip;
    } finally {
        rmSync(dirFrames, { recursive: true, force: true });
    }
}
