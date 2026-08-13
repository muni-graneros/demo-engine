import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { exigirEntornoDeDesarrollo } from './privacidad.mjs';
import { instalarCursor } from './camara.mjs';
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

    const { ancho, alto, pausaMinima } = config.video;
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
     */
    async function actorDe(nombre) {
        if (contextos.has(nombre)) return contextos.get(nombre);
        if (!sesiones[nombre]) throw new Error(`el guion usa el actor "${nombre}", que no está en la config`);
        const ctx = await navegador.newContext({
            baseURL: config.baseURL,
            storageState: sesiones[nombre],
            viewport: { width: ancho, height: alto },
            locale: 'es-CL',
            recordVideo: { dir: salida, size: { width: ancho, height: alto } },
        });
        const page = await ctx.newPage();
        await instalarCursor(page);
        const datos = { ctx, page, t0: Date.now() };
        contextos.set(nombre, datos);
        return datos;
    }

    try {
        for (const escena of guion.escenas) {
            for (const paso of escena.pasos) {
                const { page, t0 } = await actorDe(paso.actor);

                const inicioLocal = Date.now() - t0;
                const inicioGlobal = Date.now() - t0Global;

                // Se repone el cursor antes de actuar: en un actor reutilizado, el paso
                // anterior pudo haber navegado y una navegación se lleva el cursor consigo.
                await instalarCursor(page);
                await paso.hacer(page);
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
            }
        }

        const pistas = {};
        for (const [nombre, { ctx, page }] of contextos) {
            const video = page.video();
            await ctx.close();                       // el .webm recién queda escrito al cerrar
            pistas[nombre] = await video.path();
        }
        return { pistas, pasos };
    } finally {
        await navegador.close();
    }
}
