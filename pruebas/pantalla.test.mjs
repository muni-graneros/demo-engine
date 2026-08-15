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

// Ocupa el hilo a propósito, en forma SÍNCRONA, durante `ms`. Node es de un solo hilo: mientras
// esto corre, no se puede procesar ningún mensaje de E/S en danza, incluido el evento CDP del
// primer frame del screencast. Es una forma real (no simulada) y determinística de reproducir
// la demora bajo carga sin depender de correr la suite dos veces en paralelo ni mockear Date.now
// globalmente — lo segundo se probó y no sirve: Playwright también llama a Date.now() para su
// propio protocolo CDP, así que una secuencia mockeada global se contamina con esas llamadas y
// deja de ser predecible (confirmado instrumentando pantalla.mjs: aparecían llamadas de más entre
// el t0 y el frame, y entre el frame y el finT, ajenas al código de este módulo).
function bloquearHilo(ms) {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { /* nada: es a propósito */ }
}

test('el reloj arranca con la grabación, no con el primer frame: uno tardío igual queda cubierto', async () => {
    // Reproduce el defecto sin la intermitencia de "correr la suite dos veces en paralelo":
    // se bloquea el hilo 300ms justo después de arrancar la grabación, así que el primer frame
    // de CDP —que sin esto llega casi al instante— no se puede procesar hasta que el bloqueo
    // termina. Es, literalmente, la misma causa que bajo carga real: el hilo ocupado retrasa
    // cuándo se atiende el evento del primer frame.
    await conPagina(async (page) => {
        const salida = join(mkdtempSync(join(tmpdir(), 'demo-pantalla-')), 'tardio.mp4');
        const antes = Date.now();
        const grabacion = await iniciarGrabacion(page, { ancho: 800, alto: 600, salida });
        bloquearHilo(300);              // el primer frame queda represado durante este tramo
        await page.waitForTimeout(200); // deja que llegue el frame (ya tarde) y algo de grabación más
        // El "transcurrido" se mide ACÁ, antes de llamar a detener() — no después. detener()
        // hace, recién adentro, dos cosas que no son parte de lo que este test mide: encodear
        // con ffmpeg (que bajo carga paralela puede tardar bastante) y drenar frames en vuelo.
        // Medir después de eso infla `transcurrido` con tiempo de encode que el video —cuya
        // duración depende de `finT`, capturado al ENTRAR a detener(), no al salir— nunca
        // prometió cubrir. Confirmado corriendo esto bajo carga real (dos `npm test` en
        // paralelo): sin este ajuste, el propio test salía intermitente por esta razón, no por
        // el defecto que se quiere cazar.
        const antesDeDetener = Date.now();
        const archivo = await grabacion.detener();
        const transcurrido = (antesDeDetener - antes) / 1000;

        const seg = duracion(archivo);
        // Con el reloj bien puesto, el video cubre casi todo el tiempo real transcurrido desde
        // que arrancó la grabación (~0.5s). Si el reloj arrancara con el primer frame (el
        // defecto), el video saldría corto en, justamente, los 300ms que duró el bloqueo.
        assert.ok(seg > transcurrido * 0.8,
            `el video duró ${seg}s pero la grabación cubrió ${transcurrido.toFixed(2)}s: ` +
            'el tramo antes del primer frame se perdió');
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
