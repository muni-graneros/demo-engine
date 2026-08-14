import * as piper from './piper.mjs';
import * as kokoro from './kokoro.mjs';
import { resolverVenvYVoces } from './resolver.mjs';

const MOTORES = { piper, kokoro };

/**
 * Avisa por stderr que se pidió voz pero no se encontró ningún motor instalado. No es un
 * error fatal (el video sale igual, con subtítulos y sin locución) pero SÍ tiene que
 * notarse: un curso entero salió mudo porque esta degradación era completamente silenciosa
 * y nadie revisó el audio hasta después de publicarlo.
 */
function avisarSinVoz({ motor, respaldo, venv, voces, errores = [] }) {
    const { venv: rutaVenv, voces: rutaVoces } = resolverVenvYVoces({ venv, voces });
    process.stderr.write([
        '',
        `[demo-engine] AVISO: la config pide voz (motor "${motor}"${respaldo ? `, respaldo "${respaldo}"` : ''}) ` +
            'pero no encontré ningún motor instalado.',
        `  venv buscado en:    ${rutaVenv}`,
        `  modelos buscados en: ${rutaVoces}`,
        // Motivo concreto por candidato, no solo "no disponible": el mismo patrón de falla
        // silenciosa que ya costó un curso mudo (los archivos podían estar en disco y la
        // síntesis igual fallar, p. ej. sin una biblioteca nativa).
        ...errores.map((e) => `  ${e}`),
        '  El video va a salir CON subtítulos pero SIN locución (degradación intencional, no aborta la grabación).',
        '  Para instalar las voces: bash node_modules/demo-engine/herramientas/instalar-voces.sh',
        '  (o declará voz.venv / voz.voces en demo.config.mjs si ya las instalaste en otra carpeta)',
        '',
    ].join('\n'));
}

/**
 * Devuelve el motor de voz configurado, cayendo al respaldo si el principal no está.
 * Si no hay ninguno, la voz queda "no disponible" y el video sale con subtítulos y sin
 * locución — degradar es preferible a abortar la grabación, pero se avisa fuerte por
 * stderr (ver `avisarSinVoz`) salvo que se haya pedido `motor: 'ninguno'` a propósito.
 */
export function crearVoz({ motor = 'kokoro', voz, respaldo = 'piper', venv, voces } = {}) {
    const candidatos = [motor, respaldo].filter(Boolean);
    const errores = [];
    for (const nombre of candidatos) {
        const modulo = MOTORES[nombre];
        if (!modulo) continue;
        const instancia = modulo.crear({ voz, venv, voces });
        if (instancia.disponible()) return instancia;
        if (instancia.error?.()) errores.push(`${nombre}: ${instancia.error()}`);
        instancia.limpiar?.();
    }
    if (motor !== 'ninguno') avisarSinVoz({ motor, respaldo, venv, voces, errores });
    return { motor: 'ninguno', disponible: () => false, sintetizar: () => null, limpiar: () => {} };
}
