import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolverVenvYVoces } from './resolver.mjs';
import { crearMotorProceso } from './proceso.mjs';

// `ejecutarProceso` se reenvía tal cual a crearMotorProceso: por defecto es undefined (usa el
// spawnSync real), y las pruebas lo inyectan para ejercitar el ciclo de vida sin lanzar un
// proceso real (ver proceso.mjs).
export function crear({ velocidad = 1, voz = 'es_ES-davefx-medium', venv, voces, ejecutarProceso } = {}) {
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
        // `--length-scale` es el INVERSO de la velocidad: 0.9 habla más rápido que
        // 1.0. Se deriva de la misma opción `voz.velocidad` para que cambiar de
        // motor no cambie el ritmo del video.
        comando: (destino) => ({
            PY,
            args: ['-m', 'piper', '-m', modelo, '--data-dir', VOCES, '--length-scale', String(1 / velocidad), '-f', destino],
        }),
        ...(ejecutarProceso ? { ejecutarProceso } : {}),
    });
}
