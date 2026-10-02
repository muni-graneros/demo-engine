import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ff, duracion } from './ffmpeg.mjs';
import { construirLineaDeTiempo } from './linea-tiempo.mjs';
import { generarVtt, generarSrt } from './subtitulos.mjs';
import { componer } from './presentacion.mjs';
import { renderizarMarco } from './marco.mjs';
import { renderizarLienzo } from './lienzo.mjs';
import { cadenaDeMezcla } from './mezcla.mjs';
import { superficieDe } from './configurar.mjs';
import { componerEnLienzo, componerPlano, lienzoDe } from './composicion.mjs';
import { acabar } from './acabado/index.mjs';
import { puntoEnLienzo } from './acabado/camara.mjs';
import { musicaParaMezcla } from './acabado/musica.mjs';

/** Disposición de la pantalla dividida si quien llama a montar() no la declara (ver configurar.mjs). */
const DIVIDIDA_POR_DEFECTO = { modo: 'foco', foco: 0.72 };
const ICONO_POR_PANEL = { telefono: 'phone', ventana: 'monitor' };

/**
 * Traduce los clics (ms del reloj GLOBAL de la grabación) al reloj del video final, en
 * segundos. El montaje no muestra todo el reloj global —solo los tramos de los pasos, y
 * entre uno y otro puede haber tiempo que no se ve—, así que cada clic se ubica en el
 * segmento cuyo `[tGlobal, tGlobal + duración)` lo contiene. Un clic fuera de todo segmento
 * ocurrió en un tramo que no está en el video: sonar ahí sería un clic sin nada que lo
 * provoque en pantalla, así que se descarta.
 *
 * @param {Array<{tGlobal:number, inicioSeg:number, finSeg:number}>} segmentos
 * @param {number[]} clics ms globales
 * @returns {number[]} segundos en el reloj del video final
 */
export function clicsEnVideo(segmentos, clics) {
    const fuera = [];
    for (const c of clics) {
        const seg = segmentos.find((s) => c >= s.tGlobal && c < s.tGlobal + (s.finSeg - s.inicioSeg) * 1000);
        if (seg) fuera.push(seg.inicioSeg + (c - seg.tGlobal) / 1000);
    }
    return fuera;
}

/**
 * Encuadres para la cámara del acabado: tramos CONTINUOS del video (pasos seguidos con la misma
 * composición: mismos actores, misma disposición, no plano). La cámara puede seguir acercada de
 * un paso al siguiente dentro de un encuadre, pero nunca a través de un corte de composición.
 */
export function encuadresDe(composiciones, segmentos) {
    const encuadres = [];
    const indicePorSegmento = [];
    let clave = null;
    segmentos.forEach((s, i) => {
        const c = composiciones[i] ?? { clave: `sin-${i}`, camara: false };
        if (c.clave !== clave || !encuadres.length) {
            encuadres.push({ inicio: s.inicioSeg, fin: s.finSeg, camara: c.camara });
            clave = c.clave;
        } else {
            encuadres.at(-1).fin = s.finSeg;
        }
        indicePorSegmento.push(encuadres.length - 1);
    });
    return { encuadres, indicePorSegmento };
}

/**
 * Los clics (`focos` del grabador: ms globales, actor, punto de la página) llevados al reloj del
 * video y a px del lienzo. Se descarta lo que no se puede ubicar o no se debe acercar: un clic
 * fuera de todo tramo, de un actor que no está en el lienzo de ese tramo, o con la página ya
 * acercada por el guion (`escala > 1`: dos zoom encima se ven como un salto).
 */
export function focosEnLienzo({ focos, segmentos, composiciones, indicePorSegmento }) {
    const fuera = [];
    for (const f of focos) {
        const i = segmentos.findIndex((s) => f.t >= s.tGlobal && f.t < s.tGlobal + (s.finSeg - s.inicioSeg) * 1000);
        if (i < 0) continue;
        const panel = composiciones[i]?.paneles?.[f.actor];
        if (!composiciones[i]?.camara || !panel || (f.escala ?? 1) > 1.01) continue;
        const p = puntoEnLienzo(f, panel);
        fuera.push({ t: segmentos[i].inicioSeg + (f.t - segmentos[i].tGlobal) / 1000, x: p.x, y: p.y, encuadre: indicePorSegmento[i], telefono: panel.telefono });
    }
    return fuera;
}

