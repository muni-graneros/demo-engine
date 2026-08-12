import * as piper from './piper.mjs';
import * as kokoro from './kokoro.mjs';

const MOTORES = { piper, kokoro };

/**
 * Devuelve el motor de voz configurado, cayendo al respaldo si el principal no está.
 * Si no hay ninguno, la voz queda "no disponible" y el video sale con subtítulos y sin
 * locución — degradar es preferible a abortar la grabación.
 */
export function crearVoz({ motor = 'kokoro', voz, respaldo = 'piper' } = {}) {
    const candidatos = [motor, respaldo].filter(Boolean);
    for (const nombre of candidatos) {
        const modulo = MOTORES[nombre];
        if (!modulo) continue;
        const instancia = modulo.crear({ voz });
        if (instancia.disponible()) return instancia;
    }
    return { motor: 'ninguno', disponible: () => false, sintetizar: () => null };
}
