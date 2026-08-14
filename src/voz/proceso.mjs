import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Ciclo de vida común a los motores de voz que invocan un intérprete de Python por
 * subproceso (piper, kokoro). Resuelve tres defectos que compartían los dos:
 *
 * 1. Un directorio temporal por FRASE, nunca borrado: un curso de cinco capítulos dejaba
 *    decenas de directorios sueltos en /tmp. Acá hay UN directorio por corrida (se crea al
 *    primer uso), y `limpiar()` lo borra entero cuando quien orquesta decide que ya nadie
 *    va a releer esos .wav (el montaje los reutiliza, así que no se puede borrar antes).
 *
 * 2. `disponible()` solo miraba si los archivos estaban en disco, no si la síntesis
 *    FUNCIONABA. Acá hace una síntesis real de una frase de sonda la primera vez que se
 *    pregunta, y cachea el resultado: preguntarlo nunca sale gratis si hay que sintetizar
 *    para responder, pero se pregunta una vez por paso narrado en un guion largo, así que
 *    pagarlo cada vez sería carísimo.
 *
 * 3. Cuando la síntesis fallaba, el aviso corriente ("no disponible") no decía por qué.
 *    Acá `error()` guarda el mensaje concreto (stderr del proceso, o la causa de que ni se
 *    intentó) para que el aviso por stderr en `voz/index.mjs` lo pueda mostrar.
 */
export function crearMotorProceso({ motor, archivosListos, comando, textoSonda = 'Prueba de disponibilidad del motor de voz.' }) {
    let dirCorrida = null;
    let contador = 0;
    let comprobado = null;

    function ejecutar(texto) {
        if (!dirCorrida) dirCorrida = mkdtempSync(join(tmpdir(), 'voz-'));
        const destino = join(dirCorrida, `locucion-${contador++}.wav`);
        const { PY, args } = comando(destino);
        const r = spawnSync(PY, args, { input: texto, encoding: 'utf8' });
        if (r.error) return { ok: false, error: r.error.message };
        if (r.status !== 0) {
            const detalle = (r.stderr || '').trim();
            return { ok: false, error: detalle || `${motor} terminó con código de salida ${r.status}` };
        }
        if (!existsSync(destino)) return { ok: false, error: `${motor} no escribió el archivo de salida esperado` };
        return { ok: true, ruta: destino };
    }

    function comprobar() {
        if (comprobado) return comprobado;
        const faltante = archivosListos();
        if (faltante) {
            comprobado = { ok: false, error: faltante };
            return comprobado;
        }
        const r = ejecutar(textoSonda);
        comprobado = r.ok ? { ok: true, error: null } : { ok: false, error: r.error };
        return comprobado;
    }

    return {
        motor,
        disponible: () => comprobar().ok,
        error: () => comprobado?.error ?? null,
        sintetizar(texto) {
            const r = ejecutar(texto);
            return r.ok ? r.ruta : null;
        },
        limpiar() {
            if (dirCorrida) rmSync(dirCorrida, { recursive: true, force: true });
            dirCorrida = null;
        },
    };
}
