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
        if (r.error) {
            // `r.error` no es necesariamente "el proceso no arrancó": bajo carga, el hijo
            // puede cerrar su stdin antes de que Node termine de escribirle el texto (visto
            // de verdad como EPIPE), y en ese caso el proceso SÍ corrió y dejó un stderr real
            // con la causa concreta. Descartarlo y reportar solo el mensaje genérico de Node
            // socava el propio motivo de este aviso: perder la causa real del fallo.
            const detalle = (r.stderr || '').trim();
            return { ok: false, error: detalle ? `${r.error.message}: ${detalle}` : r.error.message };
        }
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
            // Esto SÍ es "no está instalado": faltan archivos en disco, ni se intentó correr
            // nada. Se distingue de un fallo al arrancar (ver más abajo) porque el remedio es
            // distinto: acá corresponde instalar; abajo, no.
            comprobado = { ok: false, error: faltante, motivo: 'no-instalado' };
            return comprobado;
        }

        // La sonda corre UNA SOLA VEZ y el resultado se cachea PARA SIEMPRE (ver arriba):
        // justo por eso no puede tener menos resistencia a fallos transitorios que
        // sintetizar(), que sí reintenta. Sin este reintento, un solo fork/exec fallido por
        // contención de recursos —el mismo escenario que motivó el reintento en sintetizar()—
        // manda el motor entero al respaldo (o lo apaga del todo) para el resto de la corrida,
        // sin que el motor esté roto de verdad.
        let r = ejecutar(textoSonda);
        if (!r.ok) r = ejecutar(textoSonda);
        // Esto es "está instalado pero falló al arrancar": los archivos existían, se intentó
        // correr de verdad y no funcionó. Confundirlo con "no instalado" manda a alguien a
        // reinstalar algo que no estaba roto.
        comprobado = r.ok ? { ok: true, error: null, motivo: null } : { ok: false, error: r.error, motivo: 'fallo-arranque' };
        return comprobado;
    }

    return {
        motor,
        disponible: () => comprobar().ok,
        error: () => comprobado?.error ?? null,
        /** 'no-instalado' | 'fallo-arranque' | null (disponible, o aún no comprobado). */
        motivo: () => comprobado?.motivo ?? null,
        sintetizar(texto) {
            // Lanzar el proceso puede fallar por causas TRANSITORIAS: durante una grabación
            // compiten varios navegadores y ffmpeg por la máquina, y ahí `fork/exec` devuelve
            // error de recursos aunque el motor esté perfectamente instalado. Medido: bajo esa
            // carga la síntesis falla ~1 de cada 3 corridas. Por eso se reintenta una vez.
            let r = ejecutar(texto);
            if (!r.ok) r = ejecutar(texto);
            if (r.ok) return r.ruta;

            // Y si aun así falla, NO se calla. Devolver null en silencio deja ese paso mudo en
            // el video sin que nadie se entere — el mismo fallo silencioso que ya costó grabar
            // un curso entero sin voz.
            console.warn(`[demo-engine] locución perdida (${motor}): ${r.error}\n` +
                `  texto: «${texto.slice(0, 60)}${texto.length > 60 ? '…' : ''}»`);
            return null;
        },
        limpiar() {
            if (dirCorrida) rmSync(dirCorrida, { recursive: true, force: true });
            dirCorrida = null;
        },
    };
}
