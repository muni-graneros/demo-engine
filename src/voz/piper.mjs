import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const VENV = process.env.DEMO_VENV ?? resolve(process.cwd(), '.venv');
const PY = join(VENV, 'bin', 'python');
const VOCES = process.env.DEMO_VOCES ?? resolve(process.cwd(), '.voces');

export function crear({ voz = 'es_ES-davefx-medium' } = {}) {
    const modelo = join(VOCES, `${voz}.onnx`);
    return {
        motor: 'piper',
        disponible: () => existsSync(PY) && existsSync(modelo),
        sintetizar(texto) {
            const destino = join(mkdtempSync(join(tmpdir(), 'voz-')), 'locucion.wav');
            const r = spawnSync(PY, ['-m', 'piper', '-m', modelo, '--data-dir', VOCES, '-f', destino],
                { input: texto, encoding: 'utf8' });
            return r.status === 0 && existsSync(destino) ? destino : null;
        },
    };
}
