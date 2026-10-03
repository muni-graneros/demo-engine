import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { configurarCamara } from '../camara.mjs';
import { actorConSesion, opcionesDeContexto, opcionesDeLanzamiento } from '../contexto-actor.mjs';
import { ejecutarGuion, Interrupcion, pasosEnOrden } from '../ejecutor.mjs';
import { cubrir, descubrir } from '../privacidad.mjs';
import { prepararSesionesParaGuion } from '../sesiones.mjs';
import { sembrarEnSegundoPlano } from '../sembrar.mjs';
import { crearControl } from './control.mjs';
import { exigirEntornoEnVivo } from './guardian.mjs';
import { disposicionVentanas, ubicarVentanas } from './ventanas.mjs';

export { exigirEntornoEnVivo } from './guardian.mjs';
export { disposicionVentanas } from './ventanas.mjs';
export { crearControl, ordenDeTecla, TECLAS } from './control.mjs';

const ESPERA_DE_PASO = ['siguiente', 'saltar', 'reiniciar', 'ir', 'seguro', 'salir'];
const ESPERA_DE_FALLO = ['reintentar', 'saltar', 'reiniciar', 'ir', 'seguro', 'salir'];
const ESPERA_ENTRE_CAPITULOS = ['siguiente', 'reiniciar', 'ir', 'seguro', 'salir'];

/**
 * Los capítulos de la demo a partir de un módulo de guion ya importado: un maestro
 * (`capitulos`, el mismo de `demo curso`) o un guion suelto (`escenas`), que es un capítulo.
 *
 * @param {object} modulo el namespace del módulo (default + exports con nombre)
 * @param {string} idArchivo el nombre del archivo sin `.mjs`
 */
export function capitulosDe(modulo, idArchivo) {
    const guion = modulo.default;
    if (Array.isArray(guion?.capitulos)) {
        return guion.capitulos.map((c) => ({ ...c, titulo: c.titulo ?? c.id }));
    }
    if (Array.isArray(guion?.escenas)) {
        return [{ id: guion.id ?? idArchivo, guion: idArchivo, titulo: guion.titulo ?? idArchivo, escena: modulo.escena }];
    }
    throw new Error(`"${idArchivo}" no declara "capitulos" ni "escenas": no hay nada que presentar`);
}

/**
 * Dónde buscar el MP4 grabado de un capítulo (modo seguro). Por defecto donde lo dejan
 * `tools/demo/montar-curso.mjs` de seguridad-graneros (`final/<guion>/<guion>.mp4`) y
 * `demo grabar` (`<guion>.mp4`), ambos dentro de `salida`.
 *
 * @returns {{ encontrado: string|null, buscados: string[] }}
 */
export function buscarClip(config, guion) {
    const clips = config.vivo?.clips;
    let rutas;
    if (typeof clips === 'function') rutas = [clips(guion)].flat();
    else rutas = (clips ?? ['final/{guion}/{guion}.mp4', '{guion}.mp4']).map((p) => p.replaceAll('{guion}', guion));
    const buscados = rutas.filter(Boolean).map((r) => (isAbsolute(r) ? r : join(config.salida, r)));
    return { encontrado: buscados.find((r) => existsSync(r)) ?? null, buscados };
}

/**
 * Abre un clip con el reproductor del sistema. El Chromium de Playwright no trae los códecs
 * propietarios (H.264/AAC) de los MP4 que monta el motor, así que no sirve para esto: se usa
 * `mpv --fs` (las mismas teclas de capítulo que un clicker) o, sin mpv, `xdg-open`.
 *
 * @returns {{ detener: () => void }}
 */
export function reproductorDelSistema(config) {
    return (archivo) => {
        let comando = config.vivo?.reproductor;
        if (!comando) comando = spawnSync('sh', ['-c', 'command -v mpv'], { encoding: 'utf8' }).status === 0 ? 'mpv --fs' : 'xdg-open';
        const [programa, ...args] = comando.split(/\s+/).filter(Boolean);
        const hijo = spawn(programa, [...args, archivo], { stdio: 'ignore', detached: false });
        hijo.on('error', (e) => console.warn(`[demo vivo] no pude abrir el clip con "${comando}": ${e.message}`));
        return { detener: () => { if (hijo.exitCode === null) hijo.kill(); } };
    };
}

