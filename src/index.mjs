export { cargarConfig, ErrorConfig } from './configurar.mjs';
export { prepararSesiones, prepararSesionesParaGuion, sesionSigueViva, actoresDeGuion, totp } from './sesiones.mjs';
export { grabar } from './grabador.mjs';
export { montar } from './montaje.mjs';
export { pegarCapitulos } from './curso.mjs';
export { generarManual } from './manual.mjs';
export { crearVoz } from './voz/index.mjs';
export { portada, cierre } from './rotulos.mjs';
export {
    abrirFiltrado, abrirVerificado, cubrir, descubrir, exigirEntornoDeDesarrollo,
    identificadoresEnPantalla, exigirUnaSolaPersona,
} from './privacidad.mjs';
export { auditarVideo, auditarCapturas, muestrearFrames, contarIdentificadores, exigirAuditoriaConfigurada } from './auditoria.mjs';
export { instalarCursor, moverCursorA, pulsar, acercarA, alejar } from './camara.mjs';
