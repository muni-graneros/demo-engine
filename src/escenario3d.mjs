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
export async function renderizarTransicion({ mp4, desdeSeg, salida, presentacion, marca = null, fps = 25 }) {
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
        await conPagina({ '/escena.html': PLANTILLA, '/cap.mp4': mp4 }, async (page, baseUrl) => {
            await page.setViewportSize({ width: ancho, height: alto });
            await page.goto(baseUrl + '/escena.html');
            await page.waitForFunction(() => typeof window.__preparar === 'function');
            // El fondo sale de la MISMA función que usa el marco: si acá se resolviera aparte
            // (antes: `presentacion.fondo ?? '#0f172a'`), con el defecto `fondo:null` el video
            // saltaba del gradiente de marca al gris en cada transición.
            await page.evaluate((args) => window.__preparar(args),
                { ancho, alto, src: '/cap.mp4', fondo: fondoDelMarco(presentacion, marca) });

            for (let i = 0; i < total; i++) {
                await page.evaluate((args) => window.__frame(args), {
                    t: desdeSeg + i / fps,
                    p: total === 1 ? 1 : i / (total - 1),
                    gradosMax,
                });
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
