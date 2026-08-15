import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as piper from '../src/voz/piper.mjs';
import * as kokoro from '../src/voz/kokoro.mjs';

/**
 * Ejecutor de mentira para `crearMotorProceso` (inyectado vía `ejecutarProceso`, ver
 * proceso.mjs): sin lanzar NINGÚN proceso real, cuenta invocaciones en memoria y puede
 * simular éxito o un fallo con un mensaje concreto.
 *
 * Por qué no un proceso real: bajo carga (varias corridas de la suite en paralelo),
 * `fork/exec` de un proceso real falla de forma TRANSITORIA por contención de recursos del
 * propio sistema operativo — medido, ~1 de cada 8 corridas. Ese fallo es genuino, pero ajeno
 * a lo que estas pruebas quieren verificar: cacheo de la sonda, reintento, agrupación del
 * directorio temporal, limpieza. Probarlo con un ejecutor en memoria hace que esas pruebas
 * dependan solo de la lógica de crearMotorProceso, no de si el SO pudo hacer fork esta vez.
 *
 * Lo que este ejecutor de mentira NO puede detectar es un bug de plomería real (argumentos
 * mal armados, el guion de kokoro con un error de sintaxis) — eso lo cubren, aparte, las dos
 * pruebas de extremo a extremo más abajo, con un proceso real.
 */
function ejecutorFalso({ modo = 'ok', mensaje = 'fallo simulado del motor' } = {}) {
    let contador = 0;
    const ejecutar = (PY, args) => {
        contador++;
        if (modo === 'fallar') return { status: 1, stderr: mensaje };
        // Mismo convenio que usan piper.mjs y kokoro.mjs: el último argumento es la ruta de
        // destino del .wav. crearMotorProceso comprueba que ese archivo exista en disco.
        writeFileSync(args.at(-1), 'RIFFfake');
        return { status: 0, stderr: '' };
    };
    ejecutar.invocaciones = () => contador;
    return ejecutar;
}

/**
 * Como ejecutorFalso, pero falla la PRIMERA invocación y tiene éxito desde la segunda en
 * adelante: simula el fallo TRANSITORIO de fork/exec por contención de recursos que
 * sintetizar() (y, desde el arreglo acá, también la sonda de disponible()) ya resiste
 * reintentando una vez — pero sin pagar un proceso real para probarlo.
 */
function ejecutorTransitorio({ mensaje = 'recurso no disponible transitoriamente' } = {}) {
    let contador = 0;
    let yaFallo = false;
    const ejecutar = (PY, args) => {
        contador++;
        if (!yaFallo) {
            yaFallo = true;
            return { status: 1, stderr: mensaje };
        }
        writeFileSync(args.at(-1), 'RIFFfake');
        return { status: 0, stderr: '' };
    };
    ejecutar.invocaciones = () => contador;
    return ejecutar;
}

/** Solo necesita EXISTIR (archivosListos lo comprueba con existsSync): con ejecutarProceso
 * inyectado, nunca se llega a invocarlo de verdad, así que no hace falta que sea ejecutable. */
function venvConSoloArchivo() {
    const venv = mkdtempSync(join(tmpdir(), 'voz-venv-'));
    mkdirSync(join(venv, 'bin'), { recursive: true });
    writeFileSync(join(venv, 'bin', 'python'), '');
    return venv;
}

/**
 * Venv con un `bin/python` REAL y ejecutable (un script de bash), para las dos pruebas de
 * extremo a extremo que sí necesitan lanzar un proceso de verdad — ver más abajo por qué.
 */
function venvReal({ modo = 'ok', mensaje = 'fallo simulado del motor' } = {}) {
    const venv = mkdtempSync(join(tmpdir(), 'voz-venv-'));
    mkdirSync(join(venv, 'bin'), { recursive: true });
    const script = `#!/usr/bin/env bash
destino="\${@: -1}"
if [ "${modo}" = "fallar" ]; then
  echo "${mensaje}" >&2
  exit 1
fi
printf 'RIFFfake' > "$destino"
exit 0
`;
    const py = join(venv, 'bin', 'python');
    writeFileSync(py, script);
    chmodSync(py, 0o755);
    return venv;
}

function vocesPiperFalsas() {
    const voces = mkdtempSync(join(tmpdir(), 'voz-voces-'));
    writeFileSync(join(voces, 'x.onnx'), '');
    return voces;
}

function vocesKokoroFalsas() {
    const voces = mkdtempSync(join(tmpdir(), 'voz-voces-'));
    writeFileSync(join(voces, 'kokoro-v1.0.onnx'), '');
    writeFileSync(join(voces, 'voices-v1.0.bin'), '');
    return voces;
}

