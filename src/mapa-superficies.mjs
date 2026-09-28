import { join, dirname } from 'node:path';
import { unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { conPagina } from './render-web.mjs';
import { ff } from './ffmpeg.mjs';
import { fondoDelMarco } from './marco.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
// Igual que marco.html: interno del motor, vive en src/ para que `demo init` no lo copie.
const PLANTILLA = join(AQUI, 'escenario', 'superficies.html');

/**
 * Íconos propios (trazos simples sobre viewBox 24): la config dice `icono: 'phone'` y el motor
 * no debe depender de una librería de íconos ni de red. Un nombre desconocido cae en `globo`
 * en vez de reventar, porque el ícono es decorativo: el nombre de la superficie va escrito.
 */
const ICONOS = {
    phone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    tablet: '<rect x="4" y="2" width="16" height="20" rx="2.5"/><path d="M11 18h2"/>',
    globo: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
};

/**
 * Normaliza un color de superficie a `#rrggbb`. El cálculo de contraste de la etiqueta solo
 * sabe leer hexadecimal; aceptar `rgb()` o nombres CSS en silencio producía un NaN y la
 * etiqueta caía en tinta oscura sin avisar. Mejor un error claro al configurar.
 */
export function normalizarColor(color, id) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) throw new Error(`superficies.${id}.color debe ser hexadecimal (#rgb o #rrggbb), llegó "${color}"`);
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return '#' + h.toLowerCase();
}

/**
 * Renderiza la tarjeta «usted está aquí» y la convierte en un clip de `ms` milisegundos.
 *
 * Es una imagen fija: la entrada animada queda fuera de alcance porque 2,5 s bastan y el
 * curso ya envuelve cada capítulo con su transición 3D. El clip sale SIN pista de audio a
 * propósito: la narración y la música las mezcla el montaje, y una pista muda acá obligaría
 * a quien concatena a lidiar con dos formatos de audio distintos.
 *
 * Los textos (nombre, quién) vienen de la config y se insertan con textContent, nunca como
 * HTML: un nombre con `<` no puede inyectar marcado en la página que se captura.
 *
 * Con `devolverTexto` devuelve el innerText; con `devolverContrastes`, por cada texto
 * (`.nombre`, `.quien`, `.etiqueta`) su contraste real y la opacidad mínima de sus ancestros;
 * con `devolverCajas`, el rectángulo de cada nodo. Son las sondas que usan las pruebas para
 * medir accesibilidad y encuadre en el DOM ya renderizado, no en el CSS escrito.
 *
 * @returns {Promise<string|object[]>} ruta del mp4, o la sonda pedida
 */
