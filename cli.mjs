#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarConfig, ErrorConfig } from './src/configurar.mjs';
import { prepararSesiones, prepararSesionesParaGuion } from './src/sesiones.mjs';
import { grabar } from './src/grabador.mjs';
import { montar } from './src/montaje.mjs';
import { pegarCapitulos } from './src/curso.mjs';
import { generarManual } from './src/manual.mjs';
import { crearVoz } from './src/voz/index.mjs';
import { auditarVideo, auditarCapturas } from './src/auditoria.mjs';

const [orden, argumento] = process.argv.slice(2);
const raiz = process.cwd();

const cargarGuion = async (config, id) =>
    (await import(pathToFileURL(join(config.guiones, `${id}.mjs`)).href)).default;

/** Un guion maestro declara `capitulos` (para `demo curso`), no `escenas`. */
const esGuionMaestro = (guion) => Array.isArray(guion.capitulos) && !Array.isArray(guion.escenas);

/**
 * Junta los pasos que necesita `generarManual`, a partir de un guion normal o de uno maestro.
 *
 * Defecto real: `demo manual` sin argumento cargaba el guion maestro (`curso.mjs`, que
 * declara `capitulos`) y se lo pasaba tal cual a `grabar()`, que espera `escenas` — reventaba
 * (o no hacía nada útil) de forma confusa. Acá se detecta el caso maestro y se genera el
 * manual ENCADENADO de todos sus capítulos, en vez de fallar.
 */
async function pasosParaManual(config, guion, sesionesDe, voz) {
    if (!esGuionMaestro(guion)) {
        if (!Array.isArray(guion.escenas)) {
            throw new Error(`el guion "${guion.id}" no tiene "escenas" ni "capitulos": no se puede generar el manual`);
        }
        const { pasos } = await grabar(guion, { config, sesiones: await sesionesDe(guion), salida: config.salida, voz });
        return { id: guion.id, titulo: guion.titulo, pasos };
    }

    // Guion maestro: un capítulo `fuente: 'video'` es un archivo pregrabado, sin pasos
    // propios; entra como una nota en el manual en vez de desaparecer en silencio.
    const pasos = [];
    for (const cap of guion.capitulos) {
        if (cap.fuente === 'video') {
            pasos.push({ escena: cap.id, titulo: cap.titulo, actor: '', narrar: `(Ver video: ${cap.archivo})`, captura: null });
            continue;
        }
        const subguion = await cargarGuion(config, cap.guion);
        const { pasos: pasosCap } = await grabar(subguion,
            { config, sesiones: await sesionesDe(subguion), salida: config.salida, voz });
        // Prefijo del id de escena con el capítulo: dos guiones distintos pueden repetir un
        // mismo id de escena, y sin esto sus pasos se agruparían como si fueran la misma
        // sección del manual.
        for (const p of pasosCap) pasos.push({ ...p, escena: `${cap.id}-${p.escena}` });
    }
    return { id: guion.id, titulo: guion.titulo, pasos };
}

async function main() {
    const config = await cargarConfig(raiz);
    const voz = crearVoz(config.voz);
    try {
        return await ejecutarOrden(config, voz);
    } finally {
        // Un solo directorio temporal por CORRIDA (ver src/voz/proceso.mjs): recién acá,
        // al final de todo el proceso, es seguro borrarlo. El montaje reutiliza las rutas
        // de los .wav que generó el grabador, así que borrarlos antes le dejaría el video
        // sin voz a mitad de camino.
        voz.limpiar();
    }
}

/**
 * Limpia `capturas/` ANTES de empezar una corrida nueva (grabar/curso/manual), igual que ya
 * se hace con `.tmp`/`.tmp-curso`. Sin esto, una captura sin filtrar que dejó un guion
 * descuidado sobrevive indefinidamente en un directorio que termina incrustado en el manual
 * publicado. Se limpia UNA VEZ por corrida —no dentro de `grabar()`—, porque `demo manual`
 * sin argumento llama a `grabar()` una vez POR CAPÍTULO del guion maestro: limpiar ahí
 * borraría las capturas del capítulo anterior antes de que el manual combinado las use.
 */
function limpiarCapturas(config) {
    rmSync(join(config.salida, 'capturas'), { recursive: true, force: true });
}