for (const [nombre, motor, vocesFalsas] of [['piper', piper, vocesPiperFalsas], ['kokoro', kokoro, vocesKokoroFalsas]]) {
    test(`${nombre}: disponible() sintetiza de verdad una vez y cachea el resultado`, () => {
        const venv = venvConSoloArchivo();
        const voces = vocesFalsas();
        const ejecutarProceso = ejecutorFalso({ modo: 'ok' });
        const instancia = motor.crear({ voz: 'x', venv, voces, ejecutarProceso });

        assert.equal(instancia.disponible(), true);
        assert.equal(instancia.disponible(), true);
        assert.equal(instancia.disponible(), true);

        assert.equal(ejecutarProceso.invocaciones(), 1,
            'la sonda de disponibilidad debe correr una sola vez, no en cada llamada a disponible()');
    });

    test(`${nombre}: la sonda de disponible() resiste un fallo transitorio, igual que sintetizar()`, () => {
        // Defecto real: el arreglo 26cec37 reintentó sintetizar() pero no comprobar(), que es
        // la sonda que decide disponible() Y CACHEA EL RESULTADO PARA SIEMPRE. Un solo fallo
        // transitorio de la sonda —el mismo tipo de fallo que sintetizar() ya resiste— caía
        // al respaldo (o apagaba la voz) para el resto de la corrida sin que el motor
        // estuviera roto de verdad.
        const venv = venvConSoloArchivo();
        const voces = vocesFalsas();
        const ejecutarProceso = ejecutorTransitorio();
        const instancia = motor.crear({ voz: 'x', venv, voces, ejecutarProceso });

        assert.equal(instancia.disponible(), true,
            'un solo fallo transitorio en la sonda no debe degradar el motor entero');
        assert.equal(ejecutarProceso.invocaciones(), 2,
            'debe haber reintentado la sonda una vez, igual que sintetizar()');
        assert.equal(instancia.disponible(), true);
        assert.equal(ejecutarProceso.invocaciones(), 2,
            'una vez cacheado el resultado, disponible() no debe volver a invocar nada');
    });

    test(`${nombre}: si la síntesis de prueba falla, el error concreto queda disponible (no un "no disponible" genérico)`, () => {
        const mensaje = 'no se pudo cargar el modelo: memoria insuficiente';
        const venv = venvConSoloArchivo();
        const voces = vocesFalsas();
        const ejecutarProceso = ejecutorFalso({ modo: 'fallar', mensaje });
        const instancia = motor.crear({ voz: 'x', venv, voces, ejecutarProceso });

        assert.equal(instancia.disponible(), false);
        assert.match(instancia.error(), /memoria insuficiente/);
    });

    test(`${nombre}: si el ejecutable o el modelo no existen, ni siquiera intenta invocar nada`, () => {
        const instancia = motor.crear({ voz: 'x', venv: '/no/existe-venv', voces: '/no/existe-voces' });
        assert.equal(instancia.disponible(), false);
        assert.match(instancia.error(), /no se encontró/);
    });

    test(`${nombre}: todas las locuciones de una corrida viven en el mismo directorio temporal`, () => {
        const venv = venvConSoloArchivo();
        const voces = vocesFalsas();
        const ejecutarProceso = ejecutorFalso({ modo: 'ok' });
        const instancia = motor.crear({ voz: 'x', venv, voces, ejecutarProceso });

        const a = instancia.sintetizar('primera frase');
        const b = instancia.sintetizar('segunda frase');

        assert.ok(a && b, 'ambas síntesis deben devolver una ruta');
        assert.equal(dirname(a), dirname(b), 'las locuciones de una misma corrida deben compartir directorio');
    });

    test(`${nombre}: limpiar() borra el directorio de la corrida, no antes de que se pida`, () => {
        const venv = venvConSoloArchivo();
        const voces = vocesFalsas();
        const ejecutarProceso = ejecutorFalso({ modo: 'ok' });
        const instancia = motor.crear({ voz: 'x', venv, voces, ejecutarProceso });

        const wav = instancia.sintetizar('una frase');
        assert.ok(existsSync(wav), 'el montaje reutiliza esta ruta: tiene que existir hasta que se pida limpiar');

        instancia.limpiar();
        assert.equal(existsSync(wav), false, 'tras limpiar(), el .wav ya no debe estar');
        assert.equal(existsSync(dirname(wav)), false, 'tras limpiar(), el directorio de la corrida ya no debe estar');
    });

    test(`${nombre}: una locución perdida avisa por stderr en vez de quedar muda en silencio`, () => {
        // El fallo silencioso es el patrón que ya costó un curso entero sin voz: si la
        // síntesis no sale, tiene que notarse en el momento, no al mirar el video terminado.
        const venv = venvConSoloArchivo();
        const voces = vocesFalsas();
        const ejecutarProceso = ejecutorFalso({ modo: 'fallar', mensaje: 'el motor explotó' });
        const instancia = motor.crear({ voz: 'x', venv, voces, ejecutarProceso });

        const avisos = [];
        const original = console.warn;
        console.warn = (m) => avisos.push(String(m));
        try {
            assert.equal(instancia.sintetizar('una frase que se va a perder'), null);
        } finally {
            console.warn = original;
        }

        assert.equal(avisos.length, 1, 'debe avisar exactamente una vez');
        assert.match(avisos[0], /locución perdida/);
        assert.match(avisos[0], /el motor explotó/, 'el aviso debe traer la causa concreta');
        assert.match(avisos[0], /una frase que se va a perder/, 'y qué texto se perdió');
    });

    // Extremo a extremo, con un proceso REAL (sin ejecutarProceso inyectado): lo único que
    // esta prueba necesita verificar es que `comando()` arma argumentos y plomería de stdin
    // que un intérprete real puede ejecutar — eso es justo lo que un ejecutor de mentira NO
    // puede detectar (un bug de argumentos, o el guion de kokoro con un error de sintaxis).
    // Es la única prueba de este archivo que paga un fork/exec real, y por eso la única con
    // una probabilidad remota (no medida por separado, pero acotada a esta única invocación
    // por motor) de fallar por contención transitoria del sistema operativo bajo carga.
    test(`${nombre}: crear() arma un comando real que un proceso de verdad puede ejecutar`, () => {
        const venv = venvReal({ modo: 'ok' });
        const voces = vocesFalsas();
        const instancia = motor.crear({ voz: 'x', venv, voces });

        assert.equal(instancia.disponible(), true, instancia.error());
        const wav = instancia.sintetizar('una frase de verdad');
        assert.ok(wav && existsSync(wav));
    });
}
