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
 * La captura de cada frame es PNG, no JPEG: el JPEG intermedio hace su propio submuestreo
 * de croma (4:2:0) antes de que el encode final a h264 haga el suyo, y ese doble
 * submuestreo deja residuo de color en colores saturados (medido: rojo 253,0,0 → 254,24,0)
 * que se nota como salto al cortar hacia el clip real del capítulo. PNG es sin pérdida, así
 * que solo queda el submuestreo del encode final, igual que en cualquier otro video del motor.
 *
 * Medido en el equipo de referencia: ~94 ms por frame con JPEG; con PNG el costo por frame
 * sube (canvas más grande cuesta más: ~36% en una transición de 900 ms a 1600x1000), pero
 * sigue siendo aceptable porque solo pasan por acá las transiciones y no el video completo.
 */
export async function renderizarTransicion({ mp4, desdeSeg, salida, presentacion, marca = null, fps = 25 }) {
    const { ancho, alto } = presentacion.salida;
    const { ms, gradosMax } = presentacion.transicion3d;
    const total = Math.max(1, Math.round((ms / 1000) * fps));
    const dirFrames = mkdtempSync(join(tmpdir(), 'demo-3d-frames-'));

    // dirFrames vive en el tmp del SISTEMA, no dentro de `salida`: a diferencia de los
    // temporales de montaje.mjs (que quedan adentro de la carpeta de salida y se barren en
    // la corrida siguiente), acá nadie más los va a limpiar. Si `conPagina` o `ff` explotan
    // a mitad de camino, los PNG intermedios quedan huérfanos para siempre. Por eso todo el
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
                    path: join(dirFrames, `f-${String(i).padStart(5, '0')}.png`),
                    type: 'png',
                });
            }
        });

        const clip = join(salida, `transicion-${Math.round(desdeSeg * 1000)}.mp4`);
        ff(['-y', '-framerate', String(fps), '-i', join(dirFrames, 'f-%05d.png'),
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(fps), clip]);
        return clip;
    } finally {
        rmSync(dirFrames, { recursive: true, force: true });
    }
}
