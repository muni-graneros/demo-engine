import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ff, duracion } from './ffmpeg.mjs';
import { capitulosConTiempos, ffmetadata, indiceMarkdown } from './capitulos.mjs';
import { generarVtt, generarSrt, parseVtt } from './subtitulos.mjs';

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

    // Subtítulos del curso: cada capítulo trae su .vtt al lado del clip (lo escribe
    // `montar()`, con `Subtitle: mov_text, spa` dentro del MP4). Antes, `pegarCapitulos` los
    // ignoraba del todo: el concat con `-c copy` arrastraba —cuando arrastraba algo— la pista
    // de subtítulos del PRIMER capítulo tal cual, SIN desplazar sus tiempos y perdiendo las
    // de los demás, y el .vtt del curso nunca se escribía. Acá se releen y combinan a mano,
    // desplazando cada cue por el inicio de SU capítulo (mismo offset que ya se usa para la
    // metadata de capítulos). Un capítulo sin .vtt propio —el video de teléfono, por
    // ejemplo— no aporta entradas, y eso está bien: no tiene narración que ofrecer.
    const segmentos = [];
    partes.forEach((parte, i) => {
        const vttCap = parte.archivo.replace(/\.mp4$/, '.vtt');
        if (!existsSync(vttCap)) return;
        const offset = capitulos[i].inicioSeg;
        for (const cue of parseVtt(readFileSync(vttCap, 'utf8'))) {
            segmentos.push({ inicioSeg: cue.inicioSeg + offset, finSeg: cue.finSeg + offset, narrar: cue.narrar });
        }
    });

    const lista = join(temporal, 'lista.txt');
    writeFileSync(lista, normalizados.map((a) => `file '${a}'`).join('\n'));
    const pegado = join(temporal, 'pegado.mp4');
    ff(['-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', pegado]);

    const meta = join(temporal, 'capitulos.txt');
    writeFileSync(meta, ffmetadata(capitulos));
    const mp4 = resolve(salida, nombre);
    let vtt = null;

    // `-map 0` es obligatorio en los dos mux de metadata: sin un `-map` explícito, ffmpeg
    // hace selección automática de streams sobre TODOS los inputs, y el archivo ffmetadata
    // (`meta`, texto plano) entra como si fuera un input más. Eso es justo lo que producía
    // el defecto reportado: una pista fantasma `Data: bin_data (text), eng` que ni ffmpeg
    // puede mapear como subtítulo — no venía del concat, venía de acá.
    if (segmentos.length > 0) {
        // Con subtítulos: la metadata de capítulos se mux primero a un intermedio, y recién
        // ahí se suma la pista `mov_text` en español — igual que hace `montar()` con la voz.
        const conCapitulos = join(temporal, 'con-capitulos.mp4');
        ff(['-y', '-i', pegado, '-i', meta, '-map_metadata', '1', '-map', '0', '-c', 'copy', conCapitulos]);

        vtt = resolve(salida, `${nombre.replace(/\.mp4$/, '')}.vtt`);
        const srt = join(temporal, 'curso.srt');
        writeFileSync(vtt, generarVtt(segmentos));
        writeFileSync(srt, generarSrt(segmentos));

        ff(['-y', '-i', conCapitulos, '-i', srt,
            '-map', '0:v', '-map', '0:a', '-map', '1:s',
            '-c:v', 'copy', '-c:a', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=spa',
            '-movflags', '+faststart', mp4]);
    } else {
        ff(['-y', '-i', pegado, '-i', meta, '-map_metadata', '1', '-map', '0', '-c', 'copy',
            '-movflags', '+faststart', mp4]);
    }

    const md = resolve(salida, nombre.replace(/\.mp4$/, '.md'));
    writeFileSync(md, indiceMarkdown(capitulos, titulo));

    return { mp4, md, capitulos, vtt };
}
