import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolverVenvYVoces } from './resolver.mjs';

// Kokoro se invoca por un script de una línea para no arrastrar un binding de Python.
const GUION = `
import sys, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro(sys.argv[1], sys.argv[2])
audio, sr = k.create(sys.stdin.read(), voice=sys.argv[3], speed=1.0, lang="es")
sf.write(sys.argv[4], audio, sr)
`;

export function crear({ voz = 'ef_dora', venv, voces } = {}) {
    const { venv: VENV, voces: VOCES } = resolverVenvYVoces({ venv, voces });
    const PY = join(VENV, 'bin', 'python');
    const MODELO = join(VOCES, 'kokoro-v1.0.onnx');
    const PESOS = join(VOCES, 'voices-v1.0.bin');
    return {
        motor: 'kokoro',
        disponible: () => existsSync(PY) && existsSync(MODELO) && existsSync(PESOS),
        sintetizar(texto) {
            const destino = join(mkdtempSync(join(tmpdir(), 'voz-')), 'locucion.wav');
            const r = spawnSync(PY, ['-c', GUION, MODELO, PESOS, voz, destino],
                { input: texto, encoding: 'utf8' });
            return r.status === 0 && existsSync(destino) ? destino : null;
        },
    };
}
