import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearMotorProceso } from '../src/voz/proceso.mjs';

/**
 * Un "motor" de mentira que cierra su propio stdin ANTES de leer nada. La escritura que hace
 * `spawnSync({ input })` del lado de Node revienta con EPIPE (reproducido en la máquina real
 * bajo carga: el hijo cierra stdin antes de tiempo). El proceso hijo igual corre, escribe su
 * stderr real y termina — Node ve el fallo de SU escritura, no la salida real del hijo.
 */
function scriptQueCierraStdin(mensaje) {
    const dir = mkdtempSync(join(tmpdir(), 'voz-epipe-'));
    const script = join(dir, 'motor.sh');
    writeFileSync(script, `#!/usr/bin/env bash
exec 0<&-
echo "${mensaje}" >&2
exit 1
`);
    chmodSync(script, 0o755);
    return script;
}

// Input grande a propósito: con un texto corto la escritura a stdin cabe entera en el buffer
// del pipe antes de que el hijo llegue a cerrarlo, y el EPIPE no se reproduce.
const TEXTO_GRANDE = 'x'.repeat(5_000_000);

test('un fallo EPIPE al escribir stdin no descarta el stderr real del proceso', () => {
    const script = scriptQueCierraStdin('el modelo real explotó por falta de memoria');
    const instancia = crearMotorProceso({
        motor: 'prueba',
        archivosListos: () => null,
        comando: (destino) => ({ PY: script, args: [destino] }),
    });

    const avisos = [];
    const original = console.warn;
    console.warn = (m) => avisos.push(String(m));
    let resultado;
    try {
        resultado = instancia.sintetizar(TEXTO_GRANDE);
    } finally {
        console.warn = original;
    }

    assert.equal(resultado, null);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /el modelo real explotó por falta de memoria/,
        'el aviso debe traer el stderr REAL del proceso, no el mensaje genérico de Node (EPIPE)');
});

test('comprobar() (disponible()) también resiste EPIPE sin perder el stderr real', () => {
    const script = scriptQueCierraStdin('sonda: memoria insuficiente de verdad');
    const instancia = crearMotorProceso({
        motor: 'prueba',
        archivosListos: () => null,
        // El texto de sonda por defecto es corto; se pisa por uno grande para reproducir el
        // mismo EPIPE también en la sonda de disponible().
        textoSonda: TEXTO_GRANDE,
        comando: (destino) => ({ PY: script, args: [destino] }),
    });

    assert.equal(instancia.disponible(), false);
    assert.match(instancia.error(), /sonda: memoria insuficiente de verdad/,
        'el motivo de indisponibilidad debe traer el stderr real, no el mensaje genérico de Node');
});
