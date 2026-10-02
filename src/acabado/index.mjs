/**
 * Acabado moderno del video (spec 2026-10-02-video-moderno): recorte de silencios, cámara
 * automática, subtítulos y rótulos quemados, y 60 fps.
 *
 * Corre sobre el video MUDO ya compuesto (`montar()` paso 2) y devuelve el video nuevo más todo
 * lo que hay que llevar a su reloj (voces, clics, cues). El trabajo caro —el filtro `perspective`
 * con `eval=frame` rehace su malla en cada cuadro— se reparte en piezas de a lo más
 * `PIEZA_MAX_S` que se codifican en paralelo y se pegan sin recodificar. Las piezas sin cámara no
 * pasan por `perspective`. Cada pieza mide un número ENTERO de cuadros (`-frames:v`), así que
 * pegarlas no corre el reloj.
 */
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ff, ffAsync } from '../ffmpeg.mjs';
import { planDeRecorte } from './tiempo.mjs';
import { planDeCamara, hayCamaraEntre, expresionesPerspectiva, filtroPerspectiva } from './camara.mjs';
import {
    cuesDeVoz, rotulosDeEscenas, estadosDeSubtitulos, estadosDeRotulos, renderizarEstados, escribirListaDeCapa,
} from './capas.mjs';

const PIEZA_MAX_S = 8;
/** Alrededor de cada clic no se corta: se ve llegar el cursor y lo que el clic provoca. */
const PROTEGER_ANTES_S = 1.0;
const PROTEGER_DESPUES_S = 1.2;

export { DEFECTOS_ACABADO } from './defectos.mjs';

/** El plan identidad: nada que recortar. */
function sinRecorte(total) {
    return { cortes: [], total, mapear: (t) => t, mapearEvento: (t) => t, piezas: [{ inicio: 0, fin: total, origen: 0 }] };
}

/** Corre `tareas` (funciones que devuelven promesas) con a lo más `n` a la vez. */
async function enPool(tareas, n) {
    let siguiente = 0;
    const trabajador = async () => {
        while (siguiente < tareas.length) {
            const i = siguiente++;
            await tareas[i]();
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(n, tareas.length)) }, trabajador));
}

/**
 * Parte el reloj nuevo en piezas de a lo más `PIEZA_MAX_S`, alineadas a la grilla de cuadros y
 * sin cruzar un corte (cada pieza sale de UN tramo continuo del original).
 */
export function piezasDelAcabado(plan, fps) {
    const piezas = [];
    for (const p of plan.piezas) {
        const f0 = Math.round(p.inicio * fps);
        const f1 = Math.round(p.fin * fps);
        const paso = PIEZA_MAX_S * fps;
        for (let f = f0; f < f1; f += paso) {
            const fin = Math.min(f1, f + paso);
            piezas.push({ inicio: f / fps, fin: fin / fps, cuadros: fin - f, origen: p.origen + (f / fps - p.inicio) });
        }
    }
    return piezas.filter((p) => p.cuadros > 0);
}

/**
 * @param {object} entrada
 * @param {string} entrada.mudo           video compuesto, sin audio
 * @param {{ancho:number, alto:number}} entrada.lienzo
 * @param {number} entrada.total          largo de `mudo` en segundos
 * @param {object} entrada.opciones       `video.acabado` (ya con defectos)
 * @param {Array} entrada.segmentos       `{ inicioSeg, finSeg, narrar, escena, titulo, plano, vozSeg, sinRecorte }`
 * @param {number[]} entrada.clics        segundos del reloj de `mudo`
 * @param {Array} entrada.focos           `{ t, x, y, encuadre, telefono }` (t en el reloj de `mudo`, x/y en el lienzo)
 * @param {Array} entrada.encuadres       `{ inicio, fin, camara }` en el reloj de `mudo`
 * @param {object} [entrada.marca]
 * @param {string} [entrada.antetitulo]   título del guion, sobre el de cada escena
 * @param {string} entrada.temporal
 * @returns {Promise<{ video:string, total:number, mapear:(t:number)=>number, segmentos:Array, clics:number[], cues:Array }>}
 */
