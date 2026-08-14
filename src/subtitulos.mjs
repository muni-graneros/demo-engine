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

const RE_TIMESTAMP = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/;

function segundos(marca) {
    const m = marca.match(RE_TIMESTAMP);
    if (!m) return null;
    const [, h, min, s, ms] = m;
    return Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(ms) / 1000;
}

/**
 * Lee un WebVTT ya escrito y devuelve sus cues en el mismo formato que consumen
 * `generarVtt`/`generarSrt` ({inicioSeg, finSeg, narrar}). Sirve para recombinar los
 * subtítulos de varios capítulos en uno solo (ver `pegarCapitulos`): cada capítulo ya
 * escribió su `.vtt` al lado del clip, y hay que releerlo para desplazarlo por su offset.
 */
export function parseVtt(texto) {
    const bloques = texto.replace(/\r\n/g, '\n').split(/\n\n+/);
    const cues = [];
    for (const bloque of bloques) {
        const lineas = bloque.split('\n');
        const idxTiempo = lineas.findIndex((l) => l.includes('-->'));
        if (idxTiempo === -1) continue; // cabecera WEBVTT, NOTE, identificador de cue, etc.
        const [crudoInicio, crudoFin] = lineas[idxTiempo].split('-->');
        const inicioSeg = segundos(crudoInicio.trim());
        const finSeg = segundos((crudoFin ?? '').trim().split(/\s+/)[0] ?? '');
        if (inicioSeg == null || finSeg == null) continue;
        const narrar = lineas.slice(idxTiempo + 1).join('\n').trim();
        if (narrar) cues.push({ inicioSeg, finSeg, narrar });
    }
    return cues;
}
