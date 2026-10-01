#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cargarConfig, ErrorConfig } from './src/configurar.mjs';
import { prepararSesiones, prepararSesionesParaGuion } from './src/sesiones.mjs';
import { grabar } from './src/grabador.mjs';
import { montar } from './src/montaje.mjs';
import { pegarCapitulos } from './src/curso.mjs';
import { generarManual } from './src/manual.mjs';
import { capturarContexto } from './src/contexto.mjs';
import { crearVoz } from './src/voz/index.mjs';
import { auditarVideo, auditarCapturas } from './src/auditoria.mjs';
import { listaEnmascarada } from './src/privacidad.mjs';
import { ff, duracion, RUTA_FFMPEG } from './src/ffmpeg.mjs';
import { renderizarMapa, opcionesDelMapa } from './src/mapa-superficies.mjs';
import { renderizarLienzo } from './src/lienzo.mjs';
import { componerEnLienzo, lienzoDe } from './src/composicion.mjs';
import { cadenaDeMezcla } from './src/mezcla.mjs';
import { generarVtt } from './src/subtitulos.mjs';
import { variante } from './src/formatos.mjs';
import { sembrar } from './src/sembrar.mjs';
import { capitulosDe, vivo } from './src/vivo/index.mjs';

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
        // El capítulo mapa no tiene guion que grabar: entra al manual con su narración.
        if (cap.tipo === 'mapa') {
            pasos.push({ escena: cap.id, titulo: cap.titulo, actor: '', narrar: cap.narrar ?? '', captura: null });
            continue;
        }
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

/** Lo que `grabar()` devuelve y `montar()` necesita, más lo que la config aporta. */
async function grabarYMontar(config, voz, sesionesDe, guion, nombre) {
    const { pistas, pasos, origenes, clics, dimensiones } = await grabar(guion,
        { config, sesiones: await sesionesDe(guion), salida: config.salida, voz });
    const { mp4 } = await montar({
        pistas, pasos, voz, video: config.video,
        presentacion: config.video.presentacion, marca: config.marca, baseURL: config.baseURL,
        superficies: config.superficies, actores: config.actores,
        origenes, clics, dimensiones, audio: config.audio,
    }, { salida: config.salida, nombre });
    return { mp4, pasos };
}

/**
 * Ancho, alto y si trae audio, leídos del propio archivo (el binario estático no trae ffprobe).
 *
 * Las dimensiones son las que se VEN, no las guardadas: scrcpy y los teléfonos graban a veces
 * apaisado con una matriz de rotación (`displaymatrix: rotation of 90 degrees`), y ffmpeg
 * endereza el cuadro al decodificar. Con ±90° se intercambian ancho y alto; si no, un clip
 * vertical se compondría en un hueco apaisado, achicado entre bandas negras.
 */
