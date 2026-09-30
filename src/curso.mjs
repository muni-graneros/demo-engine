import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ff, duracion } from './ffmpeg.mjs';
import { capitulosConTiempos, ffmetadata, indiceMarkdown } from './capitulos.mjs';
import { generarVtt, generarSrt, parseVtt } from './subtitulos.mjs';
import { renderizarTransicion } from './escenario3d.mjs';

/**
 * Filtro de escala+relleno+fps compartido por la normalización de cada capítulo y por la
 * normalización de cada transición: ambas tienen que terminar con la misma resolución, mismo
 * fondo de letterbox y mismo fps, o el concat final los pega con un salto visible.
 */
function filtroNormalizar(lienzo) {
    return `scale=${lienzo.ancho}:${lienzo.alto}:force_original_aspect_ratio=decrease,` +
           `pad=${lienzo.ancho}:${lienzo.alto}:(ow-iw)/2:(oh-ih)/2:color=#0f172a,setsar=1,fps=25`;
}

/**
 * Normaliza un clip MUDO (transición 3D o tarjeta de superficies) al formato de los
 * capítulos: mismo lienzo y fps, y una pista de silencio para que el concat con `-c copy`
 * encuentre en todos los trozos los mismos streams.
 *
 * El largo se fija con `-t` = duración del video de entrada, NO con `-shortest`. Con
 * `-shortest` el silencio (infinito) lo cortaba ffmpeg recién cuando el muxer se enteraba de
 * que el video había terminado, y libx264 retiene cuadros en su lookahead: el audio salía
 * entre 0,15 y 0,6 s MÁS LARGO que el video, variando de corrida en corrida según cómo se
 * repartieran los hilos. Ese sobrante alargaba el trozo, el concat lo pegaba como un cuadro
 * congelado, y corría el marcador y las cues de todos los capítulos siguientes. Era la causa
 * de que «los marcadores de capítulo incluyen su transición» fallara (a veces sí, a veces no).
 */