export async function acabar({
    mudo, lienzo, total, opciones, segmentos, clics = [], focos = [], encuadres = [],
    marca = null, antetitulo = '', temporal, paralelo = null,
}) {
    const o = opciones;
    const fps = o.fps ?? 60;
    const dir = join(temporal, 'acabado');
    mkdirSync(dir, { recursive: true });

    // 1. Qué se recorta.
    const voces = segmentos.filter((s) => s.vozSeg > 0).map((s) => ({ inicio: s.inicioSeg, fin: s.inicioSeg + s.vozSeg }));
    const protegidos = [
        ...clics.map((t) => ({ inicio: t - PROTEGER_ANTES_S, fin: t + PROTEGER_DESPUES_S })),
        ...segmentos.filter((s) => s.sinRecorte || s.plano).map((s) => ({ inicio: s.inicioSeg, fin: s.finSeg })),
    ];
    // Sin ninguna voz no hay con qué medir el silencio: todo el video sería «hueco».
    const plan = o.silencios && voces.length
        ? planDeRecorte({ total, voces, protegidos, fps, ...o.silencios })
        : sinRecorte(total);

    // 2. Todo al reloj nuevo.
    const segs = segmentos.map((s) => ({ ...s, inicioSeg: plan.mapear(s.inicioSeg), finSeg: plan.mapear(s.finSeg) }));
    const clicsNuevos = clics.map(plan.mapearEvento).filter((t) => t != null);
    const focosNuevos = focos.map((f) => ({ ...f, t: plan.mapearEvento(f.t) })).filter((f) => f.t != null);
    const encuadresNuevos = encuadres.map((e) => ({ ...e, inicio: plan.mapear(e.inicio), fin: plan.mapear(e.fin) }));

    // 3. Cámara.
    const movimientos = o.camara
        ? planDeCamara({ focos: focosNuevos, encuadres: encuadresNuevos, lienzo, opciones: o.camara })
        : [];

    // 4. Capas de texto.
    const cues = cuesDeVoz(segs);
    let capaSub = null;
    let capaRot = null;
    if (o.subtitulos && cues.length) {
        capaSub = await renderizarEstados(estadosDeSubtitulos(cues), { lienzo, marca, tamano: o.subtitulos.tamano, dir: join(dir, 'sub') });
    }
    const rotulos = o.rotulos ? rotulosDeEscenas(segs, { segundos: o.rotulos.segundos, antetitulo }) : [];
    if (rotulos.length) {
        capaRot = await renderizarEstados(estadosDeRotulos(rotulos), { lienzo, marca, dir: join(dir, 'rot') });
    }

    // 5. Piezas en paralelo.
    const piezas = piezasDelAcabado(plan, fps);
    const archivos = piezas.map((_, i) => join(dir, `pieza-${String(i).padStart(4, '0')}.mp4`));
    const n = paralelo ?? Math.max(1, Math.min(6, Math.floor(cpus().length / 6)));
    await enPool(piezas.map((p, i) => async () => {
        const args = ['-y', '-ss', p.origen.toFixed(6), '-i', mudo];
        const entradas = [];
        for (const [capa, nombre] of [[capaSub, 'sub'], [capaRot, 'rot']]) {
            if (!capa) continue;
            const lista = escribirListaDeCapa(capa.estados, capa.vacio, { desde: p.inicio, hasta: p.fin }, join(dir, `${nombre}-${i}.txt`));
            if (!lista) continue;
            args.push('-f', 'concat', '-safe', '0', '-i', lista);
            entradas.push(entradas.length + 1);
        }
        const filtros = [];
        let video = `[0:v]tpad=stop_mode=clone:stop_duration=2,setpts=PTS-STARTPTS,fps=${fps}`;
        if (hayCamaraEntre(movimientos, p.inicio, p.fin, lienzo)) {
            video += ',' + filtroPerspectiva(expresionesPerspectiva(movimientos, { offset: p.inicio, duracion: p.fin - p.inicio, fps, lienzo }));
        }
        filtros.push(`${video}[b0]`);
        entradas.forEach((idx, k) => {
            filtros.push(`[${idx}:v]setpts=PTS-STARTPTS,fps=${fps},format=rgba[c${k}]`);
            filtros.push(`[b${k}][c${k}]overlay=0:0:eof_action=pass[b${k + 1}]`);
        });
        filtros.push(`[b${entradas.length}]format=yuv420p[v]`);
        args.push('-filter_complex', filtros.join(';'), '-map', '[v]', '-frames:v', String(p.cuadros),
            '-r', String(fps), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf ?? 18),
            '-pix_fmt', 'yuv420p', '-threads', '8', '-an', archivos[i]);
        await ffAsync(args);
    }), n);

    const lista = join(dir, 'piezas.txt');
    writeFileSync(lista, archivos.map((a) => `file '${a}'`).join('\n'));
    const video = join(dir, 'acabado.mp4');
    ff(['-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', video]);

    const cuadros = piezas.reduce((s, p) => s + p.cuadros, 0);
    return { video, total: cuadros / fps, mapear: plan.mapear, segmentos: segs, clics: clicsNuevos, cues, movimientos, cortes: plan.cortes };
}
