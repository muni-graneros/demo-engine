import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { cargarConfig } from '../src/configurar.mjs';
import { prepararSesiones } from '../src/sesiones.mjs';
import { grabar } from '../src/grabador.mjs';
import { montar } from '../src/montaje.mjs';
import { crearVoz } from '../src/voz/index.mjs';
import { duracion } from '../src/ffmpeg.mjs';

test('del guion al mp4 con subtítulos, sin tocar Laravel', async () => {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const proyecto = mkdtempSync(join(tmpdir(), 'demo-e2e-'));
    mkdirSync(join(proyecto, 'guiones'));
    writeFileSync(join(proyecto, 'demo.config.mjs'), `export default {
        baseURL: '${juguete.url}',
        marca: { nombre: 'Juguete' },
        login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
        actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
        guiones: './guiones',
        salida: './salida',
        video: { ancho: 800, alto: 600, pausaMinima: 600 },
    };`);

    try {
        const config = await cargarConfig(proyecto);
        const sesiones = await prepararSesiones(config, { dirSesiones: join(proyecto, '.sesiones') });
        const voz = crearVoz({ motor: 'ninguno', respaldo: 'ninguno' });

        const guion = { id: 'recorrido', titulo: 'Recorrido', escenas: [
            { id: 'panel', titulo: 'Panel', pasos: [{ actor: 'funcionario', narrar: 'Abre el panel.',
              hacer: async (page) => { await page.goto('/panel'); } }] },
            { id: 'detalle', titulo: 'Detalle', pasos: [{ actor: 'funcionario', narrar: 'Ve el detalle.',
              hacer: async (page) => { await page.goto('/detalle/11111111-1'); } }] },
        ] };

        const { pistas, pasos } = await grabar(guion,
            { config, sesiones, salida: config.salida, voz });
        const { mp4, vtt } = await montar({ pistas, pasos, voz, video: config.video },
            { salida: config.salida, nombre: 'recorrido.mp4' });

        assert.ok(existsSync(mp4));
        assert.ok(duracion(mp4) > 1, 'el video no puede quedar vacío');
        assert.match(readFileSync(vtt, 'utf8'), /Abre el panel\./);
    } finally {
        await juguete.cerrar();
    }
});
