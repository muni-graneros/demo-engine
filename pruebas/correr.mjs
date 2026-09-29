// Corre todas las pruebas de esta carpeta con `node --test`.
//
// `node --test pruebas/` sólo funciona en Node 20: desde Node 21 una carpeta se
// trata como módulo. Listar los archivos acá funciona en todas las versiones y no
// depende de que la shell expanda globs. Se lanza con el mismo Node que corre este
// script (process.execPath) y sin shell, para que las rutas con espacios no se
// partan. Los argumentos extra (p. ej. --test-concurrency=1) se pasan tal cual.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const carpeta = dirname(fileURLToPath(import.meta.url));
const archivos = readdirSync(carpeta)
    .filter((nombre) => nombre.endsWith('.test.mjs'))
    .sort()
    .map((nombre) => join(carpeta, nombre));

if (archivos.length === 0) {
    console.error('No hay archivos *.test.mjs en pruebas/.');
    process.exit(1);
}

const resultado = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...archivos], { stdio: 'inherit' });
process.exit(resultado.status ?? 1);
