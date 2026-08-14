#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cargarConfig, ErrorConfig } from './src/configurar.mjs';
import { prepararSesiones, prepararSesionesParaGuion } from './src/sesiones.mjs';
import { grabar } from './src/grabador.mjs';
import { montar } from './src/montaje.mjs';
import { pegarCapitulos } from './src/curso.mjs';
import { generarManual } from './src/manual.mjs';
import { crearVoz } from './src/voz/index.mjs';

const [orden, argumento] = process.argv.slice(2);
const raiz = process.cwd();

const cargarGuion = async (config, id) =>
    (await import(pathToFileURL(join(config.guiones, `${id}.mjs`)).href)).default;

async function main() {
    const config = await cargarConfig(raiz);
    const voz = crearVoz(config.voz);
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
        const guion = await cargarGuion(config, argumento);
        const { pistas, pasos } = await grabar(guion, { config, sesiones: await sesionesDe(guion), salida: config.salida, voz });
        const { mp4 } = await montar({ pistas, pasos, voz, video: config.video },
            { salida: config.salida, nombre: `${guion.id}.mp4` });
        return console.log(mp4);
    }

    if (orden === 'curso') {
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
        const guion = await cargarGuion(config, argumento ?? 'curso');
        const { pasos } = await grabar(guion, { config, sesiones: await sesionesDe(guion), salida: config.salida, voz });
        const { pdf } = await generarManual({ guion, pasos, marca: config.marca }, { salida: config.salida });
        return console.log(pdf);
    }

    console.log('Uso: demo <preparar|grabar <guion>|curso|manual [guion]>');
    process.exitCode = 1;
}

main().catch((e) => {
    console.error(e instanceof ErrorConfig ? `\n${e.message}\n` : e);
    process.exitCode = 1;
});