/**
 * El marco de un panel: lo decide el tipo de la superficie del actor. El `dispositivo` solo
 * decide cuando no hay superficie —una superficie `escritorio` puede grabarse con un
 * dispositivo de Playwright de escritorio ('Desktop Chrome') y no por eso es un teléfono—.
 */
export function tipoDePanel(superficie, actor) {
    if (superficie) return superficie.tipo === 'telefono' ? 'telefono' : 'ventana';
    return actor?.dispositivo ? 'telefono' : 'ventana';
}

/**
 * El panel (marco, aspecto, chip y URL) con el que sale `actor` en el lienzo.
 *
 * En pantalla dividida el chip suma el `rotulo` del actor a la superficie («Sala de
 * operaciones · Camila · operadora»): con dos salas lado a lado los dos chips decían lo mismo
 * y, con la mitad de contexto achicada, un rótulo pintado DENTRO de la página (el
 * `rotularPuesto` de un guion) queda a ~5 px. El chip se dibuja sobre el lienzo, a tamaño
 * fijo, así que se lee igual en la mitad chica. Sin `rotulo`, el chip de siempre; sin
 * superficie pero con `rotulo`, un chip sólo con el rótulo, del color de la marca.
 */
export function panelDeActor({ actor, config, dimensiones = {}, video, presentacion = null, baseURL = null, marca = null, dividido = false }) {
    const { actores = {} } = config;
    const superficie = superficieDe(config, actor);
    const dim = dimensiones[actor] ?? video;
    const tipo = tipoDePanel(superficie, actores[actor]);
    const rotulo = dividido ? actores[actor]?.rotulo : null;
    let chip = superficie ? { nombre: superficie.nombre, icono: superficie.icono, color: superficie.color } : null;
    if (rotulo) {
        chip = chip
            ? { ...chip, nombre: `${chip.nombre} · ${rotulo}` }
            : { nombre: rotulo, icono: ICONO_POR_PANEL[tipo], color: marca?.color ?? '#1e3a8a' };
    }
    return {
        tipo,
        aspecto: dim.ancho / dim.alto,
        chip,
        url: presentacion?.url ?? actores[actor]?.baseURL ?? baseURL,
    };
}

/**
 * Corta cada pista en los tramos que le corresponden, los ordena por tiempo global,
 * los pega, y le suma la voz y los subtítulos.
 */
