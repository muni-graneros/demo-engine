import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generarManual } from '../src/manual.mjs';

test('escribe md, html y pdf desde los pasos grabados', async () => {
    const salida = mkdtempSync(join(tmpdir(), 'demo-man-'));
    const { md, html, pdf } = await generarManual({
        guion: { id: 'curso', titulo: 'Curso completo' },
        pasos: [
            { escena: 'panel', titulo: 'El funcionario abre el panel', actor: 'funcionario',
              narrar: 'Abre el panel de solicitudes.', captura: null },
            { escena: 'detalle', titulo: 'Y entra al detalle', actor: 'funcionario',
              narrar: 'Entra al detalle.', captura: null },
        ],
        marca: { nombre: 'Sistema', color: '#1e3a8a' },
    }, { salida });

    assert.ok(existsSync(md) && existsSync(html) && existsSync(pdf));
    const texto = readFileSync(md, 'utf8');
    assert.match(texto, /# Curso completo/);
    assert.match(texto, /## El funcionario abre el panel/);
    assert.match(texto, /Abre el panel de solicitudes\./);
    assert.match(texto, /funcionario/);
});
