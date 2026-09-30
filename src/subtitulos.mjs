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

/*
 * Subtítulos legibles (C2 / G8-02). Un cue por paso llevaba la locución entera —hasta 269
 * caracteres en una sola línea—: no cabe en pantalla ni se alcanza a leer. Cada cue se parte
 * en frases, y cada frase en bloques de a lo más `lineas` líneas de `ancho` caracteres (42 × 2
 * es la convención de subtitulado de TV y de plataformas), con el tiempo del cue original
 * repartido en proporción al largo de cada bloque: la voz tarda más en lo largo. Portado de
 * seguridad-graneros (tools/demo/subtitulos-legibles.mjs), que lo resolvía en su montaje.
 */
export const ANCHO_SUBTITULO = 42;
export const LINEAS_SUBTITULO = 2;

const DEFECTOS_SUBTITULOS = { partir: true, ancho: ANCHO_SUBTITULO, lineas: LINEAS_SUBTITULO };
let SUBTITULOS = { ...DEFECTOS_SUBTITULOS };

/**
 * Fija cómo parten los subtítulos en este proceso (`subtitulos` de demo.config.mjs; lo llama
 * `cargarConfig`). Sin argumento vuelve a los defectos. Módulo y no parámetro porque los
 * `.vtt` se escriben en varios puntos del montaje (clip, capítulo, curso) que no reciben la
 * config, y todos tienen que partir igual.
 */
export function configurarSubtitulos(opciones = {}) {
    SUBTITULOS = { ...DEFECTOS_SUBTITULOS, ...opciones };
}

/** Frases de un texto: corta en `.`, `!`, `?` o `…` seguidos de espacio; la puntuación queda con su frase. */
function frases(texto) {
    return texto.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
}

/** Reparte las palabras en líneas de a lo más `ancho` caracteres (una palabra más larga se corta). */
function envolver(texto, ancho) {
    const lineas = [];
    let actual = '';
    for (let palabra of texto.split(' ').filter(Boolean)) {
        while (palabra.length > ancho) {
            if (actual) {
                lineas.push(actual);
                actual = '';
            }
            lineas.push(palabra.slice(0, ancho));
            palabra = palabra.slice(ancho);
        }
        if (!palabra) continue;
        if (actual && actual.length + 1 + palabra.length > ancho) {
            lineas.push(actual);
            actual = palabra;
        } else {
            actual = actual ? `${actual} ${palabra}` : palabra;
        }
    }
    if (actual) lineas.push(actual);
    return lineas;
}

/** Bloques de texto (cada uno, hasta `lineas` líneas): un bloque nunca cruza el final de una frase. */
function bloques(texto, { ancho, lineas }) {
    const salida = [];
    for (const frase of frases(texto)) {
        const partes = envolver(frase, ancho);
        for (let i = 0; i < partes.length; i += lineas) salida.push(partes.slice(i, i + lineas).join('\n'));
    }
    return salida;
}

/**
 * Parte un cue `{ inicioSeg, finSeg, narrar }` en cues legibles que cubren el mismo intervalo
 * sin huecos ni solapes. Un cue que ya cabe se devuelve tal cual (partir dos veces no cambia
 * nada: `pegarCapitulos` relee los `.vtt` de cada capítulo y los vuelve a escribir).
 */
export function partirCue(cue, opciones = {}) {
    const { ancho, lineas } = { ...SUBTITULOS, ...opciones };
    const trozos = bloques(cue.narrar, { ancho, lineas });
    if (trozos.length <= 1) return [{ ...cue, narrar: trozos[0] ?? cue.narrar }];

    const pesos = trozos.map((t) => t.replace(/\n/g, ' ').length);
    const total = pesos.reduce((suma, peso) => suma + peso, 0);
    const duracion = cue.finSeg - cue.inicioSeg;
    let marca = cue.inicioSeg;

    return trozos.map((narrar, i) => {
        const inicioSeg = marca;
        marca = i === trozos.length - 1 ? cue.finSeg : marca + (pesos[i] / total) * duracion;
        return { ...cue, inicioSeg, finSeg: marca, narrar };
    });
}

export const partirCues = (cues, opciones) => cues.flatMap((cue) => partirCue(cue, opciones));

/** Cues cuyo texto (sin saltos de línea) pasa de `maximo` caracteres. */
export function cuesLargos(cues, maximo = ANCHO_SUBTITULO * LINEAS_SUBTITULO) {
    return cues.filter((cue) => cue.narrar.replace(/\n/g, '').length > maximo);
}

/** Los cues con narración, ya partidos si corresponde (`opciones` pisa lo de `configurarSubtitulos`). */
function cuesDe(segmentos, opciones) {
    const efectivas = { ...SUBTITULOS, ...opciones };
    const con = segmentos
        .filter((s) => s.narrar?.trim())
        .map((s) => ({ inicioSeg: s.inicioSeg, finSeg: s.finSeg, narrar: s.narrar.trim() }));
    return efectivas.partir ? partirCues(con, efectivas) : con;
}

/**
 * @param {Array<{inicioSeg:number,finSeg:number,narrar?:string}>} segmentos
 * @param {{partir?:boolean, ancho?:number, lineas?:number}} [opciones] pisa la config del proceso
 */
export function generarVtt(segmentos, opciones = {}) {
    const cuerpo = cuesDe(segmentos, opciones)
        .map((s) => `${reloj(s.inicioSeg, '.')} --> ${reloj(s.finSeg, '.')}\n${s.narrar}`)
        .join('\n\n');
    return `WEBVTT\n\n${cuerpo}\n`;
}

/** Igual que `generarVtt`, para la pista `mov_text` del MP4 (parte igual). */
export function generarSrt(segmentos, opciones = {}) {
    return cuesDe(segmentos, opciones)
        .map((s, i) => `${i + 1}\n${reloj(s.inicioSeg, ',')} --> ${reloj(s.finSeg, ',')}\n${s.narrar}`)
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
