import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conPagina } from './render-web.mjs';
import { fondoDelMarco } from './marco.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
// En src/ y no en plantillas/ por el mismo motivo que marco.html: es un interno del motor,
// `demo init` no tiene que copiarlo al proyecto del usuario.
const PLANTILLA = join(AQUI, 'escenario', 'lienzo.html');

/** Alto de la barra de la ventana, en px (mismo valor que en marco.mjs). */
export const ALTO_BARRA = 38;
/** Bisel del teléfono: fino a los lados, grueso arriba y abajo como un equipo real. */
const BISEL = { lado: 18, arriba: 56, abajo: 56 };
const ALTO_CHIP = 56;   // 44 del chip + 12 de aire hasta el panel
const RADIO_TELEFONO = 44;
const RADIO_PANTALLA = 28;   // radio del hueco del teléfono: el de la carcasa menos el bisel, aprox.
const RADIO_VENTANA = 12;
// ffmpeg con yuv420p exige dimensiones y posiciones pares al superponer; redondear acá evita
// que el overlay corra el video medio píxel respecto del hueco.
const par = (n) => Math.floor(n / 2) * 2;

const TIPOS = ['ventana', 'telefono'];

/** Lo que el panel agrega alrededor de su hueco: bisel o barra, y el chip encima. */
function extras(panel) {
    return {
        ancho: panel.tipo === 'telefono' ? BISEL.lado * 2 : 0,
        alto: (panel.tipo === 'telefono' ? BISEL.arriba + BISEL.abajo : ALTO_BARRA) + (panel.chip ? ALTO_CHIP : 0),
    };
}

/**
 * Posiciona un hueco de `ancho`×`alto` ya decidido: centrado en horizontal en `caja` y con el
 * panel completo (chip + bisel/barra + hueco) centrado en vertical.
 */
function ubicar(caja, panel, ancho, alto) {
    const altoTotal = alto + extras(panel).alto;
    const x = par(caja.x + (caja.ancho - ancho) / 2);
    const arribaPanel = caja.y + (caja.alto - altoTotal) / 2 + (panel.chip ? ALTO_CHIP : 0);
    const y = par(arribaPanel + (panel.tipo === 'telefono' ? BISEL.arriba : ALTO_BARRA));
    return { x, y, ancho, alto };
}

/** Mayor hueco del aspecto pedido que cabe en `caja`, con el panel (y su chip) centrados. */
function huecoEnCaja(caja, panel) {
    const e = extras(panel);
    const maxAncho = caja.ancho - e.ancho;
    const maxAlto = caja.alto - e.alto;
    let ancho = maxAncho, alto = ancho / panel.aspecto;
    if (alto > maxAlto) { alto = maxAlto; ancho = alto * panel.aspecto; }
    return ubicar(caja, panel, par(ancho), par(alto));
}

/**
 * Dónde queda la "pantalla" (el hueco donde ffmpeg pega el video) de cada panel. Es PURA y
 * es la única fuente de verdad de esa geometría: el render del PNG y el compuesto la leen de
 * acá, así que no pueden desalinearse.
 *
 * Con dos paneles el ancho se reparte EN PROPORCIÓN al aspecto y ambas pantallas comparten
 * alto. Con columnas iguales, un teléfono angosto desperdiciaba media pantalla y la ventana
 * quedaba encogida a ~864 px; así el grupo llena el ancho útil y queda centrado.
 */
