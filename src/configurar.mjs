import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { devices } from 'playwright';

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
    // Audio opt-in: sin música y sin clic, un video de 1.13 suena igual que antes. El
    // volumen del clic tiene defecto aunque esté apagado para que activarlo sea un solo
    // `activo: true`, sin tener que adivinar un nivel razonable.
    audio: { musica: null, clic: { activo: false, volumen: 0.5 } },
};

const TIPOS_SUPERFICIE = ['escritorio', 'telefono'];
const ICONO_POR_TIPO = { escritorio: 'monitor', telefono: 'phone' };

// `presentacion` queda en null a propósito: es OPT-IN. Hay más de diez proyectos usando el
// motor y ninguno debe cambiar de aspecto sin declararlo. Los defectos de adentro viven
// aparte porque solo se aplican si el bloque existe; fusionarlos siempre convertiría la
// ausencia del bloque en "presentación con todo por defecto", que es justo lo contrario.
const DEFECTOS_PRESENTACION = {
    fondo: null,        // null = gradiente derivado de marca.color
    url: null,          // null = la barra rotula baseURL; declarar la URL pública para publicar
    padding: 80,
    radio: 16,
    sombra: true,
    barra: true,
    salida: { ancho: 1920, alto: 1080 },
    transicion3d: { activa: true, ms: 900, gradosMax: 12 },
    // Cuánto dura en pantalla el mapa de superficies antes de la primera escena: lo
    // bastante para leer los rótulos, no tanto como para que parezca una diapositiva.
    mapaMs: 2500,
};

/**
 * Normaliza un color de superficie a `#rrggbb`. El cálculo de contraste de la etiqueta solo
 * sabe leer hexadecimal; aceptar `rgb()` o nombres CSS en silencio producía un NaN y la
 * etiqueta caía en tinta oscura sin avisar. Se valida al cargar la config (y no recién al
 * renderizar el mapa, a mitad del curso) para fallar antes de levantar un navegador.
 */
export function normalizarColor(color, id) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
    if (!m) throw new ErrorConfig(`demo.config.mjs: superficies.${id}.color debe ser hexadecimal (#rgb o #rrggbb), llegó "${color}"`);
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
    return '#' + h.toLowerCase();
}

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
 * Una contraseña escrita como literal: `password: 'algo'` o `"password": "algo"`.
 *
 * Deja fuera cualquier cosa que no sea una comilla justo después de los dos puntos,
 * que es lo que descarta `password: process.env.DEMO_CLAVE ?? 'password'` — ahí el
 * valor lo pone el entorno y el `'password'` final es solo el respaldo del seeder.
 */
