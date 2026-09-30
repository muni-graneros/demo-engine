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
 * El largo es `duracion`, EXPLÍCITO: el del segmento del relato, que es de donde salen la
 * voz, los subtítulos y los clics. No se deduce de ninguna entrada porque el actor del paso
 * no siempre es la primera —un `dividir` sigue vigente en los pasos siguientes de la escena,
 * y el par conserva su orden— y el otro actor puede venir recortado a su pista. Lo fija el
 * fondo `color` de esa duración más el `-t` de salida; los overlays de las entradas NO usan
 * `shortest=1` sino `eof_action=repeat`, que congela el último cuadro de una entrada corta.
 * Con `shortest=1` ese recorte acortaba el tramo entero y el reloj del video se corría.
 *
 * `fps=25` en cada entrada: el concat posterior copia los trozos sin reencodear, y exige
 * que todos compartan tamaño, códec y cadencia.
 *
 * @param {Array<{mp4:string, desdeSeg:number, hastaSeg:number}>} entradas
 * @param {{png:string, huecos:Array<{x:number,y:number,ancho:number,alto:number}>, lienzo:{ancho:number,alto:number}, salida:string, duracion:number}} destino
 * @returns {string} la ruta de `salida`
 */
export function componerEnLienzo(entradas, { png, huecos, lienzo, salida, duracion }) {
    if (!(duracion > 0)) throw new Error(`componerEnLienzo: falta la duracion del tramo (llegó ${duracion})`);
    if (entradas.length !== huecos.length) {
        throw new Error(`componerEnLienzo: ${entradas.length} entradas para ${huecos.length} huecos`);
    }
    const dura = duracion;
    const args = ['-y'];
    for (const e of entradas) args.push('-ss', String(e.desdeSeg), '-t', String(e.hastaSeg - e.desdeSeg), '-i', e.mp4);
    args.push('-i', png);
    const f = [`color=c=black:s=${lienzo.ancho}x${lienzo.alto}:r=25:d=${dura}[b0]`];
    entradas.forEach((_, i) => {
        const h = huecos[i];
        // `start_time=0` en el `fps`: el tramo se corta en un ms arbitrario de la pista (donde
        // empezó el paso), casi nunca en el borde de un cuadro de 40 ms, así que tras `-ss` el
        // primer cuadro decodificado llega unos ms DESPUÉS del cero. Sin esto el `fps` lo
        // redondeaba al cuadro 1 y el overlay dejaba ver el fondo negro en el cuadro 0: un
        // destello de un cuadro negro al empezar tramos (G8-01, 61 en un tutorial de 28 min,
        // casi siempre al cambiar de actor o de página, que es donde cae un corte). Con
        // `start_time=0` el `fps` rellena ese hueco repitiendo el primer cuadro REAL del tramo.
        f.push(`[${i}:v]scale=${h.ancho}:${h.alto}:force_original_aspect_ratio=decrease,`
            + `pad=${h.ancho}:${h.alto}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25:start_time=0[e${i}]`);
        f.push(`[b${i}][e${i}]overlay=${h.x}:${h.y}:eof_action=repeat[b${i + 1}]`);
    });
    const n = entradas.length;
    f.push(`[${n}:v]scale=${lienzo.ancho}:${lienzo.alto}[marco]`);
    f.push(`[b${n}][marco]overlay=0:0,format=yuv420p[v]`);
    ff([...args, '-filter_complex', f.join(';'), '-map', '[v]', '-t', String(dura),
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', salida]);
    return salida;
}
