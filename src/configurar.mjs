import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class ErrorConfig extends Error {}

const DEFECTOS = {
    // `calidad` es la calidad JPEG (0-100) del screencast interno; a mayor calidad, texto
    // más nítido y archivo más pesado. `fps` es el ritmo constante al que se reconstruye el
    // video (ver src/pantalla.mjs) — no tiene por qué coincidir con el fps real del
    // screencast, que es variable.
    // Ritmo ÁGIL por defecto, y es una decisión medida, no una preferencia.
    //
    // Los valores viejos (pausaMinima 1200, msCursor 550) venían de cuando cada
    // paso esperaba la locución entera DESPUÉS de actuar: hacían falta para que
    // se alcanzara a leer la pantalla. Desde que la voz suena sobre la acción y
    // la síntesis salió del video, esos mismos números solo agregan huecos. En el
    // tutorial donde se midió, el video pasó de 7:28 a 3:13 con el mismo
    // contenido: más de la mitad eran pausas muertas.
    //
    // Un tutorial que quiera ir más pausado sube estos dos en su config; lo que
    // no debería pasar es que un proyecto nuevo herede el ritmo lento sin
    // haberlo elegido.
    video: { ancho: 1600, alto: 1000, pausaMinima: 350, calidad: 90, fps: 25, msCursor: 260, presentacion: null },
    // `voz` y `vozRespaldo` son campos separados porque Kokoro y Piper nombran sus voces
    // distinto (ver el comentario de `crearVoz` en src/voz/index.mjs). Si `vozRespaldo`
    // queda en null, el respaldo usa su propio valor por defecto, no el del motor principal.
    // `velocidad` multiplica el ritmo de la locución y por defecto va por encima
    // de 1: a velocidad natural una locución de tutorial se siente arrastrada,
    // porque quien mira YA está viendo en pantalla lo que se le cuenta. Sube al
    // defecto de la config y no queda fija en cada motor para que cambiar de
    // Kokoro a Piper no cambie la cadencia del video.
    voz: { motor: 'kokoro', voz: 'ef_dora', respaldo: 'piper', vozRespaldo: null, venv: null, voces: null, velocidad: 1.25 },
    marca: { color: '#1e3a8a', escudo: null },
    // `ocr` queda sin defecto a propósito: es el host al que el proceso se conecta, y eso
    // decide quien configura el sistema, no el motor (ver src/auditoria.mjs). `patron`,
    // `cada` y `maximo` sí tienen un valor razonable porque no comprometen a ningún host.
    // `validar` también queda sin defecto: es un filtro OPCIONAL (por ejemplo, el dígito
    // verificador de un RUT chileno) que solo quien configura el sistema puede aportar — el
    // motor no sabe qué hace válido a un identificador. Sin declararlo, se sigue contando
    // todo lo que matchea `patron`, como hasta ahora.
    //
    // `chequeoEnVivo` es la comprobación EN CADA PASO de la grabación (ver
    // src/privacidad.mjs, exigirUnaSolaPersona): con `patron` presente por defecto, queda
    // ACTIVA por omisión — es un cambio de comportamiento a propósito (ver README, "Migrar a
    // v1.1.0"): apagarla debe ser una decisión consciente, nunca el estado por omisión.
    // `patron: null` la apaga igual (nada que buscar); `chequeoEnVivo: false` es el
    // interruptor explícito para cuando se quiere seguir usando `patron`/`validar` en
    // `demo auditar` sin bloquear la grabación en vivo.
    // `patron` DEBE quedar idéntico a `PATRON_POR_DEFECTO` en src/auditoria.mjs — es el
    // mismo defecto duplicado acá porque importarlo de allá crearía un ciclo (auditoria.mjs
    // ya importa `ErrorConfig` desde este archivo). Ver ahí el porqué de estar ANCLADO
    // (desde v1.1.1: `\d{7,8}-[\dkK]` sin anclar mordía dentro de cadenas más largas). Hay
    // un test en pruebas/configurar.test.mjs que compara ambos literales para detectar que
    // se desincronicen.
    auditoria: { ocr: null, patron: '(?<![\\d-])\\d{7,8}-[\\dkK](?![\\dkK])', cada: 10, maximo: 20, validar: null, chequeoEnVivo: true },
    sembrar: null,
    limpiar: null,
};

// `presentacion` queda en null a propósito: es OPT-IN. Hay más de diez proyectos usando el
// motor y ninguno debe cambiar de aspecto sin declararlo. Los defectos de adentro viven
// aparte porque solo se aplican si el bloque existe; fusionarlos siempre convertiría la
// ausencia del bloque en "presentación con todo por defecto", que es justo lo contrario.
const DEFECTOS_PRESENTACION = {
    fondo: null,        // null = gradiente derivado de marca.color
    padding: 80,
    radio: 16,
    sombra: true,
    barra: true,
    salida: { ancho: 1920, alto: 1080 },
    transicion3d: { activa: true, ms: 900, gradosMax: 12 },
};

function exigir(condicion, mensaje) {
    if (!condicion) throw new ErrorConfig(`demo.config.mjs: ${mensaje}`);
}

/** Fusiona `video`, tratando `presentacion` (y su `salida`/`transicion3d`) como sub-bloques
 *  opt-in: ausentes se quedan en null, presentes reciben sus defectos. */
function fusionarVideo(defectos, cruda = {}) {
    const video = { ...defectos, ...cruda };
    if (!cruda.presentacion) {
        video.presentacion = null;
        return video;
    }
    video.presentacion = {
        ...DEFECTOS_PRESENTACION,
        ...cruda.presentacion,
        salida: { ...DEFECTOS_PRESENTACION.salida, ...cruda.presentacion.salida },
        transicion3d: { ...DEFECTOS_PRESENTACION.transicion3d, ...cruda.presentacion.transicion3d },
    };
    return video;
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
        video: fusionarVideo(DEFECTOS.video, cruda.video),
        auditoria: { ...DEFECTOS.auditoria, ...cruda.auditoria },
        voz,
        actores,
    };
}
