import { basename, join } from 'node:path';
import { ff } from './ffmpeg.mjs';

const DIMENSIONES = { vertical: { ancho: 1080, alto: 1920 }, cuadrado: { ancho: 1080, alto: 1080 } };

/**
 * Variante para redes: el mismo video centrado sobre una copia suya agrandada y desenfocada.
 * Recortar a 9:16 dejaba ~560 px de un panel de 1600: ilegible. Con fondo desenfocado se ve
 * todo el contenido y el formato no tiene franjas negras. Audio, subtítulos y capítulos se
 * copian sin tocar (`-map 0`, `-c:a copy`, `-c:s copy`).
 */
export function variante(mp4, { formato, salida }) {
    const d = DIMENSIONES[formato];
    if (!d) throw new Error(`formato "${formato}" desconocido: vertical o cuadrado`);
    const destino = join(salida, basename(mp4).replace(/\.mp4$/, `-${formato}.mp4`));
    const filtro = `[0:v]split[a][b];` +
        `[a]scale=${d.ancho}:${d.alto}:force_original_aspect_ratio=increase,crop=${d.ancho}:${d.alto},boxblur=30:3,eq=brightness=-0.15[fondo];` +
        `[b]scale=${d.ancho}:${d.alto}:force_original_aspect_ratio=decrease[frente];` +
        `[fondo][frente]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]`;
    ff(['-y', '-i', mp4, '-filter_complex', filtro, '-map', '[v]', '-map', '0:a?', '-map', '0:s?',
        '-map_chapters', '0', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'copy', '-c:s', 'copy',
        '-movflags', '+faststart', destino]);
    return destino;
}
