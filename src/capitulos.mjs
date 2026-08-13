/** Encadena los capítulos: cada uno empieza donde terminó el anterior. */
export function capitulosConTiempos(capitulos, duraciones) {
    let reloj = 0;
    return capitulos.map((cap, i) => {
        const inicioSeg = reloj;
        reloj += duraciones[i] ?? 0;
        return { ...cap, inicioSeg, finSeg: reloj };
    });
}

/**
 * Escapa un valor para el formato ffmetadata.
 *
 * Medido contra el ffmpeg del proyecto: `;`, `#` y `=` **dentro** del valor no molestan
 * (solo son especiales al principio de línea, y el `=` parte por el primero). Lo que sí
 * rompe es un salto de línea: parte la metadata en dos y la segunda mitad se lee como
 * otro campo. La barra invertida también, porque es el carácter de escape.
 */
function escaparMeta(valor) {
    return String(valor).replace(/\\/g, '\\\\').replace(/\r?\n/g, ' ');
}

/** Metadata de capítulos que entiende ffmpeg (`-f ffmetadata`). */
export function ffmetadata(capitulos) {
    const bloques = capitulos.map((c) => [
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        `START=${Math.round(c.inicioSeg * 1000)}`,
        `END=${Math.round(c.finSeg * 1000)}`,
        `title=${escaparMeta(c.titulo)}`,
    ].join('\n'));
    return [';FFMETADATA1', ...bloques].join('\n') + '\n';
}

const mmss = (segundos) => {
    const m = Math.floor(segundos / 60);
    const s = Math.floor(segundos % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** Índice publicable junto al video (BookStack, README, etc.). */
export function indiceMarkdown(capitulos, titulo) {
    const filas = capitulos.map((c) => `- **${mmss(c.inicioSeg)}** — ${c.titulo}`);
    return `# ${titulo}\n\n## Capítulos\n\n${filas.join('\n')}\n`;
}
