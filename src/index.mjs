export { cargarConfig, ErrorConfig } from './configurar.mjs';
export { prepararSesiones, prepararSesionesParaGuion, sesionSigueViva, actoresDeGuion, totp } from './sesiones.mjs';
export { grabar } from './grabador.mjs';
export { montar } from './montaje.mjs';
export { pegarCapitulos } from './curso.mjs';
export { generarManual } from './manual.mjs';
export { capturarContexto } from './contexto.mjs';
export { crearVoz } from './voz/index.mjs';
export { portada, cierre } from './rotulos.mjs';
export { elenco, presentar, quitarPresentacion, anotar } from './explainer.mjs';
export {
    abrirFiltrado, abrirVerificado, cubrir, descubrir, exigirEntornoDeDesarrollo,
    identificadoresEnPantalla, exigirUnaSolaPersona,
} from './privacidad.mjs';
export { auditarVideo, auditarCapturas, muestrearFrames, contarIdentificadores, exigirAuditoriaConfigurada } from './auditoria.mjs';
export { instalarCursor, moverCursorA, pulsar, acercarA, alejar, configurarCamara } from './camara.mjs';
export { ejecutarGuion, Interrupcion, pasosEnOrden } from './ejecutor.mjs';
export { vivo, capitulosDe, buscarClip, exigirEntornoEnVivo, disposicionVentanas } from './vivo/index.mjs';
export { comandoDeSembrado } from './sembrar.mjs';

/**
 * Lo que sabe hacer esta versión del motor, para que un sistema pueda adaptarse sin mirar
 * números de versión (p. ej. declarar `sembrar` como función solo si el motor la entiende).
 */
export const CAPACIDADES = Object.freeze(['sembrar-funcion', 'vivo']);
