/**
 * Subtítulos quemados y rótulos de escena del acabado (spec 2026-10-02-video-moderno).
 *
 * Todo el texto se dibuja en Chromium, como el resto del motor (el ffmpeg estático no trae
 * `drawtext`): un PNG del tamaño del lienzo, transparente salvo el texto, por cada ESTADO distinto
 * de la capa (qué cue se ve; en qué cuadro de su animación está un rótulo). Después cada pieza
 * del video se lleva su tramo de la capa como una lista del demuxer `concat` y se pega encima con
 * `overlay`, DESPUÉS de la cámara: el texto queda fijo aunque la cámara se mueva.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { conPagina } from '../render-web.mjs';
import { partirCues } from '../subtitulos.mjs';

/** Cola de voz que se le deja al cue después de la última sílaba: que no desaparezca en seco. */
const COLA_VOZ_S = 0.25;
/** Un hueco entre dos cues más corto que esto se rellena con el anterior: sin parpadeo. */
const HUECO_SIN_PARPADEO_S = 0.35;

/**
 * Los cues que se queman (y los mismos que van al `.vtt`): partidos igual que siempre (42×2),
 * pero sobre el tramo de la VOZ —inicio del paso + duración de su locución— y no el del paso
 * entero. Con el tramo del paso, la última frase de un paso largo seguía en pantalla diez
 * segundos después de dicha.
 *
 * @param {Array<{inicioSeg:number, finSeg:number, narrar?:string, vozSeg?:number|null}>} segmentos
 */
export function cuesDeVoz(segmentos) {
    const base = segmentos
        .filter((s) => s.narrar?.trim())
        .map((s) => {
            const finVoz = s.vozSeg > 0 ? s.inicioSeg + s.vozSeg + COLA_VOZ_S : s.finSeg;
            return { inicioSeg: s.inicioSeg, finSeg: Math.max(s.inicioSeg + 0.5, Math.min(s.finSeg, finVoz)), narrar: s.narrar.trim() };
        });
    return sinParpadeo(partirCues(base));
}

/** Estira cada cue hasta el siguiente si el hueco es imperceptible, y recorta solapes. */
export function sinParpadeo(cues, hueco = HUECO_SIN_PARPADEO_S) {
    const orden = [...cues].sort((a, b) => a.inicioSeg - b.inicioSeg).map((c) => ({ ...c }));
    for (let i = 0; i < orden.length - 1; i++) {
        const sig = orden[i + 1];
        if (sig.inicioSeg - orden[i].finSeg < hueco) orden[i].finSeg = sig.inicioSeg;
    }
    return orden.filter((c) => c.finSeg > c.inicioSeg);
}

/**
 * Un rótulo por escena (su título, con el del guion como antetítulo), al entrar en ella. No en un
 * tramo plano (portada o cierre: ya son un rótulo) y no si la escena no trae título.
 *
 * @param {Array<{inicioSeg:number, finSeg:number, escena:string, titulo?:string, plano?:string|null}>} segmentos
 */
export function rotulosDeEscenas(segmentos, { segundos = 3.2, antetitulo = '' } = {}) {
    const fuera = [];
    let anterior = null;
    for (const s of segmentos) {
        if (s.escena === anterior) continue;
        anterior = s.escena;
        if (s.plano || !s.titulo?.trim()) continue;
        fuera.push({ inicio: s.inicioSeg, fin: s.inicioSeg + segundos, titulo: s.titulo.trim(), antetitulo });
    }
    // Dos escenas muy seguidas: el rótulo de la primera se corta donde empieza el siguiente.
    for (let i = 0; i < fuera.length - 1; i++) fuera[i].fin = Math.min(fuera[i].fin, fuera[i + 1].inicio);
    return fuera.filter((r) => r.fin - r.inicio >= 1);
}

const ENTRADA_S = 0.4;
const SALIDA_S = 0.35;
const PASOS_POR_SEG = 30;

/**
 * Estados de una capa en el tiempo: tramos `{ inicio, fin, clave, datos }` que no se pisan; lo que
 * no cubren es transparente. Los subtítulos tienen un estado por cue; los rótulos, además, un
 * estado por cuadro de su entrada (deslizan y aparecen) y de su salida (se desvanecen).
 */
