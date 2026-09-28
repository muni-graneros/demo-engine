import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolverVenvYVoces, RUTA_CACHE } from './resolver.mjs';
import { crearMotorProceso, despuesConVelocidad } from './proceso.mjs';

// Pocket TTS (Kyutai): código MIT, pesos CC-BY-4.0 → exige atribución en los créditos del
// video. Corre en CPU con 2 núcleos. `voz` es "<idioma>:<voz>": el idioma elige el modelo
// (spanish | spanish_24l, el de 24 capas suena mejor y tarda más) y la voz es un nombre
// predefinido o la ruta a un .wav (clonar exige consentimiento escrito: Ley 21.719).
const GUION = `
import sys, scipy.io.wavfile
from pocket_tts import TTSModel
m = TTSModel.load_model(language=sys.argv[1])
estado = m.get_state_for_audio_prompt(sys.argv[2])
audio = m.generate_audio(estado, sys.stdin.read())
scipy.io.wavfile.write(sys.argv[3], m.sample_rate, audio.numpy())
`;

// El venv propio (venv-pocket, hermano del `venv` de kokoro/piper) es a propósito: Pocket
// arrastra torch, y mezclarlo con kokoro-onnx en un solo venv obliga a reinstalar todo si
// una de las dos pilas rompe sus dependencias. `RUTA_CACHE` es una función: se llama acá
// para respetar un XDG_CACHE_HOME que haya cambiado dentro del proceso.
export function crear({ voz = 'spanish:alba', venv, voces, velocidad = 1, ejecutarProceso } = {}) {
    const { venv: VENV } = resolverVenvYVoces({ venv: venv ?? join(RUTA_CACHE(), 'venv-pocket'), voces });
    const PY = join(VENV, 'bin', 'python');
    const [idioma, nombreVoz] = voz.includes(':') ? voz.split(/:(.*)/s) : ['spanish', voz];
    return crearMotorProceso({
        motor: 'pocket',
        archivosListos: () => (existsSync(PY) ? null : `no se encontró el intérprete de Python de Pocket TTS en ${PY} (instalar-voces.sh --pocket)`),
        comando: (destino) => ({ PY, args: ['-c', GUION, idioma, nombreVoz, destino] }),
        // Pocket no trae control de velocidad: se aplica `atempo` sobre el .wav ya escrito.
        despues: despuesConVelocidad(velocidad),
        ...(ejecutarProceso ? { ejecutarProceso } : {}),
    });
}
