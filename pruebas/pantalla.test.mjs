import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { iniciarGrabacion } from '../src/pantalla.mjs';
import { duracion } from '../src/ffmpeg.mjs';

async function conPagina(fn) {
    const juguete = await iniciarJuguete({ puerto: 0 });
    const navegador = await chromium.launch();
    const page = await navegador.newPage({ viewport: { width: 800, height: 600 } });
    try {
        await page.goto(`${juguete.url}/`);
        await fn(page, juguete);
    } finally {
        await navegador.close();
        await juguete.cerrar();
    }
}

test('graba un video legible con el tamaño pedido', async () => {
    await conPagina(async (page) => {
        const salida = join(mkdtempSync(join(tmpdir(), 'demo-pantalla-')), 'video.mp4');
        const grabacion = await iniciarGrabacion(page, { ancho: 800, alto: 600, salida });
        await page.waitForTimeout(400);
        const archivo = await grabacion.detener();

        assert.equal(archivo, salida);
        assert.ok(existsSync(salida), 'no se escribió el archivo de video');
        assert.ok(duracion(salida) > 0, 'el video debe tener alguna duración');
    });
});

test('una pantalla QUIETA igual produce un video de la duración real transcurrida (no se acelera)', async () => {
    // Esto es lo que rompe si se trata cada frame de CDP como equidistante: el screencast no
    // emite nada mientras la página no cambia, y sin sostener el último frame el video de un
    // tramo quieto de 2s saldría de una fracción de segundo.
    await conPagina(async (page) => {
        const salida = join(mkdtempSync(join(tmpdir(), 'demo-pantalla-')), 'quieto.mp4');
        const grabacion = await iniciarGrabacion(page, { ancho: 800, alto: 600, salida });
        const antes = Date.now();
        await page.waitForTimeout(2000);   // nada cambia en la página durante este tramo
        const transcurrido = (Date.now() - antes) / 1000;
        const archivo = await grabacion.detener();

        const seg = duracion(archivo);
        assert.ok(seg > transcurrido * 0.7,
            `el video duró ${seg}s pero el tramo quieto duró ${transcurrido.toFixed(2)}s: se aceleró`);
    });
});

test('la calidad es configurable: más calidad pesa más para el mismo contenido', async () => {
    await conPagina(async (page) => {
        const { statSync } = await import('node:fs');
        const dir = mkdtempSync(join(tmpdir(), 'demo-pantalla-'));

        const baja = join(dir, 'baja.mp4');
        const gBaja = await iniciarGrabacion(page, { ancho: 800, alto: 600, salida: baja, calidad: 20 });
        await page.waitForTimeout(500);
        await gBaja.detener();

        const alta = join(dir, 'alta.mp4');
        const gAlta = await iniciarGrabacion(page, { ancho: 800, alto: 600, salida: alta, calidad: 95 });
        await page.waitForTimeout(500);
        await gAlta.detener();

        assert.ok(statSync(alta).size > statSync(baja).size,
            'con más calidad JPEG de origen el video final debería pesar más (misma escena, mismo fps)');
    });
});

test('detener() sin que haya llegado ningún frame igual deja una pista legible', async () => {
    // Caso límite: un paso revienta antes del primer repintado del screencast. El grabador
    // debe poder cerrar la pista igual, no reventar ni dejar el archivo a medio escribir.
    await conPagina(async (page) => {
        const salida = join(mkdtempSync(join(tmpdir(), 'demo-pantalla-')), 'vacio.mp4');
        const grabacion = await iniciarGrabacion(page, { ancho: 800, alto: 600, salida });
        const archivo = await grabacion.detener();   // sin esperar nada: puede que no haya llegado frame

        assert.ok(existsSync(archivo));
        assert.ok(duracion(archivo) >= 0);
    });
});
