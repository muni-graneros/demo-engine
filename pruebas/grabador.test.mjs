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
        // Tolerancia, no igualdad exacta: `tLocal` es un delta de reloj de pared, y basta un
        // hipo del planificador para que salga 1 ms aunque el código sea correcto. Medido: con
        // igualdad estricta la suite falla ~1 de cada 5 corridas bajo carga.
        assert.ok(pasos[0].tLocal < 50,
            `el primer paso debe arrancar pegado al cero de su reloj local, y arrancó en ${pasos[0].tLocal} ms`);
        assert.ok(pasos[1].tGlobal > pasos[0].tGlobal, 'el reloj global avanza');
        assert.ok(pasos.every((p) => p.duracionMs > 0), 'todo paso debe traer duración');
    } finally {
        await juguete.cerrar();
    }
});

test('hacer(page, contexto) recibe la marca de la config: un guion puede pintar su propia identidad', async () => {
    // Defecto real: portada()/cierre() necesitan config.marca (nombre, color, escudo) para no
    // salir con el azul por defecto del paquete, pero `hacer` solo recibía `page`. Sin un
    // segundo argumento, ningún guion podía alcanzar la marca del sistema que está grabando.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 200 },
            marca: { nombre: 'Sistema de Prueba', color: '#123456' },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        let marcaRecibida = null;
        const guion = {
            id: 'con-marca',
            escenas: [{ id: 'a', titulo: 'Portada', pasos: [{
                actor: 'funcionario',
                hacer: async (page, { config }) => {
                    marcaRecibida = config.marca;
                    await page.goto(`${juguete.url}/panel`);
                },
            }] }],
        };

        await grabar(guion, { config, sesiones, salida, voz: vozDe(1, salida) });

        assert.deepEqual(marcaRecibida, config.marca,
            'hacer() debe recibir { config } como segundo argumento, con la marca del sistema');
    } finally {
        await juguete.cerrar();
    }
});

test('un guion que declara hacer(page) a secas sigue funcionando sin cambios', async () => {
    // Compatibilidad hacia atrás: el segundo argumento es adicional, no reemplaza al primero.
    const juguete = await iniciarJuguete({ puerto: 0 });
    const salida = mkdtempSync(join(tmpdir(), 'demo-grab-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 200 },
        };
        const { prepararSesiones } = await import('../src/sesiones.mjs');
        const sesiones = await prepararSesiones(config, { dirSesiones });

        const guion = {
            id: 'sin-marca',
            escenas: [{ id: 'a', titulo: 'Panel', pasos: [{
                actor: 'funcionario',
                hacer: async (page) => { await page.goto(`${juguete.url}/panel`); },
            }] }],
        };

        const { pasos } = await grabar(guion, { config, sesiones, salida, voz: vozDe(1, salida) });
        assert.equal(pasos.length, 1);
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
