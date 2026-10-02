import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { exigirEntornoDeDesarrollo } from './privacidad.mjs';
import { alClicar, configurarCamara, conCursorOculto } from './camara.mjs';
import { opcionesDeLanzamiento } from './contexto-actor.mjs';
import { ejecutarGuion } from './ejecutor.mjs';
import { iniciarGrabacion } from './pantalla.mjs';
import { esPlano } from './rotulos.mjs';
import { duracion } from './ffmpeg.mjs';

/**
 * Ejecuta un guion y devuelve las pistas grabadas más los pasos con doble reloj.
 *
 * Cada actor tiene su propio contexto (y por lo tanto su propio video, con reloj propio).
 * Por eso de cada paso se anotan DOS tiempos: `tLocal`, dónde cae dentro de la pista de su
 * actor, y `tGlobal`, dónde cae en el relato. El montaje usa ambos.
 *
 * Devuelve `{ pistas, pasos, origenes, clics, dimensiones }`:
 * - `origenes[actor]`: en qué ms del reloj global arrancó la pista de ese actor. El montaje
 *   lo necesita para la pantalla dividida: el panel del OTRO actor no tiene paso propio en
 *   ese tramo, así que su corte se calcula como `tGlobal - origen`.
 * - `clics`: ms globales de cada `pulsar()`, para el clic sonoro de la mezcla.
 * - `focos`: lo mismo con el actor y el punto de la página (`{ t, actor, x, y, escala }`), para
 *   la cámara automática del acabado.
 * - `dimensiones[actor]`: el tamaño real de su pista (un teléfono no mide lo que la config).
 * - cada paso lleva `dividir: [actor, actor] | null`, vigente desde el paso que lo declara
 *   hasta uno con `dividir: null`, y nunca más allá de su escena.
 * - cada paso lleva `plano: 'portada' | 'cierre' | 'paso' | null`: si terminó mostrando un
 *   rótulo plano (ver `esPlano` en src/rotulos.mjs) o lo forzó con `marco: false`.
 */