export function geometriaLienzo({ lienzo, paneles, padding = 64 }) {
    if (!Array.isArray(paneles) || paneles.length < 1 || paneles.length > 2) {
        throw new Error(`geometriaLienzo: se esperan 1 o 2 paneles, llegaron ${paneles?.length}`);
    }
    for (const p of paneles) {
        if (!TIPOS.includes(p.tipo)) throw new Error(`geometriaLienzo: tipo de panel desconocido «${p.tipo}» (válidos: ${TIPOS.join(', ')})`);
    }
    const util = { x: padding, y: padding, ancho: lienzo.ancho - padding * 2, alto: lienzo.alto - padding * 2 };
    if (paneles.length === 1) return [huecoEnCaja(util, paneles[0])];

    const sep = padding / 2;
    const e = paneles.map(extras);
    const sumaExtrasAncho = e.reduce((s, x) => s + x.ancho, 0);
    const sumaAspectos = paneles.reduce((s, p) => s + p.aspecto, 0);
    const H = Math.min(
        Math.min(...e.map((x) => util.alto - x.alto)),
        (util.ancho - sep - sumaExtrasAncho) / sumaAspectos,
    );
    const alto = par(H);
    const anchos = paneles.map((p) => par(H * p.aspecto));
    const resto = util.ancho - sep - anchos.reduce((s, a, i) => s + a + e[i].ancho, 0);
    let cursor = util.x + resto / 2;
    return paneles.map((p, i) => {
        const caja = { x: cursor, y: util.y, ancho: anchos[i] + e[i].ancho, alto: util.alto };
        cursor += caja.ancho + sep;
        return ubicar(caja, p, anchos[i], alto);
    });
}

/**
 * Renderiza el PNG del lienzo: fondo de marca, cada panel con su bisel de teléfono o su barra
 * de ventana, el chip que rotula la superficie, y los huecos TRANSPARENTES.
 *
 * Por qué una máscara y no los cuatro rectángulos de marco.mjs: con dos paneles los
 * rectángulos se multiplican y las esquinas redondeadas pedían otra pieza por esquina. Un
 * único `mask-image` (SVG con los huecos perforados por evenodd) recorta a la vez el fondo y
 * los cuerpos de los paneles, con el antialias del navegador en las esquinas. El fondo es un
 * solo div a pantalla completa, así que el gradiente sale continuo entre paneles.
 *
 * El chip lleva ícono y texto (el color nunca es el único portador de la superficie) y el
 * texto elige #fff o #0f172a según cuál contraste más con `chip.color`. `devolverContraste`
 * devuelve el peor ratio WCAG entre los chips, medido sobre los colores ya computados por el
 * navegador —es lo que realmente se pinta, no lo que el JS creyó elegir—. Si ningún panel
 * lleva chip, `contraste` es `null`. Con `devolverContraste` también vuelve `chips`: el
 * rectángulo de cada chip junto al de su panel y si el texto quedó recortado, para poder
 * comprobar que un nombre largo no se sale de su columna (`columna`: el espacio libre del panel).
 */
