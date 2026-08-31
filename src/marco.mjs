import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conPagina } from './render-web.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLANTILLA = join(AQUI, '..', 'plantillas', 'escenario', 'marco.html');

/** Alto de la barra de ventana, en px. Debe coincidir con el CSS de marco.html. */
export const ALTO_BARRA = 38;

/**
 * Calcula dónde queda el hueco del video dentro del marco. Es la geometría que después
 * necesita ffmpeg para pegar el video en el lugar exacto, así que vive acá —una sola
 * fuente de verdad— en vez de recalcularse en presentacion.mjs.
 */
export function geometria({ salida, padding, barra }) {
    const alturaBarra = barra ? ALTO_BARRA : 0;
    const ancho = salida.ancho - padding * 2;
    const alto = salida.alto - padding * 2 - alturaBarra;
    return { x: padding, y: padding + alturaBarra, ancho, alto, alturaBarra };
}

/**
 * Renderiza el PNG del marco una sola vez.
 *
 * El marco NO se dibuja con filtros de ffmpeg por dos razones medidas: `drawtext` no está
 * compilado en el ffmpeg estático (así que la URL de la barra no se puede rotular), y el
 * alfa de `geq` es binario, con lo que las esquinas redondeadas salen con escalón. El
 * navegador da border-radius y box-shadow con antialias real, y ya está en el pipeline.
 */
export async function renderizarMarco({ salida, presentacion, marca, baseURL, devolverTexto = false }) {
    const { ancho, alto } = presentacion.salida;
    const g = geometria(presentacion);
    const fondo = presentacion.fondo
        ?? `linear-gradient(135deg, ${marca.color} 0%, #0f172a 100%)`;
    const png = join(salida, 'marco.png');

    return conPagina({ '/marco.html': PLANTILLA }, async (page, baseUrl) => {
        await page.setViewportSize({ width: ancho, height: alto });
        await page.goto(baseUrl + '/marco.html');
        const texto = await page.evaluate(({ ancho, alto, g, fondo, url, radio }) => {
            // Posiciona los 4 rectángulos del fondo dejando un agujero real para el video.
            const margenArriba = g.y - g.alturaBarra;  // padding
            const margenIzq = g.x;  // padding
            const altoVentana = g.alto + g.alturaBarra;
            const margenAbajo = alto - margenArriba - altoVentana;
            const margenDer = ancho - margenIzq - g.ancho;

            // Rectángulo arriba
            const fondoArriba = document.getElementById('fondo-arriba');
            fondoArriba.style.top = '0';
            fondoArriba.style.left = '0';
            fondoArriba.style.width = ancho + 'px';
            fondoArriba.style.height = margenArriba + 'px';
            fondoArriba.style.background = fondo;

            // Rectángulo abajo
            const fondoAbajo = document.getElementById('fondo-abajo');
            fondoAbajo.style.top = (margenArriba + altoVentana) + 'px';
            fondoAbajo.style.left = '0';
            fondoAbajo.style.width = ancho + 'px';
            fondoAbajo.style.height = margenAbajo + 'px';
            fondoAbajo.style.background = fondo;

            // Rectángulo izquierda
            const fondoIzq = document.getElementById('fondo-izquierda');
            fondoIzq.style.top = margenArriba + 'px';
            fondoIzq.style.left = '0';
            fondoIzq.style.width = margenIzq + 'px';
            fondoIzq.style.height = altoVentana + 'px';
            fondoIzq.style.background = fondo;

            // Rectángulo derecha
            const fondoDer = document.getElementById('fondo-derecha');
            fondoDer.style.top = margenArriba + 'px';
            fondoDer.style.left = (margenIzq + g.ancho) + 'px';
            fondoDer.style.width = margenDer + 'px';
            fondoDer.style.height = altoVentana + 'px';
            fondoDer.style.background = fondo;

            const v = document.getElementById('ventana');
            v.style.setProperty('--radio', radio + 'px');
            v.style.left = g.x + 'px';
            v.style.top = (g.y - g.alturaBarra) + 'px';
            v.style.width = g.ancho + 'px';
            v.style.height = (g.alto + g.alturaBarra) + 'px';
            document.getElementById('hueco').style.height = g.alto + 'px';
            document.getElementById('url').textContent = url;
            return document.getElementById('url').textContent;
        }, { ancho, alto, g, fondo, url: baseURL, radio: presentacion.radio });

        if (devolverTexto) return texto;
        await page.screenshot({ path: png, omitBackground: true, type: 'png' });
        return png;
    });
}