export function estadosDeSubtitulos(cues, { lateralEn = () => false } = {}) {
    return cues.map((c, i) => {
        // Con un teléfono solo en pantalla, abajo al centro la píldora tapaba lo de más abajo del
        // teléfono (el botón de pánico): ahí va al costado derecho, en el espacio libre.
        const lateral = lateralEn((c.inicioSeg + c.finSeg) / 2);
        return { inicio: c.inicioSeg, fin: c.finSeg, clave: `sub-${i}${lateral ? '-l' : ''}`, datos: { tipo: 'subtitulo', texto: c.narrar, lateral } };
    });
}

export function estadosDeRotulos(rotulos) {
    const estados = [];
    const easeOut = (u) => 1 - (1 - u) ** 3;
    rotulos.forEach((r, i) => {
        const dura = r.fin - r.inicio;
        const entrada = Math.min(ENTRADA_S, dura / 3);
        const salida = Math.min(SALIDA_S, dura / 3);
        const nEntrada = Math.max(1, Math.round(entrada * PASOS_POR_SEG));
        const nSalida = Math.max(1, Math.round(salida * PASOS_POR_SEG));
        const datos = (fase) => ({ tipo: 'rotulo', titulo: r.titulo, antetitulo: r.antetitulo, ...fase });
        for (let k = 0; k < nEntrada; k++) {
            const u = easeOut((k + 1) / nEntrada);
            estados.push({ inicio: r.inicio + (k * entrada) / nEntrada, fin: r.inicio + ((k + 1) * entrada) / nEntrada,
                clave: `rot-${i}-e${k}`, datos: datos({ opacidad: u, desplazamiento: Math.round((1 - u) * 48) }) });
        }
        estados.push({ inicio: r.inicio + entrada, fin: r.fin - salida, clave: `rot-${i}`, datos: datos({ opacidad: 1, desplazamiento: 0 }) });
        for (let k = 0; k < nSalida; k++) {
            const u = 1 - (k + 1) / (nSalida + 1);
            estados.push({ inicio: r.fin - salida + (k * salida) / nSalida, fin: r.fin - salida + ((k + 1) * salida) / nSalida,
                clave: `rot-${i}-s${k}`, datos: datos({ opacidad: u, desplazamiento: 0 }) });
        }
    });
    return estados.filter((e) => e.fin > e.inicio);
}

const escapar = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** El HTML de un estado. Exportado para probar el contraste y los textos sin abrir Chromium. */
export function htmlDeEstado(datos, { lienzo, marca = null, tamano = 34 }) {
    const fuente = "'Noto Sans','Inter','DejaVu Sans',system-ui,sans-serif";
    if (datos.tipo === 'subtitulo' && datos.lateral) {
        const ancho = Math.round(lienzo.ancho * 0.27);
        return `<div style="position:absolute;top:0;bottom:0;right:${Math.round(lienzo.ancho * 0.045)}px;display:flex;align-items:center">`
            + `<div style="width:${ancho}px;padding:${Math.round(tamano * 0.6)}px ${Math.round(tamano * 0.75)}px;`
            + `border-radius:${Math.round(tamano * 0.55)}px;background:rgba(15,23,42,.88);color:#fff;`
            + `font:600 ${Math.round(tamano * 1.06)}px/1.4 ${fuente};text-align:left;white-space:normal;`
            + `box-shadow:0 6px 24px rgba(0,0,0,.35)">${escapar(datos.texto.replace(/\n/g, ' '))}</div></div>`;
    }
    if (datos.tipo === 'subtitulo') {
        return `<div style="position:absolute;left:0;right:0;bottom:${Math.round(lienzo.alto * 0.045)}px;display:flex;justify-content:center">`
            + `<div style="max-width:${Math.round(lienzo.ancho * 0.74)}px;padding:${Math.round(tamano * 0.32)}px ${Math.round(tamano * 0.8)}px;`
            + `border-radius:${Math.round(tamano * 0.55)}px;background:rgba(15,23,42,.88);color:#fff;`
            + `font:600 ${tamano}px/1.34 ${fuente};text-align:center;white-space:pre-line;letter-spacing:.005em;`
            + `box-shadow:0 6px 24px rgba(0,0,0,.35)">${escapar(datos.texto)}</div></div>`;
    }
    const acento = marca?.color ?? '#1e3a8a';
    return `<div style="position:absolute;top:${Math.round(lienzo.alto * 0.018)}px;right:${Math.round(lienzo.ancho * 0.033)}px;`
        + `opacity:${datos.opacidad.toFixed(3)};transform:translateX(${datos.desplazamiento}px);`
        + `display:flex;align-items:stretch;gap:14px;padding:12px 22px 12px 16px;border-radius:14px;`
        + `background:rgba(15,23,42,.9);color:#fff;font-family:${fuente};box-shadow:0 8px 28px rgba(0,0,0,.35)">`
        + `<div style="width:6px;border-radius:3px;background:${escapar(acento)}"></div><div>`
        + (datos.antetitulo ? `<div style="font:600 15px/1.2 ${fuente};letter-spacing:.08em;text-transform:uppercase;color:#cbd5e1">${escapar(datos.antetitulo)}</div>` : '')
        + `<div style="font:700 28px/1.25 ${fuente};margin-top:2px">${escapar(datos.titulo)}</div></div></div>`;
}

