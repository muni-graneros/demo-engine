import { ff } from './ffmpeg.mjs';

/**
 * Tamaño del lienzo del montaje por superficie. Con presentación es su salida (1920×1080 por
 * defecto), para que el curso pueda seguir pegando capítulos y su transición 3D sobre un
 * tamaño único; sin presentación, el del video grabado, igual que el camino de siempre.
 */
export function lienzoDe({ presentacion, video }) {
    return presentacion ? presentacion.salida : { ancho: video.ancho, alto: video.alto };
}

/**
 * Compone uno o dos tramos de pista dentro del lienzo y escribe un mp4 MUDO del tamaño del
 * lienzo. El orden es el mismo de la presentación (y por la misma razón): fondo negro,
 * videos en sus huecos, PNG del lienzo ENCIMA — el PNG trae el hueco transparente con
 * esquinas antialias, así que tapa el sobrante rectangular del video sin recortes con alfa
 * binario.
 *
 * `force_original_aspect_ratio=decrease` + `pad` y no un `scale` a secas: un teléfono cuyo
 * aspecto no calza exacto con su hueco (el hueco se redondea a par, o el dispositivo cambió)
 * saldría estirado. Con relleno negro las franjas leen como pantalla apagada.
 *
 * El largo lo fija la PRIMERA entrada (el actor del segmento, que es quien manda en el
 * relato) a través del fondo `color` de esa duración. Las demás entradas pueden venir un
 * poco más cortas —el otro actor de un tramo dividido se recorta a su pista—: por eso sus
 * overlays NO usan `shortest=1` sino `eof_action=repeat`, que congela su último cuadro. Con
 * `shortest=1` ese recorte acortaba el tramo entero y el reloj del video se corría respecto
 * de la voz y los subtítulos.
 *
 * `fps=25` en cada entrada: el concat posterior copia los trozos sin reencodear, y exige
 * que todos compartan tamaño, códec y cadencia.
 *
 * @param {Array<{mp4:string, desdeSeg:number, hastaSeg:number}>} entradas
 * @param {{png:string, huecos:Array<{x:number,y:number,ancho:number,alto:number}>, lienzo:{ancho:number,alto:number}, salida:string}} destino
 * @returns {string} la ruta de `salida`
 */
export function componerEnLienzo(entradas, { png, huecos, lienzo, salida }) {
    if (entradas.length !== huecos.length) {
        throw new Error(`componerEnLienzo: ${entradas.length} entradas para ${huecos.length} huecos`);
    }
    const dura = entradas[0].hastaSeg - entradas[0].desdeSeg;
    const args = ['-y'];
    for (const e of entradas) args.push('-ss', String(e.desdeSeg), '-t', String(e.hastaSeg - e.desdeSeg), '-i', e.mp4);
    args.push('-i', png);
    const f = [`color=c=black:s=${lienzo.ancho}x${lienzo.alto}:r=25:d=${dura}[b0]`];
    entradas.forEach((_, i) => {
        const h = huecos[i];
        f.push(`[${i}:v]scale=${h.ancho}:${h.alto}:force_original_aspect_ratio=decrease,`
            + `pad=${h.ancho}:${h.alto}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25[e${i}]`);
        f.push(`[b${i}][e${i}]overlay=${h.x}:${h.y}:eof_action=repeat[b${i + 1}]`);
    });
    const n = entradas.length;
    f.push(`[${n}:v]scale=${lienzo.ancho}:${lienzo.alto}[marco]`);
    f.push(`[b${n}][marco]overlay=0:0,format=yuv420p[v]`);
    ff([...args, '-filter_complex', f.join(';'), '-map', '[v]', '-t', String(dura),
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', salida]);
    return salida;
}
