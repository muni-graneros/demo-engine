/** Defectos de `video.acabado` (spec 2026-10-02-video-moderno). Módulo aparte para que
 * `configurar.mjs` los lea sin cargar Chromium ni ffmpeg. */
export const DEFECTOS_ACABADO = Object.freeze({
    fps: 60,
    crf: 18,
    silencios: Object.freeze({ maxSeg: 2, margenSeg: 0.5 }),
    camara: Object.freeze({ zoom: 1.5, zoomTelefono: 1.3 }),
    subtitulos: Object.freeze({ tamano: 34 }),
    rotulos: Object.freeze({ segundos: 3.2 }),
});
