import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ff, duracion } from './ffmpeg.mjs';
import { construirLineaDeTiempo } from './linea-tiempo.mjs';
import { generarVtt, generarSrt } from './subtitulos.mjs';

/**
 * Corta cada pista en los tramos que le corresponden, los ordena por tiempo global,
 * los pega, y le suma la voz y los subtítulos.
 */
export async function montar({ pistas, pasos, voz, video }, { salida, nombre = 'demo.mp4' }) {
    mkdirSync(salida, { recursive: true });
    const linea = construirLineaDeTiempo(pasos);
    const temporal = join(salida, '.tmp');
    mkdirSync(temporal, { recursive: true });

    // 1. Cortar. Cada segmento sale como un mp4 normalizado, para que el concat no discuta.
    //
    // Un tramo puede pasarse del final de su pista: la grabación de un actor se cierra justo
    // después de su último paso, así que por redondeo el último tramo suele desbordar unos
    // milisegundos. Reventar por eso sería absurdo, pero ignorarlo es peor: ffmpeg recorta
    // el trozo en silencio y el video queda MÁS CORTO de lo que dice el guion, con lo que
    // los subtítulos y la voz apuntan a tiempos que ya no existen. Por eso se recorta de
    // forma explícita y se usa el largo REAL para todo lo que viene después.
    const TOLERANCIA_SEG = 0.25;
    const trozos = [];
    const recortados = [];
    const largos = new Map();
    for (const [i, seg] of linea.entries()) {
        const pista = pistas[seg.actor];
        if (!pista) throw new Error(`no hay pista grabada para el actor "${seg.actor}"`);
        if (!largos.has(seg.actor)) largos.set(seg.actor, duracion(pista));
        const largo = largos.get(seg.actor);

        if (seg.desdeSeg >= largo) {
            throw new Error(`el tramo "${seg.escena}" empieza en ${seg.desdeSeg}s, fuera de la pista de ${seg.actor} (${largo}s)`);
        }
        const desborde = seg.hastaSeg - largo;
        if (desborde > TOLERANCIA_SEG) {
            throw new Error(`el tramo "${seg.escena}" termina en ${seg.hastaSeg}s y la pista de ${seg.actor} dura ${largo}s: se perderían ${desborde.toFixed(2)}s y los subtítulos quedarían desfasados`);
        }
        const hasta = Math.min(seg.hastaSeg, largo);
        recortados.push({ ...seg, hastaSeg: hasta });

        const trozo = join(temporal, `trozo-${String(i).padStart(3, '0')}.mp4`);
        ff(['-y', '-i', pista, '-ss', String(seg.desdeSeg), '-to', String(hasta),
            '-vf', `scale=${video.ancho}:${video.alto},setsar=1`,
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', trozo]);
        trozos.push(trozo);
    }

    // 2. Pegar en orden narrativo.
    const mudo = join(temporal, 'mudo.mp4');
    const lista = join(temporal, 'lista.txt');
    writeFileSync(lista, trozos.map((t) => `file '${t}'`).join('\n'));
    ff(['-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', mudo]);

    // 3. Recalcular los tiempos: ahora cada segmento vive en el reloj del video final.
    let reloj = 0;
    const segmentos = recortados.map((seg) => {
        const dura = seg.hastaSeg - seg.desdeSeg;
        const s = { inicioSeg: reloj, finSeg: reloj + dura, narrar: seg.narrar, escena: seg.escena, wav: seg.wav };
        reloj += dura;
        return s;
    });

    // 4. Subtítulos: archivo al lado (para la web) y pista blanda dentro del MP4.
    const vtt = join(salida, `${nombre.replace(/\.mp4$/, '')}.vtt`);
    const srt = join(temporal, 'subtitulos.srt');
    const textoVtt = generarVtt(segmentos);
    const textoSrt = generarSrt(segmentos);
    writeFileSync(vtt, textoVtt);
    writeFileSync(srt, textoSrt);
    const haySubtitulos = segmentos.some((s) => s.narrar?.trim());

    // 5. Voz: una locución por segmento, retrasada hasta su marca, sobre una base de
    //    silencio del largo exacto del video (fija la duración y cubre los huecos).
    const mp4 = resolve(salida, nombre);
    const total = duracion(mudo);
    const entradas = ['-y', '-i', mudo, '-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=22050:cl=mono'];
    const filtros = [];
    const mezclas = ['[1:a]'];
    let idx = 2;

    if (voz.disponible()) {
        for (const seg of segmentos) {
            if (!seg.narrar) continue;
            // El grabador ya sintetizó esta locución y dejó su ruta en el segmento: se
            // reutiliza. Sintetizar de nuevo duplicaría el paso más caro del pipeline.
            const wav = seg.wav ?? voz.sintetizar(seg.narrar);
            if (!wav) continue;
            entradas.push('-i', wav);
            const ms = Math.round(seg.inicioSeg * 1000);
            filtros.push(`[${idx}:a]adelay=${ms}|${ms}[v${idx}]`);
            mezclas.push(`[v${idx}]`);
            idx++;
        }
    }

    const n = mezclas.length;
    // Si solo hay silencio puro (sin voz), pasar directo sin amix ni loudnorm.
    const cadena = (filtros.length ? filtros.join(';') + ';' : '') +
        (n === 1
            ? mezclas[0] + 'aformat=sample_rates=44100:channel_layouts=mono[a]'
            : mezclas.join('') + `amix=inputs=${n}:normalize=0[m];[m]loudnorm=I=-16:TP=-1.5:LRA=11[a]`);

    const cmd = [
        ...entradas,
        ...(haySubtitulos ? ['-i', srt] : []),
        '-filter_complex', cadena,
        '-map', '0:v', '-map', '[a]',
        ...(haySubtitulos ? ['-map', `${idx}:s`] : []),
        '-c:v', 'copy', '-c:a', 'aac',
        ...(haySubtitulos ? ['-c:s', 'mov_text', '-metadata:s:s:0', 'language=spa'] : []),
        '-movflags', '+faststart', mp4,
    ];
    ff(cmd);

    // Igual que en pegarCapitulos: limpia los intermedios (trozos, .srt, lista de concat)
    // para que la carpeta de salida solo tenga lo que el usuario quiere ver.
    rmSync(temporal, { recursive: true, force: true });

    return { mp4, vtt, segmentos };
}