const CLAVE_LITERAL = /\bpassword["']?\s*:\s*(["'])(.*?)\1/;

/** El valor que deja el seeder de demo en todos los sistemas: público, no identifica a nadie. */
const CLAVE_DEL_SEEDER = 'password';

/**
 * Avisa por consola cuando el archivo trae la contraseña de un actor escrita en claro.
 *
 * Cuatro sistemas la tenían versionada porque la plantilla lo enseñaba así. Se
 * corrigió en los cinco, pero eso no impide que vuelva: el próximo `demo init` copia
 * la plantilla y quien agregue un actor escribe la clave a mano. Este aviso es lo que
 * hace que el arreglo se sostenga, y va acá porque la carga de la config es el único
 * punto por el que pasan todos los consumidores.
 *
 * Se mira el TEXTO del archivo y no el valor ya cargado a propósito: en ejecución un
 * literal y `process.env.DEMO_CLAVE` son los dos un string y no se distinguen. Lo que
 * importa no es qué clave se usa, sino si quedó escrita en el repositorio.
 *
 * Avisa, no falla: romper la carga dejaría sin videos a cualquiera que actualice el
 * motor, y el riesgo real de una clave de seeder no justifica ese costo.
 *
 * @param {string} archivo ruta del demo.config.mjs, para nombrarla en el aviso
 * @param {string} texto contenido del archivo
 */
function avisarClavesEnClaro(archivo, texto) {
    const nombre = archivo.split('/').slice(-1)[0];

    texto.split('\n').forEach((linea, i) => {
        const sinComentario = linea.trim();
        if (sinComentario.startsWith('//') || sinComentario.startsWith('*')) {
            return;
        }

        const hallazgo = CLAVE_LITERAL.exec(linea);
        if (!hallazgo || hallazgo[2] === CLAVE_DEL_SEEDER) {
            return;
        }

        // Se nombra la línea, nunca el valor: imprimirlo filtraría al log justo lo
        // que este aviso existe para sacar del repositorio.
        console.warn(
            `[demo-engine] ${nombre}:${i + 1} trae la contraseña de un actor escrita en claro, ` +
                'y este archivo está versionado.\n' +
                "              Usá `password: process.env.DEMO_CLAVE ?? 'password'` y pasá la clave por el entorno.",
        );
    });
}

/**
 * Carga y valida el contrato del sistema consumidor.
 * @param {string} rutaProyecto carpeta que contiene demo.config.mjs
 * @returns {Promise<object>} configuración con los valores por defecto aplicados
 */
export async function cargarConfig(rutaProyecto) {
    const archivo = resolve(rutaProyecto, 'demo.config.mjs');
    exigir(existsSync(archivo), `no se encontró el archivo en ${rutaProyecto}`);

    avisarClavesEnClaro(archivo, readFileSync(archivo, 'utf8'));

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

    // Un actor `sesion:false` es el vecino anónimo, o la app que se loguea DENTRO del guion
    // (el APK pide su propio token). Exigirle email/password obligaba a inventar credenciales
    // que nadie usa, y `preparar` intentaba loguearlo contra /login y fallaba.
    const actores = {};
    for (const [nombre, datos] of Object.entries(cruda.actores ?? {})) {
        const actor = { sesion: true, ...datos };
        if (actor.sesion) {
            exigir(actor.email, `el actor "${nombre}" no trae email`);
            exigir(actor.password, `el actor "${nombre}" no trae password`);
        }
        // Se valida contra el catálogo de Playwright acá y no al grabar: un nombre mal
        // escrito tiene que fallar antes de levantar el navegador, no a mitad del video.
        if (actor.dispositivo) exigir(devices[actor.dispositivo], `el actor "${nombre}" pide el dispositivo "${actor.dispositivo}", que Playwright no conoce`);
        if (actor.baseURL) exigir(/^https?:\/\//.test(actor.baseURL), `la baseURL del actor "${nombre}" debe ser http(s) (recibí "${actor.baseURL}")`);
        // `preparar` (src/sesiones.mjs) loguea siempre contra la baseURL GLOBAL: un actor con
        // sesión y baseURL propia recibía cookies de otro host y grababa deslogueado sin avisar.
        exigir(!(actor.baseURL && actor.sesion), `el actor "${nombre}": la baseURL por actor solo se admite con sesion:false (la sesión se prepara contra baseURL global)`);
        actores[nombre] = actor;
    }
    exigir(Object.keys(actores).length > 0, 'actores no puede estar vacío: sin actores no hay a quién grabar');

    // `superficies` queda en null si no se declara (y no en {}), para que el resto del motor
    // distinga "tutorial de una sola superficie, como siempre" de "declaró superficies".
    let superficies = null;
    if (cruda.superficies) {
        superficies = {};
        for (const [id, s] of Object.entries(cruda.superficies)) {
            exigir(s?.nombre, `la superficie "${id}" no trae nombre (sale rotulado en el video)`);
            exigir(TIPOS_SUPERFICIE.includes(s.tipo), `la superficie "${id}" tiene tipo "${s.tipo}"; debe ser escritorio o telefono`);
            superficies[id] = { icono: ICONO_POR_TIPO[s.tipo], ...s, color: normalizarColor(s.color ?? marca.color, id) };
        }
    }
    for (const [nombre, a] of Object.entries(actores)) {
        if (a.superficie) exigir(superficies?.[a.superficie], `el actor "${nombre}" usa la superficie "${a.superficie}", que no está en superficies`);
    }
    const flujo = cruda.flujo ?? [];
    // Sin esta forma exigida, `'a>b'` reventaba con un TypeError crudo y `[['a']]` culpaba a
    // una superficie "undefined": ninguno de los dos dice qué se escribió mal.
    exigir(Array.isArray(flujo) && flujo.every((p) => Array.isArray(p) && p.length === 2), 'flujo debe ser una lista de pares [desde, hasta]');
    for (const [desde, hasta] of flujo) {
        for (const s of [desde, hasta]) exigir(superficies?.[s], `flujo menciona la superficie "${s}", que no está en superficies`);
    }

    // La música se comprueba al cargar: un archivo que no existe descubierto recién en la
    // mezcla final tira a la basura una grabación entera.
    const audio = { ...DEFECTOS.audio, ...cruda.audio, clic: { ...DEFECTOS.audio.clic, ...cruda.audio?.clic } };
    if (audio.musica) {
        // Se exige `archivo` ANTES de resolverlo: `absoluta('')` da la raíz del proyecto, que
        // existe, y un `musica: {}` o un `musica: './x.mp3'` (string, typo frecuente) pasaban.
        exigir(typeof audio.musica === 'object' && audio.musica.archivo, 'audio.musica.archivo es obligatorio cuando se declara música');
        audio.musica = { volumen: 0.12, atenuar: true, ...audio.musica, archivo: absoluta(audio.musica.archivo) };
        const { archivo } = audio.musica;
        exigir(existsSync(archivo) && statSync(archivo).isFile(), `audio.musica.archivo no existe o no es un archivo: ${archivo}`);
    }

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
        superficies,
        flujo,
        audio,
    };
}

/** La superficie en la que vive `actor`, con su id, o null si la config no declara superficies. */
export function superficieDe(config, actor) {
    const id = config.actores?.[actor]?.superficie;
    if (!id || !config.superficies?.[id]) return null;
    return { id, ...config.superficies[id] };
}