/** Pantalla negra sobre una página: un telón propio, distinto del cubridor de privacidad. */
async function telon(page, activo) {
    await page.evaluate((on) => {
        let el = document.getElementById('__telon_vivo');
        if (!on) { el?.remove(); return; }
        if (el || !document.documentElement) return;
        el = document.createElement('div');
        el.id = '__telon_vivo';
        el.style.cssText = 'position:fixed;inset:0;background:#000;z-index:2147483647';
        document.documentElement.appendChild(el);
    }, activo).catch(() => {});
}

/**
 * La demo en vivo: los mismos guiones que se graban, ejecutados paso a paso cuando lo manda
 * el presentador, en ventanas reales de Chromium (una por actor), sin grabar, sin voz y sin
 * ffmpeg.
 *
 * Por capítulo: siembra con su escena (`sembrar({ escena })`), prepara las sesiones que
 * falten (una vez por actor en toda la corrida: nunca reloguea por su cuenta, el sistema
 * tiene un tope de ingresos diarios), recorre el guion con `ejecutarGuion` esperando una
 * orden antes de cada paso, y al salir del capítulo —termine, falle o se salte— llama al
 * `limpiar()` que exporte el guion.
 *
 * @param {object} p
 * @param {object} p.config             config ya cargada (`cargarConfig`)
 * @param {Array<object>} p.capitulos   de `capitulosDe`
 * @param {string} [p.dirSesiones]      donde viven los storageState (`.sesiones/`)
 * @param {string|number} [p.desde]     id o índice del capítulo con que se empieza
 * @param {boolean} [p.headless]        sin ventanas (CI, ensayo): no se ubican ventanas
 * @param {boolean} [p.auto]            avanza solo tras `config.video.pausaMinima` (o `msAuto`)
 * @param {number} [p.msAuto]
 * @param {number} [p.puerto]           de la consola; 0 = uno libre
 * @param {boolean} [p.teclado]         teclas en la terminal si es una TTY
 * @param {string[]} [p.permitirHosts]
 * @param {(archivo: string) => {detener: () => void}} [p.reproductor]
 * @param {boolean} [p.ordenarVentanas] por defecto solo con ventanas (no headless)
 * @param {(consola: {url: string, control: object, actores: Map}) => void} [p.alListo]
 */
