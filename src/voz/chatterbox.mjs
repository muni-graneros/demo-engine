import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolverVenvYVoces, RUTA_CACHE } from './resolver.mjs';
import { crearMotorProceso, despuesConVelocidad, OFFLINE } from './proceso.mjs';

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

// OJO: upstream `from_pretrained` puede aceptar un argumento de versión de modelo (t3_model);
// confirmarlo en la primera instalación real antes de fijar un valor, no adivinarlo.
// Venv propio (venv-chatterbox) por la misma razón que pocket: su pila de torch no se mezcla
// con la de kokoro/piper ni con la de pocket, que fijan versiones distintas.
/**
 * Por diseño, `voz` es la ruta a un `.wav` con consentimiento escrito en
 * `demo.config.mjs` del proyecto que se graba; NO se confina al `process.cwd()` a
 * diferencia de los assets. Se asume que el config es de fuente confiable (operador
 * local o CI controlado). Aplicar el confine real queda como bounded de hardening aparte,
 * fuera del alcance de este cambio.
 */
export function crear({ voz, venv, voces, velocidad = 1, ejecutarProceso } = {}) {
    // Voz es la ruta a un .wav de una persona con consentimiento escrito (Ley 21.719: la voz
    // es un dato personal). Se valida temprano: si viene string vacío o si el archivo no
    // existe, mejor fallar acá con un mensaje accionable que caer en silencio pidiendo un
    // archivo perdido en pleno arranque.
    if (typeof voz === 'string') {
        if (voz.length === 0) {
            return { disponible: () => false, error: () => `chatterbox necesita una voz de referencia .wav con consentimiento escrito de la persona; recibido: ${JSON.stringify(voz)}` };
        }
        if (!existsSync(voz)) {
            return { disponible: () => false, error: () => `no se encontró la voz de referencia .wav; el archivo debe existir: ${voz}` };
        }
    }
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
        // Grabar nunca sale a internet: los pesos se bajan UNA vez en instalar-voces.sh
        // (que hace una síntesis de calentamiento) y acá Hugging Face queda en modo offline.
        // Sin los pesos en la caché, la sonda falla y dice cómo remediarlo.
        env: OFFLINE,
        ayudaArranque: 'si el error es de pesos que no están en la caché de Hugging Face, bajarlos una vez (con red) con: bash node_modules/demo-engine/herramientas/instalar-voces.sh --chatterbox',
        ...(ejecutarProceso ? { ejecutarProceso } : {}),
    });
}