export async function grabar(guion, { config, sesiones, salida, voz }) {
    exigirEntornoDeDesarrollo(config.baseURL);

    const { ancho, alto, pausaMinima, calidad, fps, msCursor } = config.video;
    // El ritmo del puntero es del proyecto, no del motor: un tutorial de trámite
    // se sigue mejor ágil y uno de capacitación, pausado.
    configurarCamara({ msCursor });
    const navegador = await chromium.launch(opcionesDeLanzamiento(config));
    const contextos = new Map();   // actor → { ctx, page, pista, t0, grabacion, dim }
    const pasos = [];
    const clics = [];
    const focos = [];

    /*
     * Todas las locuciones se sintetizan ANTES de que empiece a grabarse nada.
     *
     * Sintetizarlas dentro del bucle metía el costo del motor de voz DENTRO del
     * video: en una máquina sin GPU cada locución tarda decenas de segundos, y
     * ese rato quedaba grabado como una pantalla congelada entre paso y paso. El
     * espectador lo lee como «el sistema se quedó pensando», y no es el sistema:
     * es el tutorial sintetizando la frase siguiente.
     *
     * Se cachea por TEXTO, no por paso: dos pasos que narran lo mismo —una
     * muletilla repetida entre capítulos— pagan una sola síntesis.
     */
    const locuciones = new Map();
    if (voz.disponible()) {
        for (const escena of guion.escenas) {
            for (const paso of escena.pasos) {
                if (!paso.narrar || locuciones.has(paso.narrar)) continue;
                const wav = voz.sintetizar(paso.narrar);
                locuciones.set(paso.narrar, wav ? { wav, ms: Math.round(duracion(wav) * 1000) } : null);
            }
        }
    }

    const t0Global = Date.now();

    // El manual (`generarManual`) sale de docs/manual junto con `salida`: por eso la ruta
    // que se guarda en cada paso es RELATIVA a `salida`, no absoluta. Un subdirectorio
    // propio evita ensuciar `salida` con un PNG por paso al lado del mp4.
    const dirCapturas = join(salida, 'capturas');
    mkdirSync(dirCapturas, { recursive: true });
    let indiceCaptura = 0;

    // Relojes del paso en curso: los fija `antesDePaso` y los leen los ganchos siguientes.
    let inicioLocal = 0;
    let inicioGlobal = 0;

    /*
     * La semántica del guion (actores perezosos, `dividir`, cursor, portero, errores con
     * contexto) vive en `ejecutarGuion` (src/ejecutor.mjs), compartida con la demo en vivo.
     * Acá solo se cuelga la GRABACIÓN de sus ganchos: pista, relojes, espera por la voz y
     * captura para el manual.
     */
    const ganchos = {
        /**
         * La grabación de pantalla es propia (`src/pantalla.mjs`, por CDP), no `recordVideo` de
         * Playwright: ese solo deja elegir tamaño, con el bitrate fijo adentro y demasiado bajo
         * para que el texto de un panel se lea nítido.
         *
         * El cursor ya lo instaló el ejecutor ANTES de este gancho, y `t0` se fija al final:
         * si se instalara después de capturar el reloj, el viaje de ida y vuelta al navegador
         * sumaría unos milisegundos y el primer paso de la pista ya no arrancaría en cero.
         */
        async alAbrirActor(nombre, datos) {
            // El reloj de los clics es el GLOBAL, no el de la pista: el clic sonoro se mezcla
            // sobre el audio del video final, que corre en tiempo de relato.
            // El punto del clic (px de la página) alimenta la cámara automática del acabado.
            alClicar(datos.page, (t, punto) => {
                clics.push(t - t0Global);
                if (punto) focos.push({ t: t - t0Global, actor: nombre, x: punto.x, y: punto.y, escala: punto.escala ?? 1 });
            });
            // Con acabado, la pestaña recién abierta (about:blank, blanca) se pinta como pantalla
            // apagada: el primer tramo de un actor que todavía no navegó ya no destella en blanco.
            if (config.video?.acabado && datos.page.url() === 'about:blank') {
                await datos.page.setContent('<!doctype html><html style="background:#0b1215"><body style="margin:0;background:#0b1215"></body></html>').catch(() => {});
            }
            const archivoPista = join(salida, `pista-${nombre}.mp4`);
            // La pista se graba al tamaño del actor, no al de `config.video`: un teléfono mide
            // su viewport CSS (ver `opcionesDeContexto`), que es lo que el screencast entrega de
            // verdad; con el tamaño de escritorio, ffmpeg lo encajonaría entre bandas negras.
            datos.grabacion = await iniciarGrabacion(datos.page, { ...datos.pista, salida: archivoPista, calidad, fps });
            datos.t0 = Date.now();
            datos.dim = datos.pista;
        },

        antesDePaso({ actor }) {
            inicioLocal = Date.now() - actor.t0;
            inicioGlobal = Date.now() - t0Global;
        },

        /*
         * El paso dura lo que dure su locución (más un mínimo), en vez de un tiempo fijo: con
         * espera fija la voz sigue sonando sobre la pantalla siguiente.
         *
         * Lo que la acción del paso YA consumió se descuenta de la espera. Antes se esperaba
         * la locución ENTERA después de actuar, así que cada paso era una acción muda seguida
         * de una pantalla congelada hablando: la voz y lo que se ve nunca coincidían. Medido
         * en un tutorial de doce pasos: pasos de 30 a 60 segundos para narraciones de tres
         * frases. Ahora el audio —que el montaje pega al inicio del paso— suena mientras la
         * pantalla se mueve, que es como se ve un tutorial de verdad.
         */
        async esperarNarracion({ paso, actor }) {
            const locucion = paso.narrar ? locuciones.get(paso.narrar) : null;
            const msVoz = locucion?.ms ?? 0;
            const consumido = Date.now() - actor.t0 - inicioLocal;
            await actor.page.waitForTimeout(Math.max(pausaMinima, msVoz - consumido));
        },

        /*
         * Con el portero ya pasado se captura la pantalla TAL COMO ESTÁ, con el mismo
         * `page.screenshot` que usaría cualquiera: si el guion puso el cubridor, sale tapada,
         * que es lo correcto para el manual. Nunca `fullPage` (Playwright no garantiza que los
         * elementos `position:fixed` —el cubridor— cubran una captura de página completa) ni
         * por selector (saltaría el overlay de privacidad).
         *
         * La locución se sintetizó UNA sola vez: la ruta del .wav viaja en el paso para que el
         * montaje la reutilice. Sintetizarla de nuevo al montar duplicaría el trabajo más caro
         * del pipeline en una máquina sin GPU.
         */
        async despuesDePaso({ escena, paso, actor, dividir }) {
            // ¿El paso terminó en una portada o un cierre? El montaje saca ese tramo a
            // pantalla completa, sin marco de navegador. `paso.marco` lo fuerza:
            // `false` = plano aunque no haya portada, `true` = con marco aunque la haya.
            const plano = paso.marco === true ? null : paso.marco === false ? 'paso' : await esPlano(actor.page);
            const nombreCaptura = `${escena.id}-${indiceCaptura++}.png`;
            // `cursorEnCapturas: false`: la imagen fija del manual sale sin cursor (en el
            // video sí se ve; ahí dice dónde se toca). `!== false` para que una config
            // armada a mano sin el campo siga como siempre.
            const capturar = () => actor.page.screenshot({ path: join(dirCapturas, nombreCaptura) });
            await (config.video?.cursorEnCapturas === false ? conCursorOculto(actor.page, capturar) : capturar());
            const locucion = paso.narrar ? locuciones.get(paso.narrar) : null;
            pasos.push({
                escena: escena.id,
                titulo: escena.titulo,
                actor: paso.actor,
                tLocal: inicioLocal,
                tGlobal: inicioGlobal,
                duracionMs: (Date.now() - actor.t0) - inicioLocal,
                narrar: paso.narrar,
                wav: locucion?.wav ?? null,
                captura: `capturas/${nombreCaptura}`,
                dividir,
                plano,
                // El acabado no recorta silencios dentro de este paso (una espera que ES la acción).
                ...(paso.sinRecorte ? { sinRecorte: true } : {}),
            });
        },
    };

    try {
        await ejecutarGuion(guion, { config, sesiones, navegador, actores: contextos, tamano: { ancho, alto }, ganchos });

        const pistas = {};
        const origenes = {};
        const dimensiones = {};
        for (const [nombre, { ctx, grabacion, t0, dim }] of contextos) {
            origenes[nombre] = t0 - t0Global;
            dimensiones[nombre] = dim;
            // Detener el screencast ANTES de cerrar el contexto: la sesión CDP muere con la
            // página, así que si se cierra primero se pierde el ack del último frame en vuelo.
            pistas[nombre] = await grabacion.detener();
            await ctx.close();
        }
        return { pistas, pasos, origenes, clics, focos, dimensiones };
    } catch (error) {
        // Si se llegó hasta acá con un error, algún paso reventó antes de cerrar los
        // contextos en el camino feliz de arriba: hay que cerrarlos ACÁ para que la pista de
        // cada actor quede bien encodeada hasta el último frame grabado, en vez de quedar
        // faltante (o de depender de que `navegador.close()`, en el `finally`, las descarte).
        for (const [, { ctx, grabacion }] of contextos) {
            await grabacion.detener().catch(() => {});
            await ctx.close().catch(() => {});
        }
        throw error;
    } finally {
        await navegador.close();
    }
}
