import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { grabar } from '../src/grabador.mjs';

import { ff } from '../src/ffmpeg.mjs';

// Voz de mentira que devuelve un .wav REAL de la duración pedida: así el grabador ejercita
// el mismo camino que en producción (sintetizar → medir → esperar), sin depender de que
// haya modelos de voz instalados en la máquina donde corren los tests.
function vozDe(segundos, dir) {
    const wav = join(dir, `voz-${segundos}s.wav`);
    ff(['-y', '-f', 'lavfi', '-t', String(segundos), '-i', 'anullsrc=r=22050:cl=mono', wav]);
    return { motor: 'falsa', disponible: () => true, sintetizar: () => wav };
}

function guionDePrueba(url) {
    return {
        id: 'prueba',
        escenas: [
            { id: 'panel', titulo: 'El funcionario abre el panel', pasos: [
                { actor: 'funcionario', narrar: 'Abre el panel de solicitudes.',
                  hacer: async (page) => { await page.goto(`${url}/panel`); } },
            ] },
            { id: 'detalle', titulo: 'Y entra al detalle', pasos: [
                { actor: 'funcionario', narrar: 'Entra al detalle.',
                  hacer: async (page) => { await page.goto(`${url}/detalle/11111111-1`); } },
            ] },
        ],
    };
}

test('graba una pista por actor y devuelve pasos con reloj local y global', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 300 },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const { pistas, pasos } = await grabar(guionDePrueba(juguete.url),
            { config, sesiones, salida, voz: vozDe(2, salida) });

        assert.ok(existsSync(pistas.funcionario), 'no se escribió la pista del funcionario');
        assert.equal(pasos.length, 2);
        assert.equal(pasos[0].tLocal, 0, 'el primer paso arranca en cero en su reloj local');
        assert.ok(pasos[1].tGlobal > pasos[0].tGlobal, 'el reloj global avanza');
        assert.ok(pasos.every((p) => p.duracionMs > 0), 'todo paso debe traer duración');
    } finally {
        await juguete.cerrar();
    }
});

test('el paso dura al menos lo que la locución, no un tiempo fijo', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 300 },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const { pasos } = await grabar(guionDePrueba(juguete.url),
            { config, sesiones, salida, voz: vozDe(4, salida) });

        assert.ok(pasos[0].duracionMs >= 4000,
            `el paso duró ${pasos[0].duracionMs} ms y la locución 4000: la voz se cortaría`);
        assert.ok(pasos[0].wav, 'el paso debe llevar la ruta del wav para que el montaje lo reutilice');
    } finally {
        await juguete.cerrar();
    }
});
