import { ff } from './ffmpeg.mjs';
import { geometria } from './marco.mjs';

/**
 * Construye la cadena de `filter_complex` que mete el video dentro del marco.
 *
 * El orden importa y no es negociable: primero el video sobre el fondo, y el marco ENCIMA.
 * El PNG del marco lleva las esquinas opacas, así que al ir último tapa el sobrante
 * rectangular del video. Si se invirtiera el orden habría que recortar el video con `geq`,
 * que es justo lo que estamos evitando (su alfa es binario y deja escalón).
 *
 * Entradas esperadas por `componer`: [0] el video, [1] el PNG del marco.
 */
export function cadenaDePresentacion(presentacion) {
    const { ancho, alto } = presentacion.salida;
    const g = geometria(presentacion);
    return [
        `color=c=black:s=${ancho}x${alto}[fondo]`,
        // `force_original_aspect_ratio=decrease` + `pad` en vez de un `scale` a secas: con los
        // defectos documentados (video 1600x1000 dentro de un hueco de 1760x882) un escalado
        // directo estiraba la grabación un 24,7% en horizontal — un cuadrado salía con aspecto
        // 1,995. El relleno va negro porque el hueco es la "pantalla" de la ventana: unas franjas
        // negras leen como pantalla apagada, y además coinciden con el fondo del compuesto.
        `[0:v]scale=${g.ancho}:${g.alto}:force_original_aspect_ratio=decrease,`
            + `pad=${g.ancho}:${g.alto}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[video]`,
        `[fondo][video]overlay=${g.x}:${g.y}:shortest=1[conVideo]`,
        `[1:v]scale=${ancho}:${alto}[marco]`,
        `[conVideo][marco]overlay=0:0,format=yuv420p[salida]`,
    ].join(';');
}

/**
 * Compone `mp4Entrada` dentro de `marcoPng` y escribe `mp4Salida`.
 *
 * `shortest=1` en el primer overlay detiene la generación de la fuente lavfi infinita
 * (`color`) cuando termina el video de entrada. Sin eso el encodeo no finaliza nunca.
 * El flag `-shortest` es un cinturón de seguridad redundante.
 */
export function componer(mp4Entrada, marcoPng, mp4Salida, presentacion) {
    ff(['-y', '-i', mp4Entrada, '-i', marcoPng,
        '-filter_complex', cadenaDePresentacion(presentacion),
        '-map', '[salida]', '-shortest',
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', mp4Salida]);
    return mp4Salida;
}
