/**
 * Los subtítulos salen como ARCHIVO, no quemados en el video: así se pueden apagar, el
 * texto es seleccionable y la wiki puede indexarlo. El MP4 solo admite `mov_text` como
 * pista blanda (sin estilos), y por eso además se emite un .vtt para el reproductor web.
 */

function reloj(segundos, separadorDecimal) {
    const h = Math.floor(segundos / 3600);
    const m = Math.floor((segundos % 3600) / 60);
    const s = Math.floor(segundos % 60);
    const ms = Math.round((segundos - Math.floor(segundos)) * 1000);
    const dos = (n) => String(n).padStart(2, '0');
    return `${dos(h)}:${dos(m)}:${dos(s)}${separadorDecimal}${String(ms).padStart(3, '0')}`;
}

const conNarracion = (segmentos) => segmentos.filter((s) => s.narrar?.trim());

/** @param {Array<{inicioSeg:number,finSeg:number,narrar?:string}>} segmentos */
export function generarVtt(segmentos) {
    const cuerpo = conNarracion(segmentos)
        .map((s) => `${reloj(s.inicioSeg, '.')} --> ${reloj(s.finSeg, '.')}\n${s.narrar.trim()}`)
        .join('\n\n');
    return `WEBVTT\n\n${cuerpo}\n`;
}

/** @param {Array<{inicioSeg:number,finSeg:number,narrar?:string}>} segmentos */
export function generarSrt(segmentos) {
    return conNarracion(segmentos)
        .map((s, i) => `${i + 1}\n${reloj(s.inicioSeg, ',')} --> ${reloj(s.finSeg, ',')}\n${s.narrar.trim()}`)
        .join('\n\n') + '\n';
}