async function ejecutarOrden(config, voz) {
    const dirSesiones = join(raiz, '.sesiones');
    // Sesiones para UN guion: reutiliza lo que ya haya en disco y solo loguea a los actores
    // que ese guion usa (no a todos los de la config). Grabar un guion de un solo actor no
    // debe releoguear a los otros tres, MFA incluido.
    const sesionesDe = (guion) => prepararSesionesParaGuion(guion, config, { dirSesiones });

    if (orden === 'preparar') {
        if (config.sembrar) execSync(config.sembrar, { stdio: 'inherit' });
        // Acá sí, TODOS los actores de la config: el trabajo de `preparar` es dejar lista la
        // sesión de todo el mundo de una vez, por adelantado.
        await prepararSesiones(config, { dirSesiones });
        return console.log('Sesiones listas.');
    }

    if (orden === 'grabar') {
        limpiarCapturas(config);
        // Sembrar antes de CADA grabación, no solo en `preparar`.
        //
        // Sin esto, la segunda corrida graba sobre lo que dejó la primera: casos
        // ya resueltos que no muestran sus botones, filas acumuladas de tomas
        // anteriores, y un guion que abre el registro equivocado porque el
        // primero que coincide es uno viejo. Cuesta horas de diagnosticar,
        // porque cada síntoma parece un selector roto y en realidad es el estado.
        if (config.sembrar) execSync(config.sembrar, { stdio: 'inherit' });
        const guion = await cargarGuion(config, argumento);
        const { pistas, pasos } = await grabar(guion, { config, sesiones: await sesionesDe(guion), salida: config.salida, voz });
        const { mp4 } = await montar({ pistas, pasos, voz, video: config.video },
            { salida: config.salida, nombre: `${guion.id}.mp4` });
        return console.log(mp4);
    }

    if (orden === 'curso') {
        limpiarCapturas(config);
        if (config.sembrar) execSync(config.sembrar, { stdio: 'inherit' });
        const maestro = await cargarGuion(config, 'curso');
        const partes = [];
        for (const cap of maestro.capitulos) {
            if (cap.fuente === 'video') {
                partes.push({ id: cap.id, titulo: cap.titulo, archivo: join(raiz, cap.archivo) });
                continue;
            }
            const guion = await cargarGuion(config, cap.guion);
            const { pistas, pasos } = await grabar(guion, { config, sesiones: await sesionesDe(guion), salida: config.salida, voz });
            const { mp4 } = await montar({ pistas, pasos, voz, video: config.video },
                { salida: config.salida, nombre: `${cap.id}.mp4` });
            partes.push({ id: cap.id, titulo: cap.titulo, archivo: mp4 });
        }
        const { mp4, md } = await pegarCapitulos(partes,
            { salida: config.salida, nombre: 'curso.mp4', titulo: maestro.titulo, video: config.video });
        return console.log(`${mp4}\n${md}`);
    }

    if (orden === 'manual') {
        limpiarCapturas(config);
        const guion = await cargarGuion(config, argumento ?? 'curso');
        const { id, titulo, pasos } = await pasosParaManual(config, guion, sesionesDe, voz);
        const { pdf } = await generarManual({ guion: { id, titulo }, pasos, marca: config.marca }, { salida: config.salida });
        return console.log(pdf);
    }

    if (orden === 'auditar') {
        if (!argumento) {
            console.log('Uso: demo auditar <guion|ruta-a-video.mp4>');
            process.exitCode = 1;
            return;
        }
        // Acepta tanto un guion ya grabado (busca su .mp4 en config.salida, como hacen
        // curso/manual) como una ruta directa a un video — útil para auditar algo que no
        // salió de este motor, o un archivo movido de lugar.
        const rutaDirecta = isAbsolute(argumento) ? argumento : resolve(raiz, argumento);
        const video = argumento.endsWith('.mp4') && existsSync(rutaDirecta)
            ? rutaDirecta
            : join(config.salida, `${argumento}.mp4`);
        if (!existsSync(video)) {
            throw new ErrorConfig(`no encontré el video a auditar: ${video} (¿ya corriste "demo grabar ${argumento}"?)`);
        }

        const { total, sospechosos } = await auditarVideo(video, config,
            { dirFrames: join(config.salida, 'auditoria', basename(video, extname(video))) });

        // El manual (demo manual) incrusta las MISMAS capturas que deja grabar() en
        // capturas/ dentro de config.salida: sin esto, demo auditar solo miraba el .mp4 y
        // esas imágenes quedaban completamente fuera del portero automático.
        const { total: totalCapturas, sospechosos: sospechososCapturas } =
            await auditarCapturas(join(config.salida, 'capturas'), config);

        for (const s of sospechosos) {
            console.log(`[SOSPECHOSO] segundo ${s.segundo}s — ${s.identificadores.length} identificadores distintos (${s.identificadores.join(', ')}) — frame guardado en: ${s.archivo}`);
        }
        for (const s of sospechososCapturas) {
            console.log(`[SOSPECHOSO CAPTURA] ${s.identificadores.length} identificadores distintos (${s.identificadores.join(', ')}) — imagen: ${s.archivo}`);
        }
        console.log(`\n${video}: ${sospechosos.length} de ${total} frames sospechosos.`);
        console.log(`${join(config.salida, 'capturas')}: ${sospechososCapturas.length} de ${totalCapturas} capturas sospechosas.`);

        if (sospechosos.length > 0 || sospechososCapturas.length > 0) process.exitCode = 1;
        return;
    }

    console.log('Uso: demo <preparar|grabar <guion>|curso|manual [guion]|auditar <guion|video>>');
    process.exitCode = 1;
}

main().catch((e) => {
    console.error(e instanceof ErrorConfig ? `\n${e.message}\n` : e);
    process.exitCode = 1;
});
