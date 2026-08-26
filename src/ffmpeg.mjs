import { spawnSync } from 'node:child_process';
import rutaFfmpeg from 'ffmpeg-static';

export const RUTA_FFMPEG = rutaFfmpeg;

/**
 * Invoca ffmpeg y lanza un error legible si falla.
 * @param {string[]} args
 */
export function ff(args) {
    const r = spawnSync(RUTA_FFMPEG, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
        // Del stderr solo interesa lo que abortó el proceso: las advertencias repetitivas
        // (DTS no monótono, avisos de deprecación) enterrarían la causa real.
        const relevantes = (r.stderr || '').split('\n')
            .filter((l) => l.trim() && !/Non-monotonous DTS|This may result in|deprecated/.test(l));
        throw new Error('ffmpeg falló: ' + relevantes.slice(-4).join(' | '));
    }
}

/**
 * Duración de un archivo en segundos. No depende de ffprobe: el binario estático no lo trae.
 * @param {string} archivo
 * @returns {number}
 */
export function duracion(archivo) {
    const r = spawnSync(RUTA_FFMPEG, ['-i', archivo], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const m = (r.stderr || '').match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (!m) return 0;
    return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}
