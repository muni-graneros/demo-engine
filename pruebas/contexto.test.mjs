import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { prepararSesiones } from '../src/sesiones.mjs';
import { capturarContexto } from '../src/contexto.mjs';

test('captura el pack: público + con sesión + interacción, y anota las que fallan', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-ctx-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar', comprobar: null },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600 },
            contexto: {
                salida,
                pantallas: [
                    { id: 'publico', url: '/', actor: null },                    // sin sesión
                    { id: 'con-sesion', url: '/panel', actor: 'funcionario' },    // usa la sesión del actor
                    { id: 'con-interaccion', actor: null, hacer: async (page) => { await page.goto(`${juguete.url}/`); } },
                    { id: 'falla', url: '/', actor: null, esperaTexto: 'EstoNoExisteEnLaPagina', esperaMs: 0 }, // → falla y se anota
                ],
            },
        };

        const sesiones = await prepararSesiones(config, { dirSesiones });
        const { ok, fail, manifest } = await capturarContexto({ config, sesiones, salida });

        assert.equal(ok, 3, 'tres pantallas deben capturarse');
        assert.equal(fail, 1, 'la pantalla con esperaTexto inexistente debe fallar');
        assert.ok(existsSync(join(salida, 'pantallas', 'publico.png')));
        assert.ok(existsSync(join(salida, 'pantallas', 'con-sesion.png')));
        assert.ok(existsSync(join(salida, 'pantallas', 'con-interaccion.png')));
        assert.ok(!existsSync(join(salida, 'pantallas', 'falla.png')), 'la que falla no deja PNG');

        // El manifiesto anota lo capturado y el error de la que falló.
        assert.ok(existsSync(join(salida, 'pantallas.json')));
        const mani = JSON.parse(readFileSync(join(salida, 'pantallas.json'), 'utf8'));
        assert.equal(mani.ok, 3);
        assert.equal(mani.fail, 1);
        assert.ok(mani.pantallas.find((p) => p.id === 'falla')?.error, 'la fallida trae su mensaje de error');
        assert.equal(mani.pantallas.find((p) => p.id === 'con-sesion')?.actor, 'funcionario');
    } finally {
        await juguete.cerrar();
    }
});
