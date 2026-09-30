import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const correr = (cwd) => spawnSync('node', [CLI, 'init'], { cwd, encoding: 'utf8' });

test('demo init copia el andamiaje y es idempotente (no pisa lo existente)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-init-'));

    const r1 = correr(dir);
    assert.equal(r1.status, 0, r1.stderr);
    // Deja la config y los guiones de ejemplo.
    assert.ok(existsSync(join(dir, 'demo.config.mjs')));
    assert.ok(existsSync(join(dir, 'demo', 'guiones', 'ejemplo.mjs')));
    assert.ok(existsSync(join(dir, 'demo', 'guiones', 'curso.mjs')));
    assert.ok(existsSync(join(dir, 'demo', 'guiones', '_ui.mjs')));
    assert.ok(existsSync(join(dir, 'demo', 'CONTEXTO-Y-SEEDER.md')));
    assert.match(r1.stdout, /archivo\(s\) creado/);
    // Y NO deja internos del motor: las plantillas del escenario 3D (marco y escena) se
    // cargan desde el propio paquete, así que copiarlas al proyecto solo genera confusión
    // y copias que nunca se releen. Viven en src/escenario/ justamente por esto.
    assert.ok(!existsSync(join(dir, 'escenario')), 'demo init no debe copiar el escenario del motor');
    assert.ok(!existsSync(join(dir, 'marco.html')));
    assert.ok(!existsSync(join(dir, 'escena.html')));

    // Marcar el config para comprobar que la 2da corrida NO lo pisa.
    const marca = '// EDITADO POR EL USUARIO\n';
    const antes = readFileSync(join(dir, 'demo.config.mjs'), 'utf8');
    writeFileSync(join(dir, 'demo.config.mjs'), marca + antes);

    const r2 = correr(dir);
    assert.equal(r2.status, 0, r2.stderr);
    assert.match(r2.stdout, /0 archivo\(s\) creado/);
    assert.ok(readFileSync(join(dir, 'demo.config.mjs'), 'utf8').startsWith(marca), 'no debe pisar el config editado');
});
