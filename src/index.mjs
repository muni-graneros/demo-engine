export { cargarConfig, ErrorConfig } from './configurar.mjs';
export { prepararSesiones, prepararSesionesParaGuion, sesionSigueViva, actoresDeGuion, totp } from './sesiones.mjs';
export { grabar } from './grabador.mjs';
export { montar } from './montaje.mjs';
export { pegarCapitulos } from './curso.mjs';
export { generarManual } from './manual.mjs';
export { capturarContexto } from './contexto.mjs';
export { crearVoz } from './voz/index.mjs';
export { portada, cierre, esPlano } from './rotulos.mjs';
export { elenco, presentar, quitarPresentacion, anotar, configurarPresentacion, POSICIONES_FICHA } from './explainer.mjs';
export {
    abrirFiltrado, abrirVerificado, cubrir, descubrir, exigirEntornoDeDesarrollo,
    identificadoresEnPantalla, exigirUnaSolaPersona,
} from './privacidad.mjs';
export { auditarVideo, auditarCapturas, muestrearFrames, contarIdentificadores, exigirAuditoriaConfigurada } from './auditoria.mjs';
export {
    instalarCursor, moverCursorA, pulsar, acercarA, alejar, configurarCamara, configurarCursor, conCursorOculto, escalaQueCabe,
} from './camara.mjs';
export { ejecutarGuion, Interrupcion, pasosEnOrden } from './ejecutor.mjs';
export { vivo, capitulosDe, buscarClip, exigirEntornoEnVivo, disposicionVentanas } from './vivo/index.mjs';
export { comandoDeSembrado } from './sembrar.mjs';
export { partirCue, partirCues, configurarSubtitulos } from './subtitulos.mjs';

/**
 * Lo que sabe hacer este motor, para que un consumidor decida su camino sin comparar
 * versiones (`motor.CAPACIDADES?.includes('cursor-tactil')`). Sólo se agrega una capacidad
 * cuando está implementada y probada: el consumidor cambia de comportamiento según esta lista.
 */
export const CAPACIDADES = Object.freeze([
    'acercar-ajustado',          // acercarA topa la escala para que el objetivo entre entero
    'cursor-tactil',             // indicador de toque en superficies táctiles; capturas sin cursor
    'subtitulos-partidos',       // cues por frase, a lo más 2 líneas de 42
    'navegador-args',            // navegador.args (host-resolver-rules sólo a loopback)
    'planos-pantalla-completa',  // portadas y cierres fuera del marco (video.rotulos)
    'dividida-con-foco',         // pantalla dividida con foco en el actor (video.dividida)
    'ficha-sin-tapar',           // presentar en auto/configurarPresentacion/superficies.<id>.presentar
    'anotar-al-lado',            // globo de anotar medido, al lado del objetivo (lado)
    'sin-destellos',             // ningún tramo arranca con un cuadro negro
]);
