import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolverVenvYVoces, RUTA_CACHE } from './resolver.mjs';
import { crearMotorProceso, despuesConVelocidad } from './proceso.mjs';

// Chatterbox multilingüe (Resemble AI): MIT; el audio lleva la marca de agua Perth de
// Resemble (transparenta que es voz sintética). No trae voces predefinidas en español: SIEMPRE
// clona una voz de referencia, así que `voz` es la ruta a un .wav de una persona que dio su
// consentimiento por escrito (Ley 21.719: la voz es un dato personal).
const GUION = `
import sys, torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
m = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
wav = m.generate(sys.stdin.read(), language_id="es", audio_prompt_path=sys.argv[1])
ta.save(sys.argv[2], wav, m.sr)
`;

// Venv propio (venv-chatterbox) por la misma razón que pocket: su pila de torch no se mezcla
// con la de kokoro/piper ni con la de pocket, que fijan versiones distintas.
export function crear({ voz, venv, voces, velocidad = 1, ejecutarProceso } = {}) {
    const { venv: VENV } = resolverVenvYVoces({ venv: venv ?? join(RUTA_CACHE(), 'venv-chatterbox'), voces });
    const PY = join(VENV, 'bin', 'python');
    const REF = voz ? resolve(voz) : null;
    return crearMotorProceso({
        motor: 'chatterbox',
        archivosListos: () => {
            if (!existsSync(PY)) return `no se encontró el intérprete de Python de Chatterbox en ${PY} (instalar-voces.sh --chatterbox)`;
            if (!REF) return 'chatterbox necesita una voz de referencia (voz: ruta a un .wav con consentimiento escrito de la persona)';
            if (!existsSync(REF)) return `no se encontró la voz de referencia en ${REF}`;
            return null;
        },
        comando: (destino) => ({ PY, args: ['-c', GUION, REF, destino] }),
        // Chatterbox tampoco trae control de velocidad: mismo `atempo` que pocket.
        despues: despuesConVelocidad(velocidad),
        ...(ejecutarProceso ? { ejecutarProceso } : {}),
    });
}