function sondear(archivo) {
    const info = spawnSync(RUTA_FFMPEG, ['-i', archivo], { encoding: 'utf8' }).stderr ?? '';
    const m = info.match(/Stream #.*Video:.*?(\d{2,5})x(\d{2,5})(?=[\s,])/);
    if (!m) throw new ErrorConfig(`no pude leer las dimensiones del video ${archivo}`);
    const giro = Number(info.match(/displaymatrix: rotation of (-?[\d.]+) degrees/)?.[1]
        ?? info.match(/^\s*rotate\s*:\s*(-?\d+)/m)?.[1] ?? 0);
    const vertical = Math.abs(Math.round(giro / 90)) % 2 === 1;
    return { ancho: vertical ? +m[2] : +m[1], alto: vertical ? +m[1] : +m[2], audio: /Stream #.*Audio:/.test(info) };
}

/**
 * La superficie que declara un capítulo, validada contra la config. Un capítulo con
 * `superficie` en un proyecto sin `superficies` es un error de configuración, no algo que
 * ignorar: el autor pidió una tarjeta y un marco, y un curso que sale sin ellos en silencio
 * se descubre recién al mirarlo entero.
 */
function superficieDeCapitulo(config, cap) {
    if (!cap.superficie) return null;
    if (!config.superficies) {
        throw new ErrorConfig(`el capítulo "${cap.id}" declara superficie "${cap.superficie}", pero demo.config.mjs no declara superficies`);
    }
    const s = config.superficies[cap.superficie];
    if (!s) throw new ErrorConfig(`el capítulo "${cap.id}" usa la superficie "${cap.superficie}", que no está en superficies`);
    return s;
}

/**
 * Capítulo `tipo: 'mapa'`: la tarjeta de superficies a pantalla completa, sin resaltar, con su
 * locución. Dura `max(ms, voz + 600 ms)`: la tarjeta no puede cortar la frase a la mitad, y
 * los 600 ms de aire evitan que la voz termine pegada al corte al capítulo siguiente.
 * Deja su .vtt al lado, como `montar()`, para que el curso lo combine con los demás.
 */
async function capituloMapa(config, voz, cap, { lienzo, temporal }) {
    if (!config.superficies) {
        throw new ErrorConfig(`el capítulo "${cap.id}" es de tipo mapa, pero demo.config.mjs no declara superficies`);
    }
    const wav = cap.narrar && voz.disponible() ? voz.sintetizar(cap.narrar) : null;
    const segundos = Math.max((cap.ms ?? 6000) / 1000, wav ? duracion(wav) + 0.6 : 0);
    const mudo = await renderizarMapa({
        ...opcionesDelMapa(config), activa: null, anterior: null,
        lienzo, ms: Math.round(segundos * 1000), salida: temporal, nombre: `mapa-${cap.id}.mp4`,
    });
    const total = duracion(mudo);
    const mezcla = cadenaDeMezcla({
        total, locuciones: wav ? [{ wav, inicioSeg: 0 }] : [],
        musica: config.audio?.musica ?? null, clics: [], clic: { activo: false },
    });
    mkdirSync(config.salida, { recursive: true });
    const mp4 = join(config.salida, `${cap.id}.mp4`);
    ff(['-y', '-i', mudo, ...mezcla.entradas, '-filter_complex', mezcla.filtro,
        '-map', '0:v', '-map', mezcla.salida, '-c:v', 'copy', '-c:a', 'aac', mp4]);
    const vtt = mp4.replace(/\.mp4$/, '.vtt');
    // Sin narración no hay .vtt: un archivo viejo de otra corrida pondría subtítulos que ya
    // no se dicen.
    rmSync(vtt, { force: true });
    if (cap.narrar) writeFileSync(vtt, generarVtt([{ inicioSeg: 0, finSeg: total, narrar: cap.narrar }]));
    return mp4;
}

/**
 * Video nativo (`fuente: 'video'`, un clip de `scrcpy`) con superficie: se compone en el
 * lienzo con el marco y el chip de su superficie, para que entre indistinguible de lo grabado
 * en Chromium (regla 5). El aspecto se mide del propio archivo: el emulador no siempre graba
 * al tamaño que uno cree. El audio del clip se conserva (componerEnLienzo sale mudo); si no
 * trae, se pone silencio, porque el concat del curso exige los mismos streams en cada trozo.
 */
async function videoEnLienzo(config, cap, superficie, archivo, { lienzo, temporal }) {
    const { ancho, alto, audio } = sondear(archivo);
    const dura = duracion(archivo);
    const panel = {
        tipo: superficie.tipo === 'telefono' ? 'telefono' : 'ventana',
        aspecto: ancho / alto,
        chip: { nombre: superficie.nombre, icono: superficie.icono, color: superficie.color },
        url: config.video.presentacion?.url ?? config.baseURL,
    };
    const { png, huecos } = await renderizarLienzo({ lienzo, paneles: [panel], marca: config.marca, salida: temporal, nombre: `lienzo-${cap.id}.png` });
    const compuesto = componerEnLienzo([{ mp4: archivo, desdeSeg: 0, hastaSeg: dura }],
        { png, huecos, lienzo, salida: join(temporal, `video-${cap.id}-mudo.mp4`), duracion: dura });
    const destino = join(temporal, `video-${cap.id}.mp4`);
    const fuenteAudio = audio ? ['-i', archivo] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
    ff(['-y', '-i', compuesto, ...fuenteAudio, '-map', '0:v', '-map', '1:a', '-t', String(dura),
        '-c:v', 'copy', '-c:a', 'aac', '-ar', '48000', '-ac', '2', destino]);
    return destino;
}

/**
 * Graba un curso maestro en UNA sola pasada: monta cada capítulo (video) y, de paso, junta los
 * pasos de todos para poder generar el manual sin re-grabar. Devuelve `{ mp4, md, maestro, pasos }`.
 *
 * Con superficies, cada capítulo que declare `superficie` lleva antes su tarjeta «usted está
 * aquí» (la superficie activa resaltada, la del capítulo previo que declaró una atenuada con
 * la flecha del traspaso). La tarjeta viaja como `tarjeta` de la parte y `pegarCapitulos` la
 * cuenta dentro del capítulo que entra, igual que la transición 3D.
 */
async function grabarCurso(config, voz, sesionesDe, idCurso) {
    const maestro = await cargarGuion(config, idCurso);
    // Todo el maestro se valida ANTES de grabar nada: un error de config en el último
    // capítulo, descubierto recién al llegar a él, tiraba a la basura la grabación de todos
    // los anteriores.
    for (const cap of maestro.capitulos) {
        if (cap.tipo === 'mapa' && !config.superficies) {
            throw new ErrorConfig(`el capítulo "${cap.id}" es de tipo mapa, pero demo.config.mjs no declara superficies`);
        }
        superficieDeCapitulo(config, cap);
        if (cap.fuente === 'video' && !existsSync(join(raiz, cap.archivo))) {
            throw new ErrorConfig(`el capítulo "${cap.id}" apunta a un video que no existe: ${join(raiz, cap.archivo)}`);
        }
    }
    limpiarCapturas(config);
    await sembrar(config);
    const presentacion = config.video.presentacion;
    const lienzo = lienzoDe({ presentacion, video: config.video });
    // Tarjetas y compuestos viven hasta que el curso está pegado: `.tmp-curso` no sirve,
    // porque `pegarCapitulos` lo vacía al empezar.
    const temporal = join(config.salida, '.tmp-superficies');
    rmSync(temporal, { recursive: true, force: true });
    mkdirSync(temporal, { recursive: true });
    const partes = [];
    const pasos = [];
    let superficiePrevia = null;
    try {
        for (const cap of maestro.capitulos) {
            const ctx = { lienzo, temporal };
            if (cap.tipo === 'mapa') {
                partes.push({ id: cap.id, titulo: cap.titulo, archivo: await capituloMapa(config, voz, cap, ctx) });
                pasos.push({ escena: cap.id, titulo: cap.titulo, actor: '', narrar: cap.narrar ?? '', captura: null });
                continue;
            }
            const superficie = superficieDeCapitulo(config, cap);
            let tarjeta = null;
            if (superficie) {
                tarjeta = await renderizarMapa({
                    ...opcionesDelMapa(config),
                    activa: cap.superficie, anterior: superficiePrevia,
                    lienzo, ms: presentacion?.mapaMs ?? 2500,
                    salida: temporal, nombre: `tarjeta-${cap.id}.mp4`,
                });
                superficiePrevia = cap.superficie;
            }
            if (cap.fuente === 'video') {
                const original = join(raiz, cap.archivo);
                if (!existsSync(original)) throw new ErrorConfig(`el capítulo "${cap.id}" apunta a un video que no existe: ${original}`);
                const archivo = superficie ? await videoEnLienzo(config, cap, superficie, original, ctx) : original;
                partes.push({ id: cap.id, titulo: cap.titulo, archivo, tarjeta });
                pasos.push({ escena: cap.id, titulo: cap.titulo, actor: '', narrar: `(Ver video: ${cap.archivo})`, captura: null });
                continue;
            }
            const guion = await cargarGuion(config, cap.guion);
            const { mp4, pasos: pasosCap } = await grabarYMontar(config, voz, sesionesDe, guion, `${cap.id}.mp4`);
            partes.push({ id: cap.id, titulo: cap.titulo, archivo: mp4, tarjeta });
            for (const p of pasosCap) pasos.push({ ...p, escena: `${cap.id}-${p.escena}` });
        }
        const { mp4, md } = await pegarCapitulos(partes,
            { salida: config.salida, nombre: `${idCurso}.mp4`, titulo: maestro.titulo, video: config.video,
                presentacion, marca: config.marca });
        return { mp4, md, maestro, pasos };
    } finally {
        rmSync(temporal, { recursive: true, force: true });
    }
}

/**
 * `demo formatos <video.mp4> [--vertical] [--cuadrado]`: variantes para redes, escritas al
 * lado del video. Sin banderas, las dos. No carga demo.config.mjs: es un post-proceso de un
 * archivo ya montado, y exigir un proyecto impediría usarlo sobre un mp4 suelto.
 */
function ejecutarFormatos(args) {
    const USO = 'Uso: demo formatos <video.mp4> [--vertical] [--cuadrado]';
    const posicionales = args.filter((a) => !a.startsWith('--'));
    const archivo = posicionales[0];
    const desconocidas = args.filter((a) => a.startsWith('--') && !['--vertical', '--cuadrado'].includes(a));
    // Un solo video por llamada: dos posicionales son casi siempre un error de tipeo, y
    // procesar el primero en silencio lo escondería.
    if (posicionales.length !== 1 || desconocidas.length) {
        console.log(desconocidas.length ? `Bandera desconocida: ${desconocidas.join(' ')}\n${USO}` : USO);
        process.exitCode = 1;
        return;
    }
    const video = resolve(raiz, archivo);
    if (!existsSync(video)) throw new ErrorConfig(`no encontré el video: ${video}`);
    const pedidos = ['vertical', 'cuadrado'].filter((f) => args.includes(`--${f}`));
    for (const formato of pedidos.length ? pedidos : ['vertical', 'cuadrado']) {
        console.log(variante(video, { formato, salida: dirname(video) }));
    }
}

/**
 * `demo init`: copia el andamiaje (demo.config.mjs + demo/guiones/ de ejemplo + guía) al
 * directorio actual, SIN pisar lo que ya exista. Deja un sistema nuevo listo para editar.
 */
function ejecutarInit() {
    const origen = fileURLToPath(new URL('./plantillas', import.meta.url));
    let creados = 0;
    let saltados = 0;
    const copiar = (src, dst) => {
        for (const entrada of readdirSync(src, { withFileTypes: true })) {
            const s = join(src, entrada.name);
            const d = join(dst, entrada.name);
            if (entrada.isDirectory()) {
                mkdirSync(d, { recursive: true });
                copiar(s, d);
                continue;
            }
            if (existsSync(d)) {
                console.log(`  · ya existe, no se toca: ${relative(raiz, d)}`);
                saltados++;
                continue;
            }
            mkdirSync(dirname(d), { recursive: true });
            copyFileSync(s, d);
            console.log(`  + ${relative(raiz, d)}`);
            creados++;
        }
    };
    console.log(`demo init — andamiaje en ${raiz}`);
    copiar(origen, raiz);
    console.log(`\n${creados} archivo(s) creado(s), ${saltados} conservado(s).`);
    console.log('Siguiente: edita demo.config.mjs y lee demo/CONTEXTO-Y-SEEDER.md; luego `demo preparar` y `demo todo`.');
}

/**
 * `demo vivo [maestro|guion] [--desde=ID] [--capitulos=ID,ID] [--auto] [--headless]
 *            [--puerto=N] [--permitir-host=HOST] [--velocidad=X] [--sin-teclado]`
 *
 * Presenta los guiones en vivo, en ventanas reales de Chromium, paso a paso desde la consola
 * del presentador (src/vivo/). Sin argumento usa el maestro `curso`.
 */
async function ejecutarVivo(config, args) {
    const USO = 'Uso: demo vivo [maestro|guion] [--desde=ID] [--capitulos=ID,ID,…] [--auto] [--headless] '
        + '[--puerto=N] [--permitir-host=HOST] [--velocidad=X] [--sin-teclado]';
    const banderas = {};
    const posicionales = [];
    for (const a of args) {
        const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
        if (m) banderas[m[1]] = m[2] ?? true;
        else posicionales.push(a);
    }
    const conocidas = ['desde', 'capitulos', 'auto', 'headless', 'puerto', 'permitir-host', 'velocidad', 'sin-teclado'];
    const desconocidas = Object.keys(banderas).filter((b) => !conocidas.includes(b));
    if (desconocidas.length || posicionales.length > 1) {
        console.log(desconocidas.length ? `Bandera desconocida: --${desconocidas.join(' --')}\n${USO}` : USO);
        process.exitCode = 1;
        return;
    }
    const id = posicionales[0] ?? 'curso';
    const archivo = join(config.guiones, `${id}.mjs`);
    if (!existsSync(archivo)) throw new ErrorConfig(`no encontré el guion o maestro "${id}" (${archivo})`);
    let capitulos = capitulosDe(await import(pathToFileURL(archivo).href), id);
    if (typeof banderas.capitulos === 'string') {
        const pedidos = banderas.capitulos.split(',').map((x) => x.trim()).filter(Boolean);
        const faltan = pedidos.filter((p) => !capitulos.some((c) => String(c.id) === p));
        if (faltan.length) throw new ErrorConfig(`--capitulos: no existen ${faltan.join(', ')} en "${id}"`);
        capitulos = pedidos.map((p) => capitulos.find((c) => String(c.id) === p));
    }
    if (banderas.velocidad !== undefined) {
        const v = Number(banderas.velocidad);
        if (!(v > 0)) throw new ErrorConfig('--velocidad debe ser un número mayor que cero (0.8 = más lento)');
        config.vivo = { ...config.vivo, velocidad: v };
    }
    const puerto = banderas.puerto !== undefined ? Number(banderas.puerto) : config.vivo.puerto;
    // Ctrl+C (sin TTY) o un SIGTERM: se pide «salir», que se atiende en el próximo punto de
    // espera y cierra navegador y consola en orden; si un paso no suelta, se corta a los 5 s.
    let controlVivo = null;
    const alSenal = () => {
        if (!controlVivo) process.exit(130);
        controlVivo.orden({ tipo: 'salir' });
        setTimeout(() => process.exit(130), 5000).unref();
    };
    process.once('SIGINT', alSenal);
    process.once('SIGTERM', alSenal);
    await vivo({
        alListo: ({ control }) => { controlVivo = control; },
        config, capitulos, desde: typeof banderas.desde === 'string' ? banderas.desde : null,
        headless: Boolean(banderas.headless), auto: Boolean(banderas.auto), puerto,
        teclado: !banderas['sin-teclado'],
        permitirHosts: typeof banderas['permitir-host'] === 'string' ? banderas['permitir-host'].split(',') : [],
        dirSesiones: join(raiz, '.sesiones'),
    });
}

async function main() {
    // `init` corre ANTES de cargar la config: justamente sirve para crearla.
    if (orden === 'init') {
        return ejecutarInit();
    }
    if (orden === 'formatos') {
        return ejecutarFormatos(process.argv.slice(3));
    }
    const config = await cargarConfig(raiz);
    // La demo en vivo no sintetiza voz (narra el presentador): no se crea el motor de voz,
    // que además avisaría por stderr de modelos que acá no hacen falta.
    if (orden === 'vivo') {
        return ejecutarVivo(config, process.argv.slice(3));
    }
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
        await sembrar(config);
        // Acá sí, TODOS los actores de la config: el trabajo de `preparar` es dejar lista la
        // sesión de todo el mundo de una vez, por adelantado.
        await prepararSesiones(config, { dirSesiones });
        return console.log('Sesiones listas.');
    }

    if (orden === 'contexto') {
        // Pack de contexto: un screenshot por pantalla declarada en `config.contexto.pantallas`.
        // El aislamiento de PII se corre por fuera (`aislar`/`mostrar`), y `mostrar` va en
        // `finally` para restaurar los datos reales aunque la captura falle a la mitad.
        const salida = resolve(raiz, config.contexto?.salida ?? './demo/contexto');
        if (config.contexto?.aislar) execSync(config.contexto.aislar, { stdio: 'inherit' });
        try {
            const sesiones = await prepararSesiones(config, { dirSesiones });
            const { ok, fail } = await capturarContexto({ config, sesiones, salida });
            console.log(`contexto: ${ok} capturadas, ${fail} fallidas → ${salida}`);
        } finally {
            if (config.contexto?.mostrar) execSync(config.contexto.mostrar, { stdio: 'inherit' });
        }
        return;
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
        await sembrar(config);
        // Mismo cableado que el curso (superficies, dividir, clics, audio); la tarjeta de
        // superficies no: es la entrada a un capítulo, y un guion suelto no tiene capítulos.
        const guion = await cargarGuion(config, argumento);
        const { mp4 } = await grabarYMontar(config, voz, sesionesDe, guion, `${guion.id}.mp4`);
        return console.log(mp4);
    }

    if (orden === 'curso') {
        const { mp4, md } = await grabarCurso(config, voz, sesionesDe, argumento ?? 'curso');
        return console.log(`${mp4}\n${md}`);
    }

    if (orden === 'todo') {
        // Pipeline COMPLETO para cualquier sistema, en un comando: pack de contexto + curso
        // (video) + manual (PDF), con la PII aislada durante todo el proceso.
        //
        // Requisitos del sistema (en demo.config.mjs): `contexto` (pantallas + aislar/mostrar)
        // y un guion maestro de curso (`<id>.mjs` con `capitulos`). Lo específico —el seeder
        // determinista y los guiones— se escribe una vez siguiendo la skill `mapa-funcional`.
        const idCurso = argumento ?? 'curso';
        const salidaCtx = resolve(raiz, config.contexto?.salida ?? './demo/contexto');
        if (config.contexto?.aislar) execSync(config.contexto.aislar, { stdio: 'inherit' });
        try {
            let pack = { ok: 0, fail: 0 };
            if (config.contexto?.pantallas?.length) {
                const sesiones = await prepararSesiones(config, { dirSesiones });
                pack = await capturarContexto({ config, sesiones, salida: salidaCtx });
            }
            const { mp4, md, maestro, pasos } = await grabarCurso(config, voz, sesionesDe, idCurso);
            const { pdf } = await generarManual(
                { guion: { id: maestro.id ?? idCurso, titulo: maestro.titulo }, pasos, marca: config.marca },
                { salida: config.salida });
            console.log(`\n== demo todo ==\n`
                + ` contexto : ${pack.ok} pantallas → ${salidaCtx}\n`
                + ` curso    : ${mp4}\n`
                + ` índice   : ${md}\n`
                + ` manual   : ${pdf}`);
        } finally {
            if (config.contexto?.mostrar) execSync(config.contexto.mostrar, { stdio: 'inherit' });
        }
        return;
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
            console.log(`[SOSPECHOSO] segundo ${s.segundo}s — ${s.identificadores.length} identificadores distintos (${listaEnmascarada(s.identificadores)}) — frame guardado en: ${s.archivo}`);
        }
        for (const s of sospechososCapturas) {
            console.log(`[SOSPECHOSO CAPTURA] ${s.identificadores.length} identificadores distintos (${listaEnmascarada(s.identificadores)}) — imagen: ${s.archivo}`);
        }
        console.log(`\n${video}: ${sospechosos.length} de ${total} frames sospechosos.`);
        console.log(`${join(config.salida, 'capturas')}: ${sospechososCapturas.length} de ${totalCapturas} capturas sospechosas.`);

        if (sospechosos.length > 0 || sospechososCapturas.length > 0) process.exitCode = 1;
        return;
    }

    console.log('Uso: demo <init|preparar|grabar <guion>|curso [maestro]|manual [guion]|contexto|todo [maestro]|auditar <guion|video>|formatos <video> [--vertical] [--cuadrado]|vivo [maestro|guion] [--desde=ID] [--auto] [--headless]>');
    process.exitCode = 1;
}

main().catch((e) => {
    console.error(e instanceof ErrorConfig ? `\n${e.message}\n` : e);
    process.exitCode = 1;
});