export async function renderizarMapa({
    superficies, flujo = [], activa = null, anterior = null, lienzo, marca, ms, salida, nombre,
    devolverTexto = false, devolverContrastes = false, devolverCajas = false,
}) {
    const { ancho, alto } = lienzo;
    const png = join(salida, nombre.replace(/\.mp4$/, '') + '.png');
    const mp4 = join(salida, nombre);
    // Mismo fondo que el marco del video, para que la tarjeta no salte de color al entrar.
    const fondo = fondoDelMarco({}, marca);
    const nodos = Object.entries(superficies).map(([id, s]) => ({
        id, nombre: s.nombre ?? id, quien: s.quien ?? null, color: normalizarColor(s.color ?? '#1e3a8a', id),
        icono: ICONOS[s.icono] ?? ICONOS.globo,
    }));

    const resultado = await conPagina({ '/superficies.html': PLANTILLA }, async (page, baseUrl) => {
        await page.setViewportSize({ width: ancho, height: alto });
        await page.goto(baseUrl + '/superficies.html');
        const sonda = await page.evaluate(({ nodos, flujo, activa, anterior, fondo, k, sondear }) => {
            document.documentElement.style.setProperty('--k', String(k));
            document.body.style.background = fondo;
            document.getElementById('titulo').textContent = activa ? 'Recorrido del caso' : 'Las superficies del sistema';

            // Luminancia relativa WCAG: decide si la etiqueta va en blanco o en tinta oscura
            // sobre el color de la superficie. Con los azules y ladrillos de la config es
            // blanco, pero un color claro declarado por el proyecto dejaba texto ilegible.
            const lum = (hex) => {
                const h = hex.replace('#', '');
                const c = [0, 2, 4].map((i) => parseInt(h.length === 3 ? h[i / 2].repeat(2) : h.slice(i, i + 2), 16) / 255)
                    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
                return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            };
            const contraste = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            const tintaSobre = (hex) => {
                const l = lum(hex);
                return contraste(l, 1) >= contraste(l, lum('#0f172a')) ? '#ffffff' : '#0f172a';
            };

            // Una fila hasta 4; con más, dos filas repartidas lo más parejo posible.
            const porFila = nodos.length > 4 ? Math.ceil(nodos.length / 2) : nodos.length;
            const cont = document.getElementById('nodos');
            let fila;
            const elementos = {};
            nodos.forEach((n, i) => {
                if (i % porFila === 0) { fila = document.createElement('div'); fila.className = 'fila'; cont.appendChild(fila); }
                const el = document.createElement('div');
                el.className = 'nodo';
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('class', 'icono');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', n.color);
                svg.setAttribute('stroke-width', '2');
                svg.setAttribute('stroke-linecap', 'round');
                svg.setAttribute('stroke-linejoin', 'round');
                svg.setAttribute('aria-hidden', 'true');
                svg.innerHTML = n.icono;  // viene del mapa fijo ICONOS, nunca de la config
                el.appendChild(svg);
                const nom = document.createElement('div');
                nom.className = 'nombre';
                nom.textContent = n.nombre;
                el.appendChild(nom);
                if (n.quien) {
                    const q = document.createElement('div');
                    q.className = 'quien';
                    q.textContent = n.quien;
                    el.appendChild(q);
                }
                if (n.id === activa) {
                    el.classList.add('activa');
                    el.style.borderColor = n.color;
                    const et = document.createElement('div');
                    et.className = 'etiqueta';
                    et.textContent = 'Usted está aquí';
                    et.style.background = n.color;
                    et.style.color = tintaSobre(n.color);
                    el.appendChild(et);
                } else if (n.id === anterior) {
                    el.classList.add('anterior');
                } else if (activa) {
                    el.classList.add('atenuada');
                }
                fila.appendChild(el);
                elementos[n.id] = el;
            });

            // Encuadre: con muchas superficies (9 → dos filas de 5) el panel pasaba el ancho del
            // lienzo y nodos y etiqueta quedaban cortados por el overflow:hidden. Todo cuelga de
            // --k, así que se achica --k hasta que el panel quepa con un margen del 4 %. Dos
            // pasadas porque el ajuste de líneas del texto cambia un poco al reducir.
            const panel = document.getElementById('panel');
            for (let i = 0; i < 3; i++) {
                const r = panel.getBoundingClientRect();
                const s = Math.min(1, (innerWidth * 0.96) / r.width, (innerHeight * 0.96) / r.height);
                if (s >= 0.999) break;
                k *= s * 0.99;
                document.documentElement.style.setProperty('--k', String(k));
            }

            // Flechas: se dibujan después del layout, midiendo las cajas reales (con la
            // escala de la activa incluida), y se recortan al borde de cada nodo para que la
            // punta toque la tarjeta en vez de quedar escondida debajo de ella.
            const capa = document.getElementById('flechas');
            const base = capa.getBoundingClientRect();
            const caja = (el) => {
                const r = el.getBoundingClientRect();
                return { cx: r.left + r.width / 2 - base.left, cy: r.top + r.height / 2 - base.top, w: r.width / 2, h: r.height / 2 };
            };
            // Punto donde la recta desde el centro de `b` en dirección (dx,dy) sale de su caja.
            const borde = (b, dx, dy, margen) => {
                const t = Math.min(dx ? (b.w + margen) / Math.abs(dx) : Infinity, dy ? (b.h + margen) / Math.abs(dy) : Infinity);
                return [b.cx + dx * t, b.cy + dy * t];
            };
            const NS = 'http://www.w3.org/2000/svg';
            const defs = document.createElementNS(NS, 'defs');
            capa.appendChild(defs);
            let marcadores = 0;
            const punta = (color) => {
                const id = 'punta' + (marcadores++);
                const m = document.createElementNS(NS, 'marker');
                m.setAttribute('id', id);
                m.setAttribute('viewBox', '0 0 10 10');
                m.setAttribute('refX', '8'); m.setAttribute('refY', '5');
                m.setAttribute('markerWidth', '5'); m.setAttribute('markerHeight', '5');
                m.setAttribute('orient', 'auto-start-reverse');
                const p = document.createElementNS(NS, 'path');
                p.setAttribute('d', 'M0,0 L10,5 L0,10 z');
                p.setAttribute('fill', color);
                m.appendChild(p);
                defs.appendChild(m);
                return id;
            };
            const colorDe = Object.fromEntries(nodos.map((n) => [n.id, n.color]));
            for (const [desde, hasta] of flujo) {
                if (!elementos[desde] || !elementos[hasta]) continue;
                const a = caja(elementos[desde]);
                const b = caja(elementos[hasta]);
                const dx = b.cx - a.cx, dy = b.cy - a.cy;
                const largo = Math.hypot(dx, dy) || 1;
                const [x1, y1] = borde(a, dx / largo, dy / largo, 10 * k);
                const [x2, y2] = borde(b, -dx / largo, -dy / largo, 10 * k);
                // La flecha del traspaso que acaba de ocurrir (anterior → activa) se resalta
                // en grosor y color; las demás quedan como contexto en gris pizarra.
                const resaltada = desde === anterior && hasta === activa;
                // Gris sólido #64748b (4.7:1 sobre blanco): una flecha es gráfico con significado
                // y WCAG 1.4.11 pide ≥3:1; con opacidad .5 bajaba a ~2:1.
                const color = resaltada ? colorDe[hasta] : '#64748b';
                const linea = document.createElementNS(NS, 'line');
                linea.setAttribute('x1', x1); linea.setAttribute('y1', y1);
                linea.setAttribute('x2', x2); linea.setAttribute('y2', y2);
                linea.setAttribute('stroke', color);
                linea.setAttribute('stroke-width', String((resaltada ? 7 : 3) * k));
                linea.setAttribute('stroke-linecap', 'round');
                linea.setAttribute('marker-end', `url(#${punta(color)})`);
                capa.appendChild(linea);
            }
            if (sondear === 'cajas') {
                return [...document.querySelectorAll('.nodo')].map((el) => {
                    const r = el.getBoundingClientRect();
                    const et = el.querySelector('.etiqueta')?.getBoundingClientRect();
                    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                        etiqueta: et ? { left: et.left, top: et.top, right: et.right, bottom: et.bottom } : null };
                });
            }
            if (sondear === 'contrastes') {
                const rgb = (c) => (c.match(/[\d.]+/g) || []).map(Number);
                const lumRgb = ([r, g, b]) => [r, g, b].map((v) => v / 255)
                    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
                    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
                return [...document.querySelectorAll('.nombre, .quien, .etiqueta')].map((el) => {
                    let opacidad = 1;
                    let fondoEl = null;
                    for (let a = el; a; a = a.parentElement) {
                        const cs = getComputedStyle(a);
                        opacidad = Math.min(opacidad, parseFloat(cs.opacity));
                        const bg = rgb(cs.backgroundColor);
                        if (!fondoEl && bg.length >= 3 && (bg.length === 3 || bg[3] === 1)) fondoEl = bg;
                    }
                    const c = contraste(lumRgb(rgb(getComputedStyle(el).color)), lumRgb(fondoEl ?? [255, 255, 255]));
                    return { texto: el.textContent, clase: el.className, contraste: c, opacidad };
                });
            }
            return document.body.innerText;
        }, { nodos, flujo, activa, anterior, fondo, k: ancho / 1920,
            sondear: devolverCajas ? 'cajas' : devolverContrastes ? 'contrastes' : 'texto' });

        if (devolverTexto || devolverContrastes || devolverCajas) return sonda;
        await page.screenshot({ path: png, type: 'png' });
        return png;
    });
    if (devolverTexto || devolverContrastes || devolverCajas) return resultado;

    // Imagen en bucle → h264 yuv420p a 25 fps, sin audio (-an implícito: no hay entrada de audio).
    ff(['-y', '-loop', '1', '-i', png, '-t', String(ms / 1000), '-r', '25',
        '-vf', `scale=${ancho}:${alto},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', mp4]);
    // El PNG era solo un intermedio: dejarlo junto al mp4 ensuciaba la carpeta del curso con
    // un archivo por capítulo que nadie consume.
    unlinkSync(png);
    return mp4;
}
