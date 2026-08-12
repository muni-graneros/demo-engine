import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { prepararSesiones, totp } from '../src/sesiones.mjs';

test('genera el TOTP de referencia del RFC 6238', () => {
    // Secreto oficial del RFC 6238 (Apéndice B): "12345678901234567890" (20 bytes ASCII)
    // codificado en base32 completo. OJO: el brief trae este literal truncado a los
    // primeros 16 caracteres ("GEZDGNBVGY3TQOJQ"), que en base32 estándar solo decodifica
    // a los 10 bytes "1234567890" y NO reproduce el vector oficial (da 263420, no 287082).
    // Verificado por ida y vuelta: codificar "12345678901234567890" en base32 da
    // "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" (32 caracteres); con ese literal completo la
    // implementación del brief sí da el 287082 exigido por el vector oficial.
    const codigo = totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59);
    assert.equal(codigo, '287082');
});

test('deja un storageState por actor', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: {
                funcionario: { email: 'f@x.cl', password: 'password' },
                director: { email: 'd@x.cl', password: 'password' },
            },
        };
        const sesiones = await prepararSesiones(config, { dirSesiones: dir });
        assert.deepEqual(Object.keys(sesiones).sort(), ['director', 'funcionario']);
        assert.ok(existsSync(sesiones.funcionario));
    } finally {
        await juguete.cerrar();
    }
});

test('si el login no deja sesión, falla nombrando al actor', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const dir = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]',
                     enviar: '#entrar', comprobar: '#no-existe-jamas' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
        };
        await assert.rejects(() => prepararSesiones(config, { dirSesiones: dir }), /funcionario/);
    } finally {
        await juguete.cerrar();
    }
});
