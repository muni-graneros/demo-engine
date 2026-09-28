import { devices } from 'playwright';
import { exigirEntornoDeDesarrollo } from './privacidad.mjs';

/** ¿El actor trae sesión guardada? Por defecto sí: `sesion: false` es la excepción declarada
 * (la app del vecino, un APK, una landing pública), no al revés. */
export function actorConSesion(config, nombre) {
    return config.actores?.[nombre]?.sesion !== false;
}

/**
 * Opciones de `browser.newContext()` para un actor, más el tamaño de su pista de video.
 *
 * Vive aparte porque la usan DOS caminos que tienen que ver lo mismo: el grabador (el
 * video) y `capturarContexto` (el pack de pantallas que alimenta guiones y manuales). Si
 * cada uno armara su contexto a mano, el pack mostraría el panel de escritorio mientras
 * el video muestra el teléfono, y el guion se escribiría sobre la pantalla equivocada.
 *
 * - `baseURL`: la del actor si la declara (la app del vecino suele vivir en otro host que
 *   el panel), si no la global. Pasa por `exigirEntornoDeDesarrollo` ACÁ, por actor: el
 *   guardián de `config.baseURL` no dice nada de un host distinto declarado en un actor.
 * - `dispositivo`: el descriptor de Playwright completo (viewport, userAgent, isMobile,
 *   hasTouch, deviceScaleFactor). Solo el viewport no alcanza: sin `isMobile`/`hasTouch`
 *   la app responsive sigue sirviendo el menú de escritorio aunque la ventana sea angosta.
 * - `storageState` solo si el actor tiene sesión. Quién exige que exista es el que llama,
 *   porque cada uno lo reporta con su propio contexto (guion o pantalla).
 *
 * @returns {{ opciones: object, pista: { ancho: number, alto: number }, baseURL: string }}
 */
export function opcionesDeContexto(config, nombre, sesiones, { ancho, alto }) {
    const datosActor = config.actores?.[nombre] ?? {};
    const baseURL = datosActor.baseURL ?? config.baseURL;
    exigirEntornoDeDesarrollo(baseURL);

    let disp = null;
    if (datosActor.dispositivo) {
        if (!devices[datosActor.dispositivo]) {
            throw new Error(`el actor "${nombre}" declara el dispositivo "${datosActor.dispositivo}", que Playwright no conoce`);
        }
        disp = { ...devices[datosActor.dispositivo] };
        // Es una preferencia de navegador (webkit para un iPhone), no una opción de contexto:
        // el motor graba siempre con Chromium, porque el screencast es por CDP.
        delete disp.defaultBrowserType;
    }

    const opciones = {
        baseURL,
        ...(actorConSesion(config, nombre) && sesiones?.[nombre] ? { storageState: sesiones[nombre] } : {}),
        ...(disp ?? { viewport: { width: ancho, height: alto } }),
        ...(datosActor.permisos ? { permissions: datosActor.permisos } : {}),
        ...(datosActor.geolocalizacion ? { geolocation: datosActor.geolocalizacion } : {}),
    };

    // Un teléfono se graba a su viewport CSS (Pixel 7: 412×839 → 412×840), sin multiplicar
    // por la densidad. El screencast de Chromium headless entrega los frames en píxeles CSS
    // aunque el dispositivo declare `deviceScaleFactor` 2,625 (`maxWidth`/`maxHeight` solo
    // ponen un techo, no agrandan), así que una pista más grande era ffmpeg estirando esos
    // frames: más peso y nitidez falsa. Y no hace falta más: en el lienzo de 1080p el hueco
    // del teléfono mide ≤ ~384 px de ancho, menos que la resolución nativa. Redondeado a par
    // porque yuv420p no admite lados impares.
    let pista = { ancho, alto };
    if (disp) {
        const par = (n) => Math.round(n / 2) * 2;
        pista = { ancho: par(disp.viewport.width), alto: par(disp.viewport.height) };
    }

    return { opciones, pista, baseURL };
}
