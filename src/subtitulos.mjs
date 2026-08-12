/**
 * Los subtítulos salen como ARCHIVO, no quemados en el video: así se pueden apagar, el
 * texto es seleccionable y la wiki puede indexarlo. El MP4 solo admite `mov_text` como
 * pista blanda (sin estilos), y por eso además se emite un .vtt para el reproductor web.
 */

// Se redondea UNA vez, a milisegundos totales, y de ahí se derivan h/m/s. Redondear la
// parte fraccionaria por separado produce 1000 ms cuando la fracción pasa de 0,9995 —y
// entonces sale "00:00:59.1000", con cuatro dígitos: un timestamp inválido que el
// navegador descarta EN SILENCIO, haciendo desaparecer ese subtítulo sin ningún error.
function reloj(segundos, separadorDecimal) {
    const totalMs = Math.round(segundos * 1000);
    const ms = totalMs % 1000;
    const s = Math.floor(totalMs / 1000) % 60;
    const m = Math.floor(totalMs / 60000) % 60;
    const h = Math.floor(totalMs / 3600000);
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
