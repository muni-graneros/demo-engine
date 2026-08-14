import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class ErrorConfig extends Error {}

const DEFECTOS = {
    video: { ancho: 1600, alto: 1000, pausaMinima: 1200 },
    voz: { motor: 'kokoro', voz: 'ef_dora', respaldo: 'piper', venv: null, voces: null },
    marca: { color: '#1e3a8a', escudo: null },
    // `ocr` queda sin defecto a propósito: es el host al que el proceso se conecta, y eso
    // decide quien configura el sistema, no el motor (ver src/auditoria.mjs). `patron`,
    // `cada` y `maximo` sí tienen un valor razonable porque no comprometen a ningún host.
    auditoria: { ocr: null, patron: '\\d{7,8}-[\\dkK]', cada: 10, maximo: 20 },
    sembrar: null,
    limpiar: null,
};

function exigir(condicion, mensaje) {
    if (!condicion) throw new ErrorConfig(`demo.config.mjs: ${mensaje}`);
}

/**
 * Carga y valida el contrato del sistema consumidor.
 * @param {string} rutaProyecto carpeta que contiene demo.config.mjs
 * @returns {Promise<object>} configuración con los valores por defecto aplicados
 */
export async function cargarConfig(rutaProyecto) {
    const archivo = resolve(rutaProyecto, 'demo.config.mjs');
    exigir(existsSync(archivo), `no se encontró el archivo en ${rutaProyecto}`);

    const { default: cruda } = await import(pathToFileURL(archivo).href);
    exigir(cruda && typeof cruda === 'object', 'debe exportar por defecto un objeto');

    try {
        const url = new URL(cruda.baseURL);
        if (!url.protocol.match(/^https?:$/)) {
            throw new Error('protocolo inválido');
        }
    } catch {
        throw new ErrorConfig(`demo.config.mjs: baseURL debe ser una URL completa (recibí "${cruda.baseURL}")`);
    }

    exigir(cruda.marca?.nombre, 'marca.nombre es obligatorio (sale en las portadas)');

    const actores = cruda.actores ?? {};
    exigir(Object.keys(actores).length > 0, 'actores no puede estar vacío: sin actores no hay a quién grabar');
    for (const [nombre, datos] of Object.entries(actores)) {
        exigir(datos?.email, `el actor "${nombre}" no trae email`);
        exigir(datos?.password, `el actor "${nombre}" no trae password`);
    }

    const absoluta = (p) => (isAbsolute(p) ? p : resolve(rutaProyecto, p));
    const guiones = absoluta(cruda.guiones ?? './demo/guiones');
    exigir(existsSync(guiones), `la carpeta de guiones no existe: ${guiones}`);

    // voz.venv/voz.voces son opcionales: si no se declaran, el resolver del motor de voz
    // busca en DEMO_VENV/DEMO_VOCES y después en el directorio del propio paquete. Si SÍ se
    // declaran acá, son relativos a la raíz del proyecto (igual que `guiones`/`salida`).
    const voz = { ...DEFECTOS.voz, ...cruda.voz };
    if (voz.venv) voz.venv = absoluta(voz.venv);
    if (voz.voces) voz.voces = absoluta(voz.voces);

    // marca.escudo, igual que guiones/salida/voz.venv/voz.voces, es relativo a la RAÍZ DEL
    // PROYECTO, no al cwd del proceso: sin esto, `demo.config.mjs` con `escudo: './public/x.png'`
    // solo encontraba el archivo si el CLI se invocaba justo desde esa carpeta.
    const marca = { ...DEFECTOS.marca, ...cruda.marca };
    if (marca.escudo) marca.escudo = absoluta(marca.escudo);

    return {
        ...DEFECTOS,
        ...cruda,
        raiz: rutaProyecto,
        guiones,
        salida: absoluta(cruda.salida ?? './docs/manual'),
        marca,
        video: { ...DEFECTOS.video, ...cruda.video },
        auditoria: { ...DEFECTOS.auditoria, ...cruda.auditoria },
        voz,
        actores,
    };
}
