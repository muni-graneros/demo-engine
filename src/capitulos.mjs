/** Encadena los capítulos: cada uno empieza donde terminó el anterior. */
export function capitulosConTiempos(capitulos, duraciones) {
    let reloj = 0;
    return capitulos.map((cap, i) => {
        const inicioSeg = reloj;
        reloj += duraciones[i] ?? 0;
        return { ...cap, inicioSeg, finSeg: reloj };
    });
}

/** Metadata de capítulos que entiende ffmpeg (`-f ffmetadata`). */
export function ffmetadata(capitulos) {
    const bloques = capitulos.map((c) => [
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        `START=${Math.round(c.inicioSeg * 1000)}`,
        `END=${Math.round(c.finSeg * 1000)}`,
        `title=${c.titulo}`,
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
