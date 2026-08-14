import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolverVenvYVoces } from './resolver.mjs';
import { crearMotorProceso } from './proceso.mjs';

export function crear({ voz = 'es_ES-davefx-medium', venv, voces } = {}) {
    const { venv: VENV, voces: VOCES } = resolverVenvYVoces({ venv, voces });
    const PY = join(VENV, 'bin', 'python');
    const modelo = join(VOCES, `${voz}.onnx`);
    return crearMotorProceso({
        motor: 'piper',
        archivosListos: () => {
            if (!existsSync(PY)) return `no se encontró el intérprete de Python en ${PY}`;
            if (!existsSync(modelo)) return `no se encontró el modelo Piper en ${modelo}`;
            return null;
        },
        comando: (destino) => ({ PY, args: ['-m', 'piper', '-m', modelo, '--data-dir', VOCES, '-f', destino] }),
    });
}
