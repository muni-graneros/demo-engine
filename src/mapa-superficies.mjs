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
 * con `devolverCajas`, el rectángulo de cada nodo; con `devolverFlechas`, los puntos de
 * cada flecha que caen dentro de un nodo ajeno. Son las sondas que usan las pruebas para
 * medir accesibilidad y encuadre en el DOM ya renderizado, no en el CSS escrito.
 *
 * @returns {Promise<string|object[]>} ruta del mp4, o la sonda pedida
 */
export async function renderizarMapa({
    superficies, flujo = [], activa = null, anterior = null, lienzo, marca, ms, salida, nombre,
    devolverTexto = false, devolverContrastes = false, devolverCajas = false, devolverFlechas = false,
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

            // Flechas: se dibujan después del layout, midiendo las cajas reales (con la escala
            // de la activa y su etiqueta incluidas).
            //
            // Entre vecinos de la misma fila la flecha es una recta horizontal. Cualquier otra
            // (salto de fila, arista hacia atrás, nodos no contiguos) se enruta en ángulo recto
            // por el espacio libre: baja o sube al canal entre filas (o a la banda bajo la fila),
            // lo recorre y entra por el borde del destino. Una diagonal pasaba por DETRÁS de los
            // nodos intermedios y se veía cortada; seguridad-graneros tiene 7 superficies (4+3),
            // así que el salto de fila aparece en el tutorial real.
            const capa = document.getElementById('flechas');
            const base = capa.getBoundingClientRect();
            const caja = (id) => {
                const el = elementos[id];
                const r = el.getBoundingClientRect();
                const et = el.querySelector('.etiqueta')?.getBoundingClientRect();
                // La etiqueta sobresale por arriba: cuenta como parte del nodo para no pisarla.
                const top = Math.min(r.top, et ? et.top : r.top);
                return { left: r.left - base.left, right: r.right - base.left, top: top - base.top,
                    bottom: r.bottom - base.top, cx: r.left + r.width / 2 - base.left, cy: r.top + r.height / 2 - base.top };
            };
            const posicion = Object.fromEntries(nodos.map((n, i) => [n.id, { fila: Math.floor(i / porFila), col: i % porFila }]));
            const filas = [...new Set(Object.values(posicion).map((p) => p.fila))].sort((a, b) => a - b);
            const limites = filas.map((f) => {
                const cajas = nodos.filter((n) => posicion[n.id].fila === f).map((n) => caja(n.id));
                return { top: Math.min(...cajas.map((c) => c.top)), bottom: Math.max(...cajas.map((c) => c.bottom)) };
            });
            const ultima = filas.length - 1;

            // Carriles: dos flechas en el mismo canal no se superponen, y dos que salen por el
            // mismo lado de un nodo tampoco comparten su tramo vertical.
            const paso = 20 * k;  // holgura para la flecha resaltada (7 px) junto a una de contexto
            const usoCanal = {};
            const carril = (clave) => {
                const n = usoCanal[clave] = (usoCanal[clave] ?? -1) + 1;
                return n;
            };
            const alterno = (n) => (n % 2 ? 1 : -1) * Math.ceil(n / 2);  // 0, 1, -1, 2, -2…
            const yCanal = (fila, n) => (fila < ultima
                ? (limites[fila].bottom + limites[fila + 1].top) / 2 + alterno(n) * paso
                : limites[fila].bottom + 22 * k + n * paso);
            const xLado = (id, lado) => caja(id).cx + alterno(carril(id + ':' + lado)) * 16 * k;

            // Polilínea ortogonal con codos redondeados (cuadráticas de radio chico).
            const ruta = (pts) => {
                const p = pts.filter((q, i) => i === 0 || Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) > 0.01);
                let d = `M${p[0][0]},${p[0][1]}`;
                for (let i = 1; i < p.length - 1; i++) {
                    const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
                    const lin = Math.hypot(b[0] - a[0], b[1] - a[1]);
                    const lout = Math.hypot(c[0] - b[0], c[1] - b[1]);
                    const din = [(b[0] - a[0]) / lin, (b[1] - a[1]) / lin];
                    const dout = [(c[0] - b[0]) / lout, (c[1] - b[1]) / lout];
                    if (Math.abs(din[0] - dout[0]) + Math.abs(din[1] - dout[1]) < 1e-6) { d += ` L${b[0]},${b[1]}`; continue; }
                    const rr = Math.min(12 * k, lin / 2, lout / 2);
                    d += ` L${b[0] - din[0] * rr},${b[1] - din[1] * rr} Q${b[0]},${b[1]} ${b[0] + dout[0] * rr},${b[1] + dout[1] * rr}`;
                }
                const f = p[p.length - 1];
                return d + ` L${f[0]},${f[1]}`;
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
            const pares = new Set(flujo.map(([a, b]) => a + '>' + b));
            const margen = 10 * k;
            for (const [desde, hasta] of flujo) {
                if (!elementos[desde] || !elementos[hasta]) continue;
                const a = caja(desde), b = caja(hasta);
                const pa = posicion[desde], pb = posicion[hasta];
                let pts;
                if (pa.fila === pb.fila && Math.abs(pa.col - pb.col) === 1) {
                    // Vecinos: recta. Si también existe la vuelta, cada sentido va en su carril.
                    const dy = pares.has(hasta + '>' + desde) ? (pa.col < pb.col ? -1 : 1) * 8 * k : 0;
                    const y = a.cy + dy;
                    pts = pa.col < pb.col ? [[a.right + margen, y], [b.left - margen, y]] : [[a.left - margen, y], [b.right + margen, y]];
                } else {
                    // Canal: el que queda entre las dos filas, o bajo la fila si están en la misma.
                    const baja = pb.fila >= pa.fila;  // la fuente sale por abajo
                    const filaCanal = pb.fila > pa.fila ? pa.fila : pb.fila < pa.fila ? pb.fila : pa.fila;
                    const yg = yCanal(filaCanal, carril('canal' + filaCanal));
                    const x1 = xLado(desde, baja ? 'abajo' : 'arriba');
                    const entraPorArriba = pb.fila > pa.fila;
                    const x2 = xLado(hasta, entraPorArriba ? 'arriba' : 'abajo');
                    const y1 = baja ? a.bottom : a.top;
                    const y2 = entraPorArriba ? b.top - margen : b.bottom + margen;
                    pts = [[x1, y1], [x1, yg], [x2, yg], [x2, y2]];
                }
                // La flecha del traspaso que acaba de ocurrir (anterior → activa) se resalta
                // en grosor y color; las demás quedan como contexto en gris pizarra.
                const resaltada = desde === anterior && hasta === activa;
                // Gris sólido #64748b (4.7:1 sobre blanco): una flecha es gráfico con significado
                // y WCAG 1.4.11 pide ≥3:1; con opacidad .5 bajaba a ~2:1.
                const color = resaltada ? colorDe[hasta] : '#64748b';
                const trazo = document.createElementNS(NS, 'path');
                trazo.setAttribute('d', ruta(pts));
                trazo.setAttribute('fill', 'none');
                trazo.setAttribute('stroke', color);
                trazo.setAttribute('stroke-width', String((resaltada ? 7 : 3) * k));
                trazo.setAttribute('stroke-linecap', 'round');
                trazo.setAttribute('stroke-linejoin', 'round');
                trazo.setAttribute('marker-end', `url(#${punta(color)})`);
                trazo.dataset.desde = desde;
                trazo.dataset.hasta = hasta;
                capa.appendChild(trazo);
            }
            if (sondear === 'flechas') {
                // Muestrea cada trazo y devuelve los puntos que caen dentro de un nodo que no
                // es ni su origen ni su destino: tiene que salir vacío.
                const trazos = [...capa.querySelectorAll('path[data-desde]')];
                const choques = [];
                for (const t of trazos) {
                    const largo = t.getTotalLength();
                    for (let s = 0; s <= largo; s += 3) {
                        const q = t.getPointAtLength(s);
                        for (const n of nodos) {
                            if (n.id === t.dataset.desde || n.id === t.dataset.hasta) continue;
                            const c = caja(n.id);
                            if (q.x > c.left && q.x < c.right && q.y > c.top && q.y < c.bottom) {
                                choques.push(`${t.dataset.desde}→${t.dataset.hasta} pisa ${n.id} en (${q.x.toFixed(0)},${q.y.toFixed(0)})`);
                                break;
                            }
                        }
                    }
                }
                return { trazos: trazos.length, choques };
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
            sondear: devolverFlechas ? 'flechas' : devolverCajas ? 'cajas' : devolverContrastes ? 'contrastes' : 'texto' });

        if (devolverTexto || devolverContrastes || devolverCajas || devolverFlechas) return sonda;
        await page.screenshot({ path: png, type: 'png' });
        return png;
    });
    if (devolverTexto || devolverContrastes || devolverCajas || devolverFlechas) return resultado;

    // Imagen en bucle → h264 yuv420p a 25 fps, sin audio (-an implícito: no hay entrada de audio).
    ff(['-y', '-loop', '1', '-i', png, '-t', String(ms / 1000), '-r', '25',
        '-vf', `scale=${ancho}:${alto},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', mp4]);
    // El PNG era solo un intermedio: dejarlo junto al mp4 ensuciaba la carpeta del curso con
    // un archivo por capítulo que nadie consume.
    unlinkSync(png);
    return mp4;
}
