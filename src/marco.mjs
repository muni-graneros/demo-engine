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
        const texto = await page.evaluate(({ ancho, alto, g, fondo, url, radio, sombra }) => {
            const margenArriba = g.y - g.alturaBarra;  // padding
            const margenIzq = g.x;  // padding
            const altoVentana = g.alto + g.alturaBarra;
            const margenAbajo = alto - margenArriba - altoVentana;
            const margenDer = ancho - margenIzq - g.ancho;

            // Pinta `el` con LA PORCIÓN que le toca de un fondo único del tamaño del frame.
            // Sin el desplazamiento, cada rectángulo dibujaba su propio gradiente de 135° y el
            // fondo salía en cuatro trozos que no empalman entre sí — y tampoco empalmaban con
            // el fondo de la transición 3D, que sí es uno solo (ver src/escenario3d.mjs).
            // El shorthand `background` resetea size y position, así que va primero.
            const pintar = (el, izq, arriba, anchoEl, altoEl) => {
                el.style.left = izq + 'px';
                el.style.top = arriba + 'px';
                el.style.width = anchoEl + 'px';
                el.style.height = altoEl + 'px';
                el.style.background = fondo;
                el.style.backgroundSize = `${ancho}px ${alto}px`;
                el.style.backgroundPosition = `${-izq}px ${-arriba}px`;
            };

            // Los cuatro rectángulos que cubren el fondo dejando el agujero del video.
            pintar(document.getElementById('fondo-arriba'), 0, 0, ancho, margenArriba);
            pintar(document.getElementById('fondo-abajo'), 0, margenArriba + altoVentana, ancho, margenAbajo);
            pintar(document.getElementById('fondo-izquierda'), 0, margenArriba, margenIzq, altoVentana);
            pintar(document.getElementById('fondo-derecha'), margenIzq + g.ancho, margenArriba, margenDer, altoVentana);

            // Las cuatro esquinas del recorte redondeado. `overflow:hidden` NO pinta nada en
            // el sobrante de la esquina: dejaba el PNG transparente ahí y por ese hueco asomaba
            // la esquina cuadrada del video (abajo) o el negro del compuesto (arriba). Cada
            // esquina pinta el fondo y se le saca el disco del radio con una máscara radial,
            // que además llega con antialias del navegador.
            const esquinas = [
                ['esquina-si', margenIzq, margenArriba, '100% 100%'],
                ['esquina-sd', margenIzq + g.ancho - radio, margenArriba, '0% 100%'],
                ['esquina-ii', margenIzq, margenArriba + altoVentana - radio, '100% 0%'],
                ['esquina-id', margenIzq + g.ancho - radio, margenArriba + altoVentana - radio, '0% 0%'],
            ];
            for (const [id, izq, arriba, centro] of esquinas) {
                const el = document.getElementById(id);
                if (radio <= 0) { el.style.display = 'none'; continue; }
                pintar(el, izq, arriba, radio, radio);
                const mascara = `radial-gradient(circle ${radio}px at ${centro},`
                    + ` transparent ${radio - 0.7}px, #000 ${radio + 0.3}px)`;
                el.style.maskImage = mascara;
                el.style.webkitMaskImage = mascara;
            }

            const v = document.getElementById('ventana');
            v.style.setProperty('--radio', radio + 'px');
            v.style.left = g.x + 'px';
            v.style.top = (g.y - g.alturaBarra) + 'px';
            v.style.width = g.ancho + 'px';
            v.style.height = (g.alto + g.alturaBarra) + 'px';
            // `presentacion.sombra` era un interruptor muerto: el box-shadow vivía en el CSS y
            // se dibujaba siempre. Ahora lo decide el JS, que es quien conoce la config.
            v.style.boxShadow = sombra
                ? '0 30px 60px rgba(0,0,0,.45), 0 8px 20px rgba(0,0,0,.3)'
                : 'none';

            // La barra también se dibujaba siempre, aunque `geometria()` ya no le reservara
            // alto: con barra:false tapaba los primeros 38px del video. El alto lo manda el JS
            // (ALTO_BARRA), así que el CSS ya no duplica el número.
            const barra = document.getElementById('barra');
            barra.style.height = g.alturaBarra + 'px';
            barra.style.display = g.alturaBarra > 0 ? 'flex' : 'none';

            document.getElementById('hueco').style.height = g.alto + 'px';
            document.getElementById('url').textContent = url;
            return document.getElementById('url').textContent;
        }, { ancho, alto, g, fondo, url: baseURL, radio: presentacion.radio, sombra: presentacion.sombra });

        if (devolverTexto) return texto;
        await page.screenshot({ path: png, omitBackground: true, type: 'png' });
        return png;
    });
}
