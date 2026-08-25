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
 * Etiqueta humana del motivo de un motor no disponible. Distingue "no instalado" (faltan
 * archivos, ni se intentó correr nada) de "falló al arrancar" (los archivos estaban, se
 * intentó correr de verdad y no funcionó): confundirlos manda a alguien a reinstalar un
 * motor que no está roto, cuando lo que falló fue un arranque puntual.
 */
function etiquetaMotivo(motivo) {
    return motivo === 'no-instalado' ? 'no está instalado' : 'está instalado pero falló al arrancar';
}

/**
 * Avisa por stderr que el motor PREFERIDO no respondió y la corrida sigue con un respaldo.
 * No es un error fatal (la corrida sigue CON locución, solo que de otro motor) pero tiene
 * que notarse: sin este aviso, la sonda de disponible() de `proceso.mjs` puede caer al
 * respaldo por un fallo transitorio (o uno real) y el curso entero sale con una voz distinta
 * a la configurada sin que nadie se entere hasta escuchar el audio.
 */
function avisarCaidaARespaldo({ motor, usado, errores }) {
    process.stderr.write([
        '',
        `[demo-engine] AVISO: el motor de voz preferido ("${motor}") no respondió; esta corrida usa el respaldo "${usado}".`,
        ...errores.map((e) => `  ${e}`),
        `  La corrida sigue CON locución (no degrada a subtítulos-sin-voz), pero conviene revisar`,
        `  por qué "${motor}" no respondió antes de la próxima corrida.`,
        '',
    ].join('\n'));
}

/**
 * Devuelve el motor de voz configurado, cayendo al respaldo si el principal no está.
 * Si no hay ninguno, la voz queda "no disponible" y el video sale con subtítulos y sin
 * locución — degradar es preferible a abortar la grabación, pero se avisa fuerte por
 * stderr (ver `avisarSinVoz`) salvo que se haya pedido `motor: 'ninguno'` a propósito.
 * Si el principal falla pero el respaldo SÍ responde, también se avisa (ver
 * `avisarCaidaARespaldo`): que la corrida siga con voz no significa que el cambio de motor
 * deba pasar en silencio.
 *
 * `voz` y `vozRespaldo` son campos SEPARADOS a propósito: Kokoro nombra sus voces por
 * identificador (`ef_dora`, `em_alex`) y Piper por archivo de modelo (`es_ES-davefx-medium`,
 * que busca en `<voces>/<voz>.onnx`). Reenviar el mismo nombre a los dos motores rompe el
 * respaldo en cuanto sus nomenclaturas no coinciden: quedaba declarado pero nunca disponible.
 * Si no se declara `vozRespaldo`, el respaldo usa SU PROPIO valor por defecto (no el del
 * motor principal) — es lo que un consumidor espera al escribir solo `voz` para el motor
 * principal.
 */
export function crearVoz({ motor = 'kokoro', voz, respaldo = 'piper', vozRespaldo, venv, voces, velocidad = 1 } = {}) {
    // `?? undefined` normaliza el `null` que trae `cargarConfig()` cuando el consumidor no
    // declaró `vozRespaldo`: los `crear()` de cada motor solo aplican su valor por defecto
    // cuando el parámetro es `undefined`, no cuando es `null`.
    const candidatos = [
        { nombre: motor, voz },
        { nombre: respaldo, voz: vozRespaldo ?? undefined },
    ].filter((c) => c.nombre);
    // La velocidad es del VIDEO, no del motor: si el principal no arranca y entra
    // el respaldo, el ritmo de la locución tiene que ser el mismo o el tutorial
    // cambia de cadencia a mitad de camino.
    const errores = [];
    for (const [indice, candidato] of candidatos.entries()) {
        const { nombre, voz: vozCandidato } = candidato;
        const modulo = MOTORES[nombre];
        if (!modulo) continue;
        const instancia = modulo.crear({ voz: vozCandidato, venv, voces, velocidad });
        if (instancia.disponible()) {
            if (indice > 0) avisarCaidaARespaldo({ motor, usado: nombre, errores });
            return instancia;
        }
        if (instancia.error?.()) errores.push(`${nombre} (${etiquetaMotivo(instancia.motivo?.())}): ${instancia.error()}`);
        instancia.limpiar?.();
    }
    if (motor !== 'ninguno') avisarSinVoz({ motor, respaldo, venv, voces, errores });
    return { motor: 'ninguno', disponible: () => false, sintetizar: () => null, limpiar: () => {} };
}
