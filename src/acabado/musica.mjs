/**
 * Música de fondo generada por el propio motor (spec 2026-10-02-video-moderno).
 *
 * El motor no puede traer audio de terceros: toda pista ajena exige verificar su licencia, y el
 * mismo motor graba para la Municipalidad, KraftDo y muni-kit, con licencias distintas. Una cama
 * armónica sintetizada acá (senos con envolvente lenta, paso bajo y un eco corto) no tiene
 * licencia que verificar: es obra del propio motor. Se mezcla con la atenuación de siempre bajo
 * la voz (`mezcla.mjs`), así que solo se oye en los respiros.
 *
 * Progresión La menor – Fa – Do – Sol (8 s por acorde), cada acorde con una campana de 12 s que
 * se funde con el siguiente: no hay ataques ni cortes que distraigan de la locución.
 */
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ff } from '../ffmpeg.mjs';

const ACORDES = [
    [110.0, 220.0, 261.63, 329.63],   // La menor
    [87.31, 174.61, 220.0, 261.63],   // Fa
    [130.81, 196.0, 261.63, 329.63],  // Do
    [98.0, 196.0, 246.94, 293.66],    // Sol
];
const SEG_POR_ACORDE = 8;
const CAMPANA_S = 12;

/** La expresión de `aevalsrc` de un canal; `desafinar` abre el estéreo sin cambiar la armonía. */
export function expresionDeMusica(desafinar = 1) {
    const ciclo = ACORDES.length * SEG_POR_ACORDE;
    return ACORDES.map((notas, k) => {
        const u = `mod(t-${k * SEG_POR_ACORDE}+2,${ciclo})`;
        const envolvente = `(0.5-0.5*cos(2*PI*min(${u},${CAMPANA_S})/${CAMPANA_S}))`;
        const voces = notas.map((f, i) => `${(i === 0 ? 0.55 : 0.35).toFixed(2)}*sin(2*PI*${(f * desafinar).toFixed(3)}*t)`).join('+');
        return `${envolvente}*(${voces})`;
    }).join('+');
}

/**
 * La `musica` que recibe `cadenaDeMezcla`: si es la generada, con su archivo ya escrito del largo
 * del video (en `dir`); si es un archivo propio o no hay música, tal cual.
 */
export function musicaParaMezcla(musica, { segundos, dir }) {
    if (!musica?.generada) return musica ?? null;
    return { ...musica, archivo: generarMusica({ segundos, salida: join(dir, `musica-${process.pid}-${Date.now()}.wav`) }) };
}

/** Largo de la base cacheada: ocho vueltas de la progresión (sintetizarla cuesta ~0,2 s por segundo). */
const BASE_S = 256;
const VERSION_BASE = 1;

/** Sintetiza (una vez por máquina) la base sin fundidos y devuelve su ruta. */
export function baseDeMusica(dirCache = join(homedir(), '.cache', 'demo-engine')) {
    mkdirSync(dirCache, { recursive: true });
    const base = join(dirCache, `musica-generada-v${VERSION_BASE}.wav`);
    if (existsSync(base)) return base;
    const temporal = `${base}.${process.pid}.tmp.wav`;
    const expr = `${expresionDeMusica(1)}|${expresionDeMusica(1.003)}`;
    ff(['-y', '-f', 'lavfi', '-i', `aevalsrc=exprs='${expr}':s=48000:d=${BASE_S}`,
        '-af', 'volume=0.18,lowpass=f=900,aecho=0.8:0.6:180|360:0.22|0.12',
        '-ar', '48000', '-ac', '2', temporal]);
    renameSync(temporal, base);
    return base;
}

/**
 * Escribe un WAV estéreo de `segundos` con la cama armónica, con fundido de entrada y de salida.
 * @returns {string} la ruta `salida`
 */
export function generarMusica({ segundos, salida, dirCache }) {
    if (!(segundos > 0)) throw new Error(`generarMusica: segundos inválidos (${segundos})`);
    const fundido = Math.min(2.5, segundos / 4);
    ff(['-y', '-stream_loop', '-1', '-i', baseDeMusica(dirCache), '-t', segundos.toFixed(3),
        '-af', `afade=t=in:st=0:d=${fundido.toFixed(2)},afade=t=out:st=${(segundos - fundido).toFixed(2)}:d=${fundido.toFixed(2)}`,
        '-ar', '48000', '-ac', '2', salida]);
    return salida;
}