export async function vivo({
    config, capitulos, dirSesiones = join(config.raiz ?? process.cwd(), '.sesiones'), desde = null,
    headless = false, auto = false, msAuto = null, puerto = config.vivo?.puerto ?? 0, teclado = true,
    permitirHosts = [], reproductor = null, alListo = null, env = process.env, ordenarVentanas = !headless,
}) {
    exigirEntornoEnVivo(config, { permitirHosts, env });
    if (!capitulos?.length) throw new Error('no hay capítulos que presentar');

    const velocidad = config.vivo?.velocidad ?? 1;
    configurarCamara({ msCursor: (config.video?.msCursor ?? 260) / velocidad });
    const reproducir = reproductor ?? (headless ? null : reproductorDelSistema(config));
    const pantalla = config.vivo?.pantalla ?? { x: 0, y: 0, ancho: 1920, alto: 1080 };
    const msAutomatico = auto ? (msAuto ?? Math.max(config.video?.pausaMinima ?? 350, 350)) : 0;

    let navegador = null;
    const actores = new Map();
    const sesiones = {};                 // actor → storageState (ruta) | null, verificado UNA vez
    const cargadas = new Map();          // actor → mtime del storageState que tiene su contexto
    let clipEnCurso = null;

    const control = crearControl({
        capitulos: capitulos.map((c) => ({ id: c.id, titulo: c.titulo, escena: c.escena ?? null })),
        auto,
        alInmediata: async (o, estado) => {
            if (o.tipo === 'negro') for (const { page } of actores.values()) await telon(page, estado.negro);
        },
    });
    const consola = await control.servir({ puerto });
    console.log(`\n[demo vivo] consola del presentador: ${consola.url}\n`);
    const terminal = teclado ? control.conectarTerminal() : { cerrar: () => {} };

    try {
        navegador = await chromium.launch({
            headless,
            // Mismo lanzamiento que al grabar (`--lang`, canal y `navegador.args`, p. ej.
            // `--host-resolver-rules` a loopback): lo que se ve en vivo tiene que ser lo
            // mismo que en el video.
            ...opcionesDeLanzamiento(config),
        });
        await alListo?.({ url: consola.url, control, actores });

        let i = indiceDe(capitulos, desde);
        for (;;) {
            if (i >= capitulos.length) {
                control.actualizar({ fase: 'fin', paso: null, siguiente: null, error: null, aviso: null });
                if (auto) break;
                const o = await control.esperar(['salir', 'ir']);
                if (o.tipo === 'salir') break;
                i = o.valor;
                continue;
            }
            const cap = capitulos[i];
            control.actualizar({
                capitulo: i, fase: 'preparando', paso: null, siguiente: null, error: null, clip: null,
                aviso: null, narrarCapitulo: cap.narrar ?? null, inicioCapitulo: Date.now(),
            });
            try {
                await correrCapitulo(cap);
                i++;
            } catch (error) {
                const decision = error instanceof Interrupcion ? error : await decidirTrasFalloDeCapitulo(cap, error);
                if (decision.tipo === 'salir') break;
                if (decision.tipo === 'reiniciar') continue;
                if (decision.tipo === 'ir') { i = decision.indice ?? decision.valor; continue; }
                if (decision.tipo === 'saltar') { i++; continue; }
                if (decision.tipo === 'seguro') {
                    const d = await modoSeguro(cap);
                    if (d.tipo === 'salir') break;
                    if (d.tipo === 'reiniciar') continue;
                    if (d.tipo === 'ir') { i = d.valor; continue; }
                    i++;
                }
            }
        }
        return { estado: control.estado };
    } finally {
        clipEnCurso?.detener();
        terminal.cerrar();
        await navegador?.close().catch(() => {});
        await consola.cerrar();
    }

    /** Un error de capítulo que no es de un paso (la siembra, cargar el guion). */
    async function decidirTrasFalloDeCapitulo(cap, error) {
        console.error(`[demo vivo] capítulo ${cap.id}: ${error.message}`);
        control.actualizar({ fase: 'fallo', error: `Capítulo ${cap.id}: ${error.message}`, paso: null, siguiente: null });
        const o = await control.esperar(['reintentar', 'saltar', 'reiniciar', 'ir', 'seguro', 'salir']);
        return o.tipo === 'reintentar' ? { tipo: 'reiniciar' } : o;
    }

    async function modoSeguro(cap) {
        let encontrado;
        let buscados;
        if (cap.fuente === 'video') {
            const ruta = isAbsolute(cap.archivo) ? cap.archivo : join(config.raiz ?? process.cwd(), cap.archivo);
            [encontrado, buscados] = [existsSync(ruta) ? ruta : null, [ruta]];
        } else {
            ({ encontrado, buscados } = buscarClip(config, cap.guion));
        }
        clipEnCurso?.detener();
        clipEnCurso = encontrado && reproducir ? reproducir(encontrado) : null;
        control.actualizar({
            fase: 'clip', paso: null, siguiente: null, error: null, clip: encontrado,
            aviso: encontrado ? null : `No hay clip grabado del capítulo ${cap.id}. Busqué: ${buscados.join(', ')}`,
        });
        if (!encontrado) console.warn(`[demo vivo] capítulo ${cap.id}: sin clip grabado (${buscados.join(', ')})`);
        const o = await control.esperar(ESPERA_ENTRE_CAPITULOS, { msAuto: msAutomatico });
        clipEnCurso?.detener();
        clipEnCurso = null;
        return o;
    }

    async function correrCapitulo(cap) {
        // Capítulos sin guion: el mapa de superficies (lo narra el presentador) y un clip
        // nativo (`fuente: 'video'`), que en vivo es directamente el modo seguro.
        if (cap.fuente === 'video') throw new Interrupcion('seguro');
        if (!cap.guion) {
            control.actualizar({ fase: 'esperando', aviso: cap.tipo === 'mapa' ? 'Capítulo mapa: nárralo y pasa al siguiente.' : null });
            const o = await control.esperar(ESPERA_ENTRE_CAPITULOS, { msAuto: msAutomatico });
            if (o.tipo !== 'siguiente') throw new Interrupcion(o.tipo, { indice: o.valor });
            return;
        }

        const modulo = await import(pathToFileURL(join(config.guiones, `${cap.guion}.mjs`)).href);
        const guion = modulo.default;
        if (!Array.isArray(guion?.escenas)) throw new Error(`el guion "${cap.guion}" no tiene escenas`);
        if (cap.escena && modulo.escena && cap.escena !== modulo.escena) {
            console.warn(`[demo vivo] capítulo ${cap.id}: el maestro dice escena "${cap.escena}" y el guion "${modulo.escena}"; se usa la del maestro`);
        }
        const escena = cap.escena ?? modulo.escena;
        const pasos = pasosEnOrden(guion);

        try {
            control.actualizar({ fase: 'sembrando', aviso: `Sembrando${escena ? ` la escena «${escena}»` : ''}…` });
            await sembrarEnSegundoPlano(config, { escena, guion: cap.guion });
            await sesionesPara(guion);

            await ejecutarGuion(guion, {
                config, sesiones, navegador, actores, tamano: { ancho: config.video.ancho, alto: config.video.alto },
                ganchos: ganchosDelCapitulo(cap, pasos),
            });
        } finally {
            // Lo que la siembra no deshace (un pánico creado por la app, una cuenta creada en
            // el panel) lo deshace el guion; si el capítulo se cortó, su último paso —que
            // limpiaba— no corrió, así que se llama siempre, termine como termine.
            if (typeof modulo.limpiar === 'function') {
                try {
                    await modulo.limpiar();
                } catch (e) {
                    console.error(`[demo vivo] limpiar() de ${cap.guion} falló: ${e.message}`);
                    control.actualizar({ aviso: `Ojo: limpiar() de ${cap.guion} falló (${e.message}).` });
                }
            }
        }

        control.actualizar({
            fase: 'esperando', paso: null, siguiente: null, error: null,
            aviso: `Capítulo ${cap.id} terminado. Siguiente para continuar.`,
        });
        const o = await control.esperar(ESPERA_ENTRE_CAPITULOS, { msAuto: msAutomatico });
        if (o.tipo !== 'siguiente') throw new Interrupcion(o.tipo, { indice: o.valor });
    }

    /**
     * Sesiones de los actores que el guion usa y que todavía no se verificaron en esta corrida.
     * `prepararSesionesParaGuion` reutiliza el storageState en disco si sigue vivo y solo
     * entonces loguea: acá se llama una sola vez por actor en toda la demo. Si la siembra del
     * sistema renueva los archivos (seguridad-graneros encadena `sesiones-web.mjs`), las
     * cookies nuevas se cargan en los contextos ya abiertos, sin volver a entrar.
     */
    async function sesionesPara(guion) {
        const faltan = [...new Set(pasosEnOrden(guion).map((p) => p.paso.actor))]
            .filter((a) => !(a in sesiones) && config.actores?.[a]);
        if (faltan.length) {
            const nuevas = await prepararSesionesParaGuion(
                { escenas: [{ pasos: faltan.map((actor) => ({ actor })) }] }, config, { dirSesiones });
            Object.assign(sesiones, nuevas);
        }
        for (const [nombre, datos] of actores) {
            const archivo = sesiones[nombre];
            if (!archivo || !actorConSesion(config, nombre) || !existsSync(archivo)) continue;
            const mtime = statSync(archivo).mtimeMs;
            if (cargadas.get(nombre) === mtime) continue;
            const { cookies = [] } = JSON.parse(readFileSync(archivo, 'utf8'));
            await datos.ctx.clearCookies();
            if (cookies.length) await datos.ctx.addCookies(cookies);
            cargadas.set(nombre, mtime);
        }
    }

    function ganchosDelCapitulo(cap, pasos) {
        let disposicionAnterior = '';
        // «Reintentar» ya es la orden de actuar: el paso repetido no vuelve a esperar.
        let reintentando = false;
        const numeroDe = ({ indiceEscena, indice }) =>
            pasos.findIndex((p) => p.indiceEscena === indiceEscena && p.indice === indice);

        return {
            // En una ventana real el escritorio se acomoda a la ventana (el proyector no mide
            // 1600×1000); un teléfono conserva su viewport emulado, que es lo que lo hace
            // teléfono (isMobile, touch, userAgent).
            opcionesDeActor: (nombre, opciones) => (!headless && !opciones.isMobile ? { ...opciones, viewport: null } : opciones),

            alAbrirActor: async (nombre, datos) => {
                if (config.vivo?.timeoutPaso) datos.page.setDefaultTimeout(config.vivo.timeoutPaso);
                datos.telefono = Boolean(config.actores?.[nombre]?.dispositivo);
                const archivo = sesiones[nombre];
                if (archivo && existsSync(archivo)) cargadas.set(nombre, statSync(archivo).mtimeMs);
                if (control.estado.negro) await telon(datos.page, true);
            },

            antesDePaso: async (info) => {
                const n = numeroDe(info);
                const siguiente = pasos[n + 1];
                const superficie = config.actores?.[info.paso.actor]?.superficie;
                // Las ventanas se ordenan ANTES de anunciar «listo»: una orden que llegue
                // mientras tanto no tendría espera que la reciba.
                await disponer(info);
                control.actualizar({
                    fase: 'esperando', error: null, aviso: null,
                    paso: {
                        numero: n + 1, total: pasos.length, actor: info.paso.actor, narrar: info.paso.narrar ?? null,
                        escena: info.escena.titulo ?? info.escena.id, dividir: info.dividir,
                        superficie: superficie ? config.superficies?.[superficie]?.nombre ?? superficie : null,
                    },
                    siguiente: siguiente ? { narrar: siguiente.paso.narrar ?? null, actor: siguiente.paso.actor } : null,
                });
                if (reintentando) {
                    reintentando = false;
                } else {
                    const o = await control.esperar(ESPERA_DE_PASO, { msAuto: msAutomatico });
                    if (o.tipo === 'saltar') return 'saltar';
                    if (o.tipo !== 'siguiente') throw new Interrupcion(o.tipo, { indice: o.valor });
                }
                // Avanzar levanta el telón: nadie quiere ejecutar un paso a ciegas.
                if (control.estado.negro) await control.orden({ tipo: 'negro' });
                control.actualizar({ fase: 'actuando' });
            },

            despuesDePaso: () => {
                control.actualizar({ pasosHechos: control.estado.pasosHechos + 1 });
            },

            /*
             * En vivo el portero NO previene: si falla al final del paso, el público ya vio la
             * pantalla. Lo único que queda es taparla en el acto (`cubrir`, que el portero ya
             * pone en su caso) y llevar el error a la consola, nunca al proyector.
             */
            alFallar: async (error, info) => {
                const paginas = [info.actor?.page, ...(info.dividir ?? []).map((a) => actores.get(a)?.page)].filter(Boolean);
                for (const page of paginas) await cubrir(page).catch(() => {});
                console.error(`[demo vivo] ${error.message}`);
                control.actualizar({ fase: 'fallo', error: error.message });
                const o = await control.esperar(ESPERA_DE_FALLO);
                if (o.tipo === 'reintentar' || o.tipo === 'saltar') {
                    for (const page of paginas) await descubrir(page).catch(() => {});
                    reintentando = o.tipo === 'reintentar';
                    return o.tipo;
                }
                throw new Interrupcion(o.tipo, { indice: o.valor });
            },
        };

        /** Las ventanas del paso: la del actor sola, o las dos del tramo dividido lado a lado. */
        async function disponer(info) {
            if (!ordenarVentanas) return;
            const visibles = info.dividir ?? [info.paso.actor];
            const clave = visibles.join('|');
            if (clave === disposicionAnterior) return;
            try {
                const paneles = visibles.map((nombre) => {
                    const datos = actores.get(nombre);
                    const { pista } = opcionesDeContexto(config, nombre, sesiones, { ancho: config.video.ancho, alto: config.video.alto });
                    return { nombre, tipo: datos?.telefono ? 'telefono' : 'escritorio', ancho: pista.ancho, alto: pista.alto };
                });
                await ubicarVentanas(actores, disposicionVentanas({ pantalla, paneles }));
                disposicionAnterior = clave;
            } catch (e) {
                // Sin ventanas ordenadas la demo sigue: se avisa y el presentador las mueve a mano.
                control.actualizar({ aviso: `No pude ordenar las ventanas (${e.message}).` });
            }
        }
    }
}

function indiceDe(capitulos, desde) {
    if (desde == null || desde === '') return 0;
    const porId = capitulos.findIndex((c) => String(c.id) === String(desde) || c.guion === desde);
    if (porId >= 0) return porId;
    const n = Number(desde);
    if (Number.isInteger(n) && n >= 0 && n < capitulos.length) return n;
    throw new Error(`--desde=${desde}: no hay un capítulo con ese id (hay: ${capitulos.map((c) => c.id).join(', ')})`);
}
