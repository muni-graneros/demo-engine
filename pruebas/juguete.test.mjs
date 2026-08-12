import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarJuguete } from './juguete/servidor.mjs';

test('el juguete sirve el login y protege el panel', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    try {
        const login = await fetch(`${juguete.url}/`);
        assert.equal(login.status, 200);
        assert.match(await login.text(), /name="usuario"/);

        const panel = await fetch(`${juguete.url}/panel`, { redirect: 'manual' });
        assert.equal(panel.status, 302, 'sin sesión el panel debe redirigir al login');
    } finally {
        await juguete.cerrar();
    }
});

test('el panel filtrado por rut deja una sola fila', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    try {
        const r = await fetch(`${juguete.url}/panel?rut=11111111-1`, {
            headers: { cookie: 'sesion=funcionario' },
        });
        const html = await r.text();
        const filas = html.match(/<tr class="fila"/g) ?? [];
        assert.equal(filas.length, 1);
    } finally {
        await juguete.cerrar();
    }
});