export async function montar({
    pistas, pasos, voz, video, presentacion = null, marca = null, baseURL = null,
    superficies = null, actores = {}, origenes = {}, clics = [], dimensiones = {}, audio = null,
    focos = [], titulo = '',
}, { salida, nombre = 'demo.mp4' }) {
    mkdirSync(salida, { recursive: true });
    const linea = construirLineaDeTiempo(pasos);
    const temporal = join(salida, '.tmp');
    mkdirSync(temporal, { recursive: true });
    const composiciones = [];

    // Modo lienzo: cada tramo se compone en el marco de la superficie de su actor. Solo se
    // entra si el proyecto declara superficies o algún paso divide la pantalla; si no, se
    // sigue por el camino de siempre SIN tocar nada —hay más de diez proyectos usando el
    // motor y ninguno debe cambiar de aspecto sin declararlo—.
    const modoLienzo = superficies != null || linea.some((s) => s.dividir);
    const lienzo = lienzoDe({ presentacion, video });
    const config = { superficies, actores };
    const dividida = video?.dividida ?? DIVIDIDA_POR_DEFECTO;
    // Portadas y cierres a pantalla completa, salvo que el proyecto pida el aspecto de 1.14.
    // Sólo cuenta cuando hay algo que sacar: sin lienzo ni presentación no hay marco.
    const rotulosPlanos = (video?.rotulos ?? 'plano') === 'plano' && (modoLienzo || presentacion != null);
    // Sin lienzo, la presentación enmarcaba el video YA pegado, de una vez. Con algún rótulo
    // plano eso no sirve (lo enmarcaría también), así que se enmarca tramo por tramo.
    const enmarcarPorTramo = presentacion != null && !modoLienzo && rotulosPlanos && linea.some((s) => s.plano);
    const marcoPorTramo = enmarcarPorTramo ? await renderizarMarco({ salida: temporal, presentacion, marca, baseURL }) : null;
    const panelDe = (actor, dividido) => panelDeActor({ actor, config, dimensiones, video, presentacion, baseURL, marca, dividido });
    // Un PNG por combinación distinta de paneles: renderizar el lienzo cuesta un Chromium, y
    // un curso repite las mismas dos o tres combinaciones en decenas de tramos.
    const lienzos = new Map();
    const lienzoPara = async (paneles, disposicion = null) => {
        const clave = JSON.stringify([paneles, disposicion]);
        if (!lienzos.has(clave)) {
            lienzos.set(clave, await renderizarLienzo({ lienzo, paneles, marca, dividida: disposicion, salida: temporal, nombre: `lienzo-${lienzos.size}.png` }));
        }
        return lienzos.get(clave);
    };

    // 1. Cortar. Cada segmento sale como un mp4 normalizado, para que el concat no discuta.
    //
    // Un tramo puede pasarse del final de su pista: la grabación de un actor se cierra justo
    // después de su último paso, así que por redondeo el último tramo suele desbordar unos
    // milisegundos. Reventar por eso sería absurdo, pero ignorarlo es peor: ffmpeg recorta
    // el trozo en silencio y el video queda MÁS CORTO de lo que dice el guion, con lo que
    // los subtítulos y la voz apuntan a tiempos que ya no existen. Por eso se recorta de
    // forma explícita y se usa el largo REAL para todo lo que viene después.
    const TOLERANCIA_SEG = 0.25;
    const trozos = [];
    const recortados = [];
    const largos = new Map();
    const largoDe = (actor) => {
        const pista = pistas[actor];
        if (!pista) throw new Error(`no hay pista grabada para el actor "${actor}"`);
        if (!largos.has(actor)) largos.set(actor, duracion(pista));
        return largos.get(actor);
    };

    /**
     * El tramo del OTRO actor de una pantalla dividida: el mismo intervalo del reloj global,
     * llevado al reloj de su pista con su origen (cada pista arranca cuando su actor abrió el
     * navegador, no en el cero global). Se recorta con la misma tolerancia que el tramo
     * principal y por la misma razón: la pista del otro puede cerrarse unos milisegundos
     * antes; composicion.mjs congela su último cuadro para no acortar el tramo.
     */
    function tramoDelOtro(actor, seg, dura) {
        const largo = largoDe(actor);
        // Sin origen no hay forma de ubicar el tramo en su pista: suponer 0 cortaría otro
        // momento de la grabación y el panel mostraría algo que no pasó en ese instante.
        if (typeof origenes[actor] !== 'number') {
            throw new Error(`falta origenes["${actor}"]: sin el origen de su pista el panel dividido saldría desfasado`);
        }
        const desde = (seg.tGlobal - origenes[actor]) / 1000;
        if (desde < 0) {
            throw new Error(`el actor ${actor} empezó a grabar después del tramo dividido "${seg.escena}" (le faltan ${(-desde).toFixed(2)}s de pista)`);
        }
        if (desde >= largo) {
            throw new Error(`el tramo dividido "${seg.escena}" empieza en ${desde.toFixed(2)}s de la pista de ${actor}, fuera de ella (${largo}s)`);
        }
        const desborde = desde + dura - largo;
        if (desborde > TOLERANCIA_SEG) {
            throw new Error(`el tramo dividido "${seg.escena}" termina en ${(desde + dura).toFixed(2)}s y la pista de ${actor} dura ${largo}s: se perderían ${desborde.toFixed(2)}s de su panel`);
        }
        return { mp4: pistas[actor], desdeSeg: desde, hastaSeg: Math.min(desde + dura, largo) };
    }

    for (const [i, seg] of linea.entries()) {
        const pista = pistas[seg.actor];
        const largo = largoDe(seg.actor);

        if (seg.desdeSeg >= largo) {
            throw new Error(`el tramo "${seg.escena}" empieza en ${seg.desdeSeg}s, fuera de la pista de ${seg.actor} (${largo}s)`);
        }
        const desborde = seg.hastaSeg - largo;
        if (desborde > TOLERANCIA_SEG) {
            throw new Error(`el tramo "${seg.escena}" termina en ${seg.hastaSeg}s y la pista de ${seg.actor} dura ${largo}s: se perderían ${desborde.toFixed(2)}s y los subtítulos quedarían desfasados`);
        }
        const hasta = Math.min(seg.hastaSeg, largo);
        recortados.push({ ...seg, hastaSeg: hasta });

        const trozo = join(temporal, `trozo-${String(i).padStart(3, '0')}.mp4`);
        // Para la cámara del acabado: dónde quedó cada actor en el lienzo de este tramo.
        const composicion = { clave: `plano-${i}`, camara: false, paneles: {} };
        composiciones.push(composicion);
        if (rotulosPlanos && seg.plano) {
            // Portada o cierre: una tarjeta del video, a pantalla completa. Si el paso seguía
            // dentro de un `dividir`, la tarjeta gana: es del actor del paso, sola.
            componerPlano({ mp4: pista, desdeSeg: seg.desdeSeg, hastaSeg: hasta }, { lienzo, salida: trozo, duracion: hasta - seg.desdeSeg });
        } else if (modoLienzo) {
            const actoresDelTramo = seg.dividir ?? [seg.actor];
            const entradas = actoresDelTramo.map((actor) => {
                if (actor === seg.actor) return { mp4: pista, desdeSeg: seg.desdeSeg, hastaSeg: hasta };
                return tramoDelOtro(actor, seg, hasta - seg.desdeSeg);
            });
            const dividido = actoresDelTramo.length === 2;
            // La mitad grande es la del actor que actúa en ESTE paso (ver geometriaConFoco).
            const disposicion = dividido ? { ...dividida, activo: actoresDelTramo.indexOf(seg.actor) } : null;
            const paneles = actoresDelTramo.map((a) => panelDe(a, dividido));
            const { png, huecos } = await lienzoPara(paneles, disposicion);
            componerEnLienzo(entradas, { png, huecos, lienzo, salida: trozo, duracion: hasta - seg.desdeSeg });
            composicion.clave = JSON.stringify([actoresDelTramo, disposicion]);
            composicion.camara = true;
            actoresDelTramo.forEach((a, k) => {
                composicion.paneles[a] = { hueco: huecos[k], dim: dimensiones[a] ?? video, telefono: paneles[k].tipo === 'telefono' };
            });
        } else if (enmarcarPorTramo) {
            // Mismo corte de siempre, a 25 fps fijos (el concat copia sin reencodear y exige
            // la misma cadencia que los tramos planos), y el marco sobre este tramo solo.
            const crudo = join(temporal, `crudo-${String(i).padStart(3, '0')}.mp4`);
            ff(['-y', '-i', pista, '-ss', String(seg.desdeSeg), '-to', String(hasta),
                '-vf', `scale=${video.ancho}:${video.alto},setsar=1,fps=25`,
                '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', crudo]);
            componer(crudo, marcoPorTramo, trozo, presentacion);
        } else {
            ff(['-y', '-i', pista, '-ss', String(seg.desdeSeg), '-to', String(hasta),
                '-vf', `scale=${video.ancho}:${video.alto},setsar=1`,
                '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', trozo]);
            if (!presentacion) {
                composicion.clave = `plano-actor-${seg.actor}`;
                composicion.camara = true;
                const dim = dimensiones[seg.actor] ?? video;
                // El corte estira la pista a video.ancho×video.alto: el hueco es el cuadro entero
                // y la dimensión efectiva, la del video (así puntoEnLienzo escala igual que ffmpeg).
                composicion.paneles[seg.actor] = {
                    hueco: { x: 0, y: 0, ancho: video.ancho, alto: video.alto }, dim: { ancho: dim.ancho, alto: dim.alto },
                    telefono: Boolean(actores[seg.actor]?.dispositivo), estirar: true,
                };
            }
        }
        trozos.push(trozo);
    }

    // 2. Pegar en orden narrativo.
    const mudo = join(temporal, 'mudo.mp4');
    const lista = join(temporal, 'lista.txt');
    writeFileSync(lista, trozos.map((t) => `file '${t}'`).join('\n'));
    ff(['-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', mudo]);

    // 2b. Presentación: el marco va ANTES de la voz y los subtítulos, a propósito. Componer
    //     reencodea el video, así que hacerlo acá deja intacto el `-c:v copy` del mux final
    //     y —lo que de verdad importa— no toca la duración, que es de donde salen los
    //     tiempos de las locuciones y de los cues.
    //     En modo lienzo no: el lienzo ya puso el fondo y el marco de cada superficie, y
    //     tiene el mismo tamaño que `presentacion.salida`, así que el curso lo trata igual.
    let baseVideo = mudo;
    if (presentacion && !modoLienzo && !enmarcarPorTramo) {
        const marcoPng = await renderizarMarco({ salida: temporal, presentacion, marca, baseURL });
        baseVideo = componer(mudo, marcoPng, join(temporal, 'presentado.mp4'), presentacion);
    }

    // 3. Recalcular los tiempos: ahora cada segmento vive en el reloj del video final.
    let reloj = 0;
    let segmentos = recortados.map((seg) => {
        const dura = seg.hastaSeg - seg.desdeSeg;
        const s = {
            inicioSeg: reloj, finSeg: reloj + dura, narrar: seg.narrar, escena: seg.escena, wav: seg.wav, tGlobal: seg.tGlobal,
            titulo: seg.titulo, plano: seg.plano, sinRecorte: seg.sinRecorte,
        };
        reloj += dura;
        return s;
    });

    // 3b. Voz: una locución por segmento. Se resuelve ANTES de los subtítulos porque el acabado
    //     necesita saber cuánto dura cada una (recorte de silencios, cues sincronizados).
    const mp4 = resolve(salida, nombre);
    const locuciones = [];
    if (voz.disponible()) {
        for (const seg of segmentos) {
            if (!seg.narrar) continue;
            // El grabador ya sintetizó esta locución y dejó su ruta en el segmento: se
            // reutiliza. Sintetizar de nuevo duplicaría el paso más caro del pipeline.
            //
            // `undefined` (nunca se intentó, típico de llamar a montar() sin pasar por
            // grabar()) y `null` (grabar() SÍ lo intentó y la perdió, y ya avisó por
            // stderr — ver src/voz/proceso.mjs) no son lo mismo: solo el primer caso
            // amerita intentarlo acá. Reintentar un `null` solo produce un SEGUNDO aviso
            // por la MISMA pérdida, sin decir que es la misma.
            const wav = seg.wav !== undefined ? seg.wav : voz.sintetizar(seg.narrar);
            if (!wav) continue;
            locuciones.push({ wav, inicioSeg: seg.inicioSeg, segmento: seg });
        }
    }

    // 3c. Acabado moderno (opt-in, `video.acabado`): recorte de silencios, cámara automática,
    //     subtítulos y rótulos quemados, 60 fps. Devuelve el video nuevo y su reloj.
    let clicsFinales = clicsEnVideo(segmentos, clics);
    let cuesQuemados = null;
    if (video?.acabado) {
        for (const l of locuciones) l.segmento.vozSeg = duracion(l.wav);
        const { encuadres, indicePorSegmento } = encuadresDe(composiciones, segmentos);
        const focosLienzo = focosEnLienzo({ focos, segmentos, composiciones, indicePorSegmento });
        const r = await acabar({
            mudo: baseVideo, lienzo,
            total: duracion(baseVideo), opciones: video.acabado, segmentos, clics: clicsFinales, focos: focosLienzo,
            encuadres, marca, antetitulo: titulo, temporal,
        });
        for (const l of locuciones) l.inicioSeg = r.mapear(l.inicioSeg);
        segmentos = r.segmentos;
        clicsFinales = r.clics;
        cuesQuemados = r.cues;
        baseVideo = r.video;
    }

    // 4. Subtítulos: archivo al lado (para la web) y pista blanda dentro del MP4. Con acabado,
    //    los mismos cues que se quemaron (tramo de la voz), para que el .vtt diga lo mismo.
    const vtt = join(salida, `${nombre.replace(/\.mp4$/, '')}.vtt`);
    const srt = join(temporal, 'subtitulos.srt');
    const fuenteSubtitulos = cuesQuemados ?? segmentos;
    writeFileSync(vtt, generarVtt(fuenteSubtitulos));
    writeFileSync(srt, generarSrt(fuenteSubtitulos));
    const haySubtitulos = fuenteSubtitulos.some((s) => s.narrar?.trim());

    // 5. Mezcla: cada locución retrasada hasta su marca, sobre una base de silencio del largo
    //    exacto del video (fija la duración y cubre los huecos).
    const total = duracion(baseVideo);
    if (audio?.musica?.generada) audio = { ...audio, musica: musicaParaMezcla(audio.musica, { segundos: total, dir: temporal }) };

    // Con música o clic pedidos, la mezcla nueva (estéreo 48 kHz); si no, la cadena mono de
    // siempre, tal cual: un proyecto que no pidió audio nuevo no cambia ni un byte de su
    // pista de sonido. La decisión vive ACÁ y no en quien llama: cargarConfig siempre trae
    // el bloque `audio` con sus defectos (música null, clic inactivo), y pasar
    // `audio: config.audio` —como muestra la guía— no puede cambiar el sonido.
    const audioActivo = (audio?.musica || audio?.clic?.activo) ? audio : null;
    let entradas, cadena, idx;
    if (audioActivo) {
        const mezcla = cadenaDeMezcla({
            total, locuciones, musica: audioActivo.musica ?? null,
            clics: clicsFinales, clic: audioActivo.clic ?? { activo: false },
        });
        entradas = ['-y', '-i', baseVideo, ...mezcla.entradas];
        cadena = mezcla.filtro;
        // El índice de los subtítulos se CUENTA en las entradas de la mezcla, no se supone:
        // la música y los clics agregan entradas según lo que el proyecto declare.
        idx = 1 + mezcla.entradas.filter((a) => a === '-i').length;
    } else {
        entradas = ['-y', '-i', baseVideo, '-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=22050:cl=mono'];
        const filtros = [];
        const mezclas = ['[1:a]'];
        idx = 2;
        for (const { wav, inicioSeg } of locuciones) {
            entradas.push('-i', wav);
            const ms = Math.round(inicioSeg * 1000);
            filtros.push(`[${idx}:a]adelay=${ms}|${ms}[v${idx}]`);
            mezclas.push(`[v${idx}]`);
            idx++;
        }
        const n = mezclas.length;
        // Si solo hay silencio puro (sin voz), pasar directo sin amix ni loudnorm.
        cadena = (filtros.length ? filtros.join(';') + ';' : '') +
            (n === 1
                ? mezclas[0] + 'aformat=sample_rates=44100:channel_layouts=mono[a]'
                : mezclas.join('') + `amix=inputs=${n}:normalize=0[m];[m]loudnorm=I=-16:TP=-1.5:LRA=11[a]`);
    }

    const cmd = [
        ...entradas,
        ...(haySubtitulos ? ['-i', srt] : []),
        '-filter_complex', cadena,
        '-map', '0:v', '-map', '[a]',
        ...(haySubtitulos ? ['-map', `${idx}:s`] : []),
        '-c:v', 'copy', '-c:a', 'aac',
        ...(haySubtitulos ? ['-c:s', 'mov_text', '-metadata:s:s:0', 'language=spa'] : []),
        '-movflags', '+faststart', mp4,
    ];
    ff(cmd);

    // Igual que en pegarCapitulos: limpia los intermedios (trozos, .srt, lista de concat)
    // para que la carpeta de salida solo tenga lo que el usuario quiere ver.
    rmSync(temporal, { recursive: true, force: true });

    return { mp4, vtt, segmentos };
}
