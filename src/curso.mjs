import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ff, duracion } from './ffmpeg.mjs';
import { capitulosConTiempos, ffmetadata, indiceMarkdown } from './capitulos.mjs';

/**
 * Une clips ya montados en un solo video-curso, con portada por capítulo ya incluida en
 * cada clip, metadata de capítulos e índice en markdown.
 *
 * @param {Array<{id:string,titulo:string,archivo:string}>} partes
 */
export async function pegarCapitulos(partes, { salida, nombre = 'curso.mp4', titulo, video }) {
    mkdirSync(salida, { recursive: true });
    // Se limpia de entrada: si no, cada corrida deja sus trozos y los de la anterior
    // conviven con los nuevos.
    const temporal = join(salida, '.tmp-curso');
    rmSync(temporal, { recursive: true, force: true });
    mkdirSync(temporal, { recursive: true });

    // Normalizar: los clips vienen de fuentes distintas (grabaciones y video de teléfono),
    // así que sin igualar resolución, fps y audio el concat produce basura.
    const normalizados = partes.map((parte, i) => {
        const destino = join(temporal, `cap-${String(i).padStart(2, '0')}.mp4`);
        ff(['-y', '-i', parte.archivo,
            '-vf', `scale=${video.ancho}:${video.alto}:force_original_aspect_ratio=decrease,` +
                   `pad=${video.ancho}:${video.alto}:(ow-iw)/2:(oh-ih)/2:color=#0f172a,setsar=1,fps=25`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '44100', '-ac', '2', destino]);
        return destino;
    });

    const duraciones = normalizados.map((a) => duracion(a));
    const capitulos = capitulosConTiempos(partes.map(({ id, titulo }) => ({ id, titulo })), duraciones);

    const lista = join(temporal, 'lista.txt');
    writeFileSync(lista, normalizados.map((a) => `file '${a}'`).join('\n'));
    const pegado = join(temporal, 'pegado.mp4');
    ff(['-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', pegado]);

    const meta = join(temporal, 'capitulos.txt');
    writeFileSync(meta, ffmetadata(capitulos));
    const mp4 = resolve(salida, nombre);
    ff(['-y', '-i', pegado, '-i', meta, '-map_metadata', '1', '-c', 'copy',
        '-movflags', '+faststart', mp4]);

    const md = resolve(salida, nombre.replace(/\.mp4$/, '.md'));
    writeFileSync(md, indiceMarkdown(capitulos, titulo));

    return { mp4, md, capitulos };
}
