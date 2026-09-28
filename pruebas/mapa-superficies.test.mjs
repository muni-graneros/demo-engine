import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { RUTA_FFMPEG as ffmpegPath, duracion } from '../src/ffmpeg.mjs';
import { renderizarMapa } from '../src/mapa-superficies.mjs';

// Los mismos datos para las dos pruebas: dos superficies, la sala activa y el vecino anterior.
const datos = () => ({
    superficies: {
        vecino: { nombre: 'App del vecino', tipo: 'telefono', icono: 'phone', color: '#9a3412' },
        sala: { nombre: 'Sala de operaciones', tipo: 'escritorio', icono: 'monitor', color: '#1e3a8a' },
    },
    flujo: [['vecino', 'sala']], activa: 'sala', anterior: 'vecino',
    lienzo: { ancho: 1920, alto: 1080 }, marca: { color: '#1e3a8a' }, ms: 2500,
    salida: mkdtempSync(join(tmpdir(), 'mapa-')), nombre: 'mapa.mp4',
});

test('el clip de la tarjeta dura ms, tiene el tamaño del lienzo y no trae audio', async () => {
    const mp4 = await renderizarMapa(datos());
    assert.ok(Math.abs(duracion(mp4) - 2.5) < 0.1);
    const info = spawnSync(ffmpegPath, ['-i', mp4]).stderr.toString();
    assert.match(info, /1920x1080/);
    assert.doesNotMatch(info, /Audio:/);
});

test('la tarjeta rotula "Usted está aquí" solo en la activa', async () => {
    // renderizarMapa acepta devolverTexto:true (como renderizarMarco) y devuelve el innerText.
    const texto = await renderizarMapa({ ...datos(), devolverTexto: true });
    assert.equal(texto.match(/Usted está aquí/g).length, 1);
});