/**
 * Dibuja un PNG por estado distinto (en una sola sesión de Chromium) y devuelve los estados con
 * su `png`, más el PNG transparente para los huecos.
 */
export async function renderizarEstados(estados, { lienzo, marca = null, tamano = 34, dir }) {
    mkdirSync(dir, { recursive: true });
    const vacio = join(dir, 'vacio.png');
    const porClave = new Map();
    await conPagina({}, async (page) => {
        await page.setViewportSize({ width: lienzo.ancho, height: lienzo.alto });
        await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent;width:${lienzo.ancho}px;height:${lienzo.alto}px;position:relative;overflow:hidden"><div id="c"></div></body>`);
        await page.screenshot({ path: vacio, omitBackground: true });
        for (const e of estados) {
            if (porClave.has(e.clave)) continue;
            const png = join(dir, `${e.clave}.png`);
            await page.evaluate((html) => { document.getElementById('c').innerHTML = html; }, htmlDeEstado(e.datos, { lienzo, marca, tamano }));
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({ path: png, omitBackground: true });
            porClave.set(e.clave, png);
        }
    });
    return { estados: estados.map((e) => ({ ...e, png: porClave.get(e.clave) })), vacio };
}

/**
 * La lista del demuxer `concat` con el tramo `[desde, hasta)` de la capa, en el reloj de la pieza
 * (empieza en 0). Devuelve `null` si en ese tramo la capa está vacía: la pieza no la necesita.
 */
export function listaDeCapa(estados, vacio, { desde, hasta }) {
    const dentro = estados
        .filter((e) => e.fin > desde && e.inicio < hasta)
        .sort((a, b) => a.inicio - b.inicio);
    if (!dentro.length) return null;
    const lineas = [];
    let reloj = desde;
    const agregar = (png, fin) => {
        const dura = Math.min(fin, hasta) - reloj;
        if (dura <= 1e-6) return;
        lineas.push(`file '${png.replace(/'/g, "'\\''")}'`, `duration ${dura.toFixed(6)}`);
        reloj += dura;
    };
    for (const e of dentro) {
        if (e.inicio > reloj) agregar(vacio, e.inicio);
        agregar(e.png, e.fin);
    }
    if (reloj < hasta) agregar(vacio, hasta);
    // El concat ignora la duración del ÚLTIMO archivo si no se repite.
    lineas.push(lineas.at(-2));
    return `ffconcat version 1.0\n${lineas.join('\n')}\n`;
}

/** Escribe la lista de una pieza (o nada) y devuelve su ruta o `null`. */
export function escribirListaDeCapa(estados, vacio, tramo, ruta) {
    const texto = listaDeCapa(estados, vacio, tramo);
    if (!texto) return null;
    writeFileSync(ruta, texto);
    return ruta;
}
