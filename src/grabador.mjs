import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { exigirEntornoDeDesarrollo, exigirUnaSolaPersona } from './privacidad.mjs';
import { instalarCursor } from './camara.mjs';
import { iniciarGrabacion } from './pantalla.mjs';
import { duracion } from './ffmpeg.mjs';

/**
 * Ejecuta un guion y devuelve las pistas grabadas más los pasos con doble reloj.
 *
 * Cada actor tiene su propio contexto (y por lo tanto su propio video, con reloj propio).
 * Por eso de cada paso se anotan DOS tiempos: `tLocal`, dónde cae dentro de la pista de su
 * actor, y `tGlobal`, dónde cae en el relato. El montaje usa ambos.
 */
export async function grabar(guion, { config, sesiones, salida, voz }) {
    exigirEntornoDeDesarrollo(config.baseURL);

    const { ancho, alto, pausaMinima, calidad, fps } = config.video;
    const navegador = await chromium.launch();
    const contextos = new Map();   // actor → { ctx, page, t0 }
    const pasos = [];
    const t0Global = Date.now();

    // El manual (`generarManual`) sale de docs/manual junto con `salida`: por eso la ruta
    // que se guarda en cada paso es RELATIVA a `salida`, no absoluta. Un subdirectorio
    // propio evita ensuciar `salida` con un PNG por paso al lado del mp4.
    const dirCapturas = join(salida, 'capturas');
    mkdirSync(dirCapturas, { recursive: true });
    let indiceCaptura = 0;

    /**
     * Crea (o recupera) el contexto de un actor, anotando cuándo empezó su grabación.
     *
     * El cursor se instala AQUÍ, antes de fijar `t0`: si se instalara después de capturar
     * el reloj, el viaje de ida y vuelta al navegador sumaría unos milisegundos y el
     * primer paso de la pista ya no arrancaría exactamente en cero.
     *
     * La grabación de pantalla es propia (`src/pantalla.mjs`, por CDP), no `recordVideo` de
     * Playwright: ese solo deja elegir tamaño, con el bitrate fijo adentro y demasiado bajo
     * para que el texto de un panel se lea nítido.
     */
    async function actorDe(nombre) {
        if (contextos.has(nombre)) return contextos.get(nombre);
        if (!sesiones[nombre]) throw new Error(`el guion usa el actor "${nombre}", que no está en la config`);
        const ctx = await navegador.newContext({
            baseURL: config.baseURL,
            storageState: sesiones[nombre],
            viewport: { width: ancho, height: alto },
            locale: 'es-CL',
        });
        const page = await ctx.newPage();
        await instalarCursor(page);
        const archivoPista = join(salida, `pista-${nombre}.mp4`);
        const grabacion = await iniciarGrabacion(page, { ancho, alto, salida: archivoPista, calidad, fps });
        const datos = { ctx, page, t0: Date.now(), grabacion };
        contextos.set(nombre, datos);
        return datos;
    }

    try {
        for (const escena of guion.escenas) {
            for (const [indice, paso] of escena.pasos.entries()) {
                try {
                    const { page, t0 } = await actorDe(paso.actor);

                    const inicioLocal = Date.now() - t0;
                    const inicioGlobal = Date.now() - t0Global;

                    // Se repone el cursor antes de actuar: en un actor reutilizado, el paso
                    // anterior pudo haber navegado y una navegación se lleva el cursor consigo.
                    await instalarCursor(page);
                    // Segundo argumento: el contexto del guion. Como mínimo trae `config`, de
                    // donde `portada()`/`cierre()` sacan `config.marca` (nombre, color, escudo).
                    // Sin esto, un guion no tenía forma de alcanzar la identidad del sistema que
                    // está grabando y las portadas salían con el azul por defecto del paquete —
                    // visible en el video final, porque es lo primero que se ve de cada capítulo.
                    // Los guiones que declaran `hacer(page)` a secas ignoran este segundo
                    // argumento y siguen funcionando sin cambios.
                    await paso.hacer(page, { config });
                    await instalarCursor(page);   // el propio `hacer` también pudo navegar

                    // El paso dura lo que dure su locución (más un mínimo), en vez de un tiempo
                    // fijo: con espera fija la voz sigue sonando sobre la pantalla siguiente.
                    //
                    // La locución se sintetiza UNA sola vez: aquí se genera el .wav, se mide, y
                    // la ruta viaja en el paso para que el montaje lo reutilice. Sintetizarla de
                    // nuevo al montar duplicaría el trabajo más caro del pipeline en una máquina
                    // sin GPU.
                    let wav = null;
                    let msVoz = 0;
                    if (paso.narrar && voz.disponible()) {
                        wav = voz.sintetizar(paso.narrar);
                        if (wav) msVoz = Math.round(duracion(wav) * 1000);
                    }
                    await page.waitForTimeout(Math.max(pausaMinima, msVoz));

                    // Comprobación en vivo, al cierre del paso y ANTES de la captura para el
                    // manual: lee el DOM (sin OCR, 4-6 ms medido) y cuenta identificadores
                    // distintos con el `patron`/`validar` de `config.auditoria`. Es la misma
                    // pasada la que cubre "antes de cada captura" y "al cerrar cada paso" — en
                    // este bucle son el mismo instante, porque cada paso deja EXACTAMENTE una
                    // captura, siempre al final. Ver src/privacidad.mjs.
                    //
                    // `paso.variasPersonas: true` es la excepción declarada a propósito, para
                    // las pantallas donde mostrar varias personas es lo correcto (un reporte
                    // agregado, una cola). Lo seguro es el valor por defecto: hay que escribir
                    // la excepción, no al revés.
                    if (!paso.variasPersonas) {
                        await exigirUnaSolaPersona(page, config.auditoria);
                    }

                    // Se captura la pantalla TAL COMO ESTÁ, con el mismo `page.screenshot` que
                    // usaría cualquiera: si el guion puso el cubridor, sale tapada, que es lo
                    // correcto para el manual. Nunca `fullPage` (Playwright no garantiza que los
                    // elementos `position:fixed` —el cubridor— cubran una captura de página
                    // completa) ni por selector (saltaría el overlay de privacidad).
                    const nombreCaptura = `${escena.id}-${indiceCaptura++}.png`;
                    await page.screenshot({ path: join(dirCapturas, nombreCaptura) });

                    pasos.push({
                        escena: escena.id,
                        titulo: escena.titulo,
                        actor: paso.actor,
                        tLocal: inicioLocal,
                        tGlobal: inicioGlobal,
                        duracionMs: (Date.now() - t0) - inicioLocal,
                        narrar: paso.narrar,
                        wav,
                        captura: `capturas/${nombreCaptura}`,
                    });
                } catch (error) {
                    // Se identifica CON PRECISIÓN qué paso y qué escena fallaron: en un guion
                    // largo, "algo reventó" obliga a releer todo el guion para ubicar el punto;
                    // esto lo dice directo. `{ cause }` conserva el error original completo
                    // (stack incluido) para quien necesite más detalle que el mensaje.
                    throw new Error(
                        `guion "${guion.id}", escena "${escena.id}" ("${escena.titulo}"), paso ${indice + 1} ` +
                        `(actor "${paso.actor}"): ${error.message}`,
                        { cause: error },
                    );
                }
            }
        }

        const pistas = {};
        for (const [nombre, { ctx, grabacion }] of contextos) {
            // Detener el screencast ANTES de cerrar el contexto: la sesión CDP muere con la
            // página, así que si se cierra primero se pierde el ack del último frame en vuelo.
            pistas[nombre] = await grabacion.detener();
            await ctx.close();
        }
        return { pistas, pasos };
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