function normalizarMudo(entrada, destino, lienzo) {
    const dura = duracion(entrada);
    ff(['-y', '-i', entrada,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
        '-map', '0:v', '-map', '1:a', '-t', String(dura),
        '-vf', filtroNormalizar(lienzo),
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', destino]);
    return destino;
}

/**
 * Une clips ya montados en un solo video-curso, con portada por capítulo ya incluida en
 * cada clip, metadata de capítulos e índice en markdown.
 *
 * Cada parte puede traer `tarjeta`: un mp4 MUDO (la tarjeta de superficies, «usted está
 * aquí») que entra DESPUÉS de la transición 3D y ANTES del clip.
 *
 * @param {Array<{id:string,titulo:string,archivo:string,tarjeta?:string}>} partes
 */
export async function pegarCapitulos(partes, { salida, nombre = 'curso.mp4', titulo, video, presentacion = null, marca = null }) {
    mkdirSync(salida, { recursive: true });
    // El lienzo del curso es el de la PRESENTACIÓN cuando está activa. Con presentación,
    // `montar()` ya devolvió cada capítulo compuesto en `presentacion.salida` (1920x1080 por
    // defecto); normalizar contra `video` (1600x1000) los bajaba de resolución Y les metía
    // letterbox, porque los aspectos no coinciden. Una sola resolución de curso, sin
    // re-escalado destructivo.
    const lienzo = presentacion ? presentacion.salida : video;
    // Se limpia de entrada: si no, cada corrida deja sus trozos y los de la anterior
    // conviven con los nuevos.
    const temporal = join(salida, '.tmp-curso');
    rmSync(temporal, { recursive: true, force: true });
    mkdirSync(temporal, { recursive: true });

    // Normalizar: los clips vienen de fuentes distintas (grabaciones y video de teléfono),
    // así que sin igualar resolución, fps y audio el concat produce basura. El audio va a
    // estéreo 48 kHz: es el formato de la mezcla nueva (`mezcla.mjs`), y bajar un capítulo
    // con música a 44,1 kHz para volver a subirlo no aporta nada.
    const normalizados = partes.map((parte, i) => {
        const destino = join(temporal, `cap-${String(i).padStart(2, '0')}.mp4`);
        ff(['-y', '-i', parte.archivo,
            '-vf', filtroNormalizar(lienzo),
            '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-ar', '48000', '-ac', '2', destino]);
        return destino;
    });

    // Transición 3D de ENTRADA a cada capítulo, salvo el primero: el video no puede empezar
    // con un movimiento de cámara sobre nada.
    //
    // La transición se contabiliza como parte del capítulo que ENTRA, y eso no es un detalle
    // estético: `capitulosConTiempos` recibe una duración por parte, y el marcador de cada
    // capítulo (`capitulos[i].inicioSeg`) cae correctamente al INICIO DE LA TRANSICIÓN — así,
    // saltar a un capítulo muestra su entrada. Si la transición se contara aparte, cada
    // capítulo a partir del segundo quedaría corrido contra sus propios subtítulos.
    //
    // Pero el CONTENIDO real del capítulo (y por lo tanto sus cues de subtítulos, que vienen
    // en tiempos relativos al clip original) arranca DESPUÉS de la transición, no en el mismo
    // punto que el marcador. Por eso se guarda aparte, por capítulo, cuánto hay antes del
    // clip (`antesDelClip`: transición + tarjeta, 0 para el primero sin tarjeta): el offset
    // de los cues es `inicioSeg + antesDelClip[i]`, no `inicioSeg` a secas.
    //
    // La tarjeta de superficies sigue la misma regla: es del capítulo que entra. Y la
    // transición se renderiza sobre la TARJETA cuando la hay, no sobre el clip: lo que el
    // movimiento de cámara trae a pantalla tiene que ser lo que se ve justo después; si
    // girara el primer cuadro del clip, al terminar saltaría a la tarjeta y de vuelta al clip.
    const conTransiciones = [];
    const duraciones = [];
    const antesDelClip = [];
    for (const [i, archivo] of normalizados.entries()) {
        const tarjeta = partes[i].tarjeta
            ? normalizarMudo(partes[i].tarjeta, join(temporal, `tarjeta-${String(i).padStart(2, '0')}.mp4`), lienzo)
            : null;
        const piezas = [];
        if (i > 0 && presentacion?.transicion3d?.activa) {
            const transicion = await renderizarTransicion({
                mp4: tarjeta ?? archivo, desdeSeg: 0, salida: temporal, presentacion, marca, fps: 25,
            });
            piezas.push(normalizarMudo(transicion, join(temporal, `trans-${String(i).padStart(2, '0')}.mp4`), lienzo));
        }
        if (tarjeta) piezas.push(tarjeta);
        const previo = piezas.reduce((s, p) => s + duracion(p), 0);
        conTransiciones.push(...piezas, archivo);
        duraciones.push(previo + duracion(archivo));
        antesDelClip.push(previo);
    }
    const capitulos = capitulosConTiempos(partes.map(({ id, titulo }) => ({ id, titulo })), duraciones);

    // Subtítulos del curso: cada capítulo trae su .vtt al lado del clip (lo escribe
    // `montar()`, con `Subtitle: mov_text, spa` dentro del MP4). Antes, `pegarCapitulos` los
    // ignoraba del todo: el concat con `-c copy` arrastraba —cuando arrastraba algo— la pista
    // de subtítulos del PRIMER capítulo tal cual, SIN desplazar sus tiempos y perdiendo las
    // de los demás, y el .vtt del curso nunca se escribía. Acá se releen y combinan a mano,
    // desplazando cada cue por el inicio del CONTENIDO de SU capítulo — que no es lo mismo
    // que `capitulos[i].inicioSeg` cuando hay transición o tarjeta: ese offset marca el inicio
    // de lo que entra primero, no el del clip. Sumar `antesDelClip[i]` es lo que alinea la cue (en
    // tiempo relativo al clip original) con dónde ese clip realmente arranca en el video
    // final. Un capítulo sin .vtt propio —el video de teléfono, por ejemplo— no aporta
    // entradas, y eso está bien: no tiene narración que ofrecer.
    const segmentos = [];
    partes.forEach((parte, i) => {
        const vttCap = parte.archivo.replace(/\.mp4$/, '.vtt');
        if (!existsSync(vttCap)) return;
        const offset = capitulos[i].inicioSeg + antesDelClip[i];
        for (const cue of parseVtt(readFileSync(vttCap, 'utf8'))) {
            segmentos.push({ inicioSeg: cue.inicioSeg + offset, finSeg: cue.finSeg + offset, narrar: cue.narrar });
        }
    });

    const lista = join(temporal, 'lista.txt');
    writeFileSync(lista, conTransiciones.map((a) => `file '${a}'`).join('\n'));
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
