import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolverVenvYVoces } from './resolver.mjs';
import { crearMotorProceso } from './proceso.mjs';

// Kokoro se invoca por un script de una línea para no arrastrar un binding de Python.
const GUION = `
import sys, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro(sys.argv[1], sys.argv[2])
audio, sr = k.create(sys.stdin.read(), voice=sys.argv[3], speed=float(sys.argv[4]), lang="es")
sf.write(sys.argv[5], audio, sr)
`;

// `ejecutarProceso` se reenvía tal cual a crearMotorProceso: por defecto es undefined (usa el
// spawnSync real), y las pruebas lo inyectan para ejercitar el ciclo de vida sin lanzar un
// proceso real (ver proceso.mjs).
export function crear({ voz = 'ef_dora', venv, voces, velocidad = 1, ejecutarProceso } = {}) {
    const { venv: VENV, voces: VOCES } = resolverVenvYVoces({ venv, voces });
    const PY = join(VENV, 'bin', 'python');
    const MODELO = join(VOCES, 'kokoro-v1.0.onnx');
    const PESOS = join(VOCES, 'voices-v1.0.bin');
    return crearMotorProceso({
        motor: 'kokoro',
        archivosListos: () => {
            if (!existsSync(PY)) return `no se encontró el intérprete de Python en ${PY}`;
            if (!existsSync(MODELO)) return `no se encontró el modelo Kokoro en ${MODELO}`;
            if (!existsSync(PESOS)) return `no se encontraron los pesos de voces Kokoro en ${PESOS}`;
            return null;
        },
        // La velocidad va como argumento y no fija en el guion: una locución a 1.0
        // se siente lenta en un tutorial —la persona que mira ya está viendo lo que
        // se le cuenta— y a 1.0 el video quedaba en casi siete minutos por lo que
        // se explica en cinco.
        comando: (destino) => ({ PY, args: ['-c', GUION, MODELO, PESOS, voz, String(velocidad), destino] }),
        ...(ejecutarProceso ? { ejecutarProceso } : {}),
    });
}