export async function renderizarLienzo({ lienzo, paneles, marca, salida, nombre = 'lienzo.png', padding = 64, devolverContraste = false }) {
    const huecos = geometriaLienzo({ lienzo, paneles, padding });
    const fondo = fondoDelMarco({}, marca);
    const png = join(salida, nombre);

    const medido = await conPagina({ '/lienzo.html': PLANTILLA }, async (page, baseUrl) => {
        await page.setViewportSize({ width: lienzo.ancho, height: lienzo.alto });
        await page.goto(baseUrl + '/lienzo.html');
        const medido = await page.evaluate(({ lienzo, paneles, huecos, fondo, padding, K }) => {
            const raiz = document.getElementById('raiz');
            const crear = (padre, estilos = {}, etiqueta = 'div') => {
                const el = document.createElement(etiqueta);
                Object.assign(el.style, estilos);
                padre.appendChild(el);
                return el;
            };
            const px = (n) => n + 'px';

            // Rectángulo redondeado como path, con radios por esquina: la ventana redondea solo
            // abajo porque arriba empalma con la barra; si redondeara arriba, asomaría el fondo
            // entre la barra y el video.
            const rectRedondeado = ({ x, y, ancho: w, alto: h }, [si, sd, id, ii]) =>
                `M${x + si} ${y}H${x + w - sd}A${sd} ${sd} 0 0 1 ${x + w} ${y + sd}`
                + `V${y + h - id}A${id} ${id} 0 0 1 ${x + w - id} ${y + h}`
                + `H${x + ii}A${ii} ${ii} 0 0 1 ${x} ${y + h - ii}`
                + `V${y + si}A${si} ${si} 0 0 1 ${x + si} ${y}Z`;
            const radiosHueco = (p) => p.tipo === 'telefono'
                ? [K.RADIO_PANTALLA, K.RADIO_PANTALLA, K.RADIO_PANTALLA, K.RADIO_PANTALLA]
                : [0, 0, K.RADIO_VENTANA, K.RADIO_VENTANA];
            const d = `M0 0H${lienzo.ancho}V${lienzo.alto}H0Z`
                + paneles.map((p, i) => rectRedondeado(huecos[i], radiosHueco(p))).join('');
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lienzo.ancho}" height="${lienzo.alto}">`
                + `<path fill="#000" fill-rule="evenodd" d="${d}"/></svg>`;
            const mascara = {
                maskImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
                webkitMaskImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
                maskSize: '100% 100%', webkitMaskSize: '100% 100%',
                maskRepeat: 'no-repeat', webkitMaskRepeat: 'no-repeat',
            };
            const capa = { position: 'fixed', inset: '0', ...mascara };

            crear(raiz, { ...capa, background: fondo });
            // Carcasas, barras y sombras en una capa con la MISMA máscara: la sombra de la
            // ventana y el cuerpo del teléfono no pueden oscurecer el hueco del video.
            const cuerpos = crear(raiz, capa);
            const sombra = '0 30px 60px rgba(0,0,0,.45), 0 8px 20px rgba(0,0,0,.3)';
            const iconos = {
                monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
                phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
            };

            // Caja de cada panel (carcasa o ventana con su barra), calculada de antemano: la
            // columna del chip de un panel depende de dónde empieza el panel vecino.
            const cajaDe = (p, h) => (p.tipo === 'telefono'
                ? { x: h.x - K.BISEL.lado, y: h.y - K.BISEL.arriba, ancho: h.ancho + K.BISEL.lado * 2, alto: h.alto + K.BISEL.arriba + K.BISEL.abajo }
                : { x: h.x, y: h.y - K.ALTO_BARRA, ancho: h.ancho, alto: h.alto + K.ALTO_BARRA });
            const cajas = paneles.map((p, i) => cajaDe(p, huecos[i]));
            // Columna del chip: el espacio horizontal libre del panel, desde el borde útil del
            // lienzo (o el final del panel anterior) hasta el comienzo del siguiente (o el borde
            // útil). El chip nombra la superficie —el color no puede ser lo único, WCAG 1.4.1—, y
            // limitarlo al ancho de la carcasa del teléfono lo dejaba en «App de…».
            const AIRE = 16;
            const columnas = cajas.map((c, i) => {
                const izq = i === 0 ? padding : cajas[i - 1].x + cajas[i - 1].ancho + AIRE;
                const der = i === cajas.length - 1 ? lienzo.ancho - padding : cajas[i + 1].x - AIRE;
                return { x: izq, ancho: Math.max(0, der - izq) };
            });

            paneles.forEach((p, i) => {
                const h = huecos[i];
                const caja = cajas[i];
                if (p.tipo === 'telefono') {
                    const cuerpo = crear(cuerpos, {
                        position: 'fixed', left: px(caja.x), top: px(caja.y), width: px(caja.ancho), height: px(caja.alto),
                        boxSizing: 'border-box', background: '#0b0b0f', borderRadius: px(K.RADIO_TELEFONO),
                        // Filete claro: sin él, la carcasa negra se funde con un fondo oscuro.
                        border: '2px solid #2a2a33', boxShadow: sombra,
                    });
                    // Isla de cámara genérica: ninguna marca comercial.
                    crear(cuerpo, {
                        position: 'absolute', left: '50%', top: px(16 - 2), width: '90px', height: '24px',
                        transform: 'translateX(-50%)', background: '#000', borderRadius: '12px',
                    });
                } else {
                    const ventana = crear(cuerpos, {
                        position: 'fixed', left: px(caja.x), top: px(caja.y), width: px(caja.ancho), height: px(caja.alto),
                        borderRadius: px(K.RADIO_VENTANA), boxShadow: sombra, overflow: 'hidden',
                    });
                    // Misma estética que la barra de marco.html.
                    const barra = crear(ventana, {
                        display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', height: px(K.ALTO_BARRA),
                        background: '#1f2937', font: '13px/1 system-ui,sans-serif', color: '#cbd5e1',
                    });
                    for (const c of ['#ef4444', '#f59e0b', '#22c55e']) {
                        crear(barra, { width: '11px', height: '11px', borderRadius: '50%', background: c, flex: 'none' }, 'span');
                    }
                    const url = crear(barra, {
                        flex: '1', textAlign: 'center', background: '#111827', borderRadius: '6px', padding: '5px 10px',
                        color: '#e5e7eb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }, 'span');
                    url.textContent = p.url ?? '';
                }

                if (!p.chip) return;
                const columna = columnas[i];
                // Fuera de la capa enmascarada: el chip nunca pisa un hueco (va 56 px arriba).
                const chip = crear(raiz, {
                    position: 'fixed', left: px(caja.x), top: px(caja.y - K.ALTO_CHIP), height: '44px',
                    boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '0 18px',
                    borderRadius: '22px', background: p.chip.color, whiteSpace: 'nowrap',
                    // Un nombre que no cabe ni en la columna se recorta con elipsis: nunca se
                    // sale del lienzo ni se mete encima del panel vecino.
                    maxWidth: px(columna.ancho),
                    font: '600 20px/1 system-ui,sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,.25)',
                });
                chip.className = 'chip';
                chip.dataset.panel = JSON.stringify(caja);
                chip.dataset.columna = JSON.stringify(columna);
                chip.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"`
                    + ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:none">${iconos[p.chip.icono] ?? iconos.monitor}</svg>`;
                crear(chip, { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis' }, 'span').textContent = p.chip.nombre;
                // Posición: la ventana lo alinea a su borde izquierdo, como una pestaña. Un chip
                // más ancho que su panel (el teléfono, casi siempre) se centra sobre él, y se
                // corre lo justo para quedar dentro de su columna.
                const w = chip.getBoundingClientRect().width;
                const deseada = w > caja.ancho ? caja.x + caja.ancho / 2 - w / 2 : caja.x;
                const x = Math.min(Math.max(deseada, columna.x), columna.x + columna.ancho - w);
                chip.style.left = px(x);
            });

            // Contraste WCAG 2.x a partir de los colores computados (rgb(...)), no del string
            // de entrada: así cualquier notación CSS de chip.color funciona igual.
            const rgb = (css) => css.match(/[\d.]+/g).slice(0, 3).map(Number);
            const lum = (css) => {
                const [r, g, b] = rgb(css).map((v) => {
                    const c = v / 255;
                    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                });
                return 0.2126 * r + 0.7152 * g + 0.0722 * b;
            };
            const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
            let peor = Infinity;
            const chips = [];
            for (const chip of document.querySelectorAll('.chip')) {
                const fondoChip = getComputedStyle(chip).backgroundColor;
                chip.style.color = ratio('rgb(255,255,255)', fondoChip) >= ratio('rgb(15,23,42)', fondoChip) ? '#fff' : '#0f172a';
                peor = Math.min(peor, ratio(getComputedStyle(chip).color, fondoChip));
                const r = chip.getBoundingClientRect();
                const texto = chip.querySelector('span');
                chips.push({ x: r.x, ancho: r.width, panel: JSON.parse(chip.dataset.panel), columna: JSON.parse(chip.dataset.columna), recortado: texto.scrollWidth > texto.clientWidth });
            }
            return { contraste: Number.isFinite(peor) ? peor : null, chips };
        }, { lienzo, paneles, huecos, fondo, padding, K: { ALTO_BARRA, BISEL, ALTO_CHIP, RADIO_TELEFONO, RADIO_PANTALLA, RADIO_VENTANA } });

        // Que la fuente del sistema esté cargada antes de la foto: si no, el chip puede salir
        // con la métrica del fallback y el texto corrido.
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: png, omitBackground: true, type: 'png' });
        return medido;
    });

    return devolverContraste ? { png, huecos, ...medido } : { png, huecos };
}
