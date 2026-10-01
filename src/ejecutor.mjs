import { exigirUnaSolaPersona } from './privacidad.mjs';
import { configurarCursor, instalarCursor } from './camara.mjs';
import { actorConSesion, actorTactil, opcionesDeContexto } from './contexto-actor.mjs';
import { configurarPresentacion } from './explainer.mjs';
import { superficieDe } from './configurar.mjs';

/**
 * El ejecutor de guiones: la SEMÁNTICA de un guion, sin nada de la grabación.
 *
 * Vivía dentro de `grabar()` mezclada con el screencast, los relojes, la captura y la espera
 * por la voz. Salió a este archivo porque hoy la usan dos clientes que tienen que ver lo
 * mismo: `grabar()` (el video) y `vivo()` (la demo en vivo, que avanza cuando lo dice el
 * presentador). Si cada uno tuviera su copia del bucle, la próxima corrección de `dividir` o
 * del portero de privacidad llegaría solo a una de las dos.
 *
 * Lo que es del guion y vive acá:
 * - el contexto de cada actor se crea perezosamente, la primera vez que aparece
 *   (`opcionesDeContexto`: sesión, dispositivo, baseURL propia con su guardián, permisos, GPS);
 * - `dividir` se valida, queda vigente hasta un paso con `dividir: null`, no cruza de escena,
 *   y abre los DOS contextos antes de actuar;
 * - el cursor falso se repone antes y después de `hacer` (una navegación se lo lleva);
 * - el portero (`exigirUnaSolaPersona`) revisa al actor del paso y al otro panel del tramo
 *   dividido, salvo `variasPersonas: true`;
 * - un error se envuelve con guion, escena, paso y actor, conservando el original en `cause`.
 *
 * Lo que es de cada cliente entra por `ganchos` (todos opcionales y todos pueden ser async):
 * - `opcionesDeActor(nombre, opciones)` → opciones de `newContext` retocadas (p. ej. en vivo,
 *   la ventana manda sobre el viewport de escritorio);
 * - `alAbrirActor(nombre, datos)`: recién creado el contexto, con el cursor ya instalado.
 *   `datos` es `{ ctx, page, pista }` y el gancho puede colgarle lo suyo (la grabación, su
 *   `t0`): es el mismo objeto que después queda en `actores` y llega en `info.actor`;
 * - `antesDePaso(info)`: con los contextos del paso ya abiertos, antes de actuar. Si devuelve
 *   `'saltar'`, el paso no se ejecuta;
 * - `alNarrar(info)`: justo antes de `hacer`, que es cuando empieza a sonar la narración;
 * - `esperarNarracion(info)`: después de `hacer` y ANTES del portero (el grabador espera acá
 *   lo que falte de la locución, y el portero mira la pantalla tal como quedó al final);
 * - `despuesDePaso(info)`: con el portero ya pasado (el grabador captura acá);
 * - `alFallar(error, info)`: con el error ya envuelto. Devuelve `'reintentar'` o `'saltar'`;
 *   si no está o lanza, el error se propaga. Sin este gancho, el primer error corta todo, que
 *   es lo que quiere la grabación: una toma con un paso roto no sirve.
 *
 * Un gancho que lance una `Interrupcion` la ve salir tal cual, sin envolver ni pasar por
 * `alFallar`: es una orden (reiniciar el capítulo, saltar a otro), no un fallo del guion.
 *
 * `actores` se puede pasar desde afuera para reutilizar contextos entre guiones: en vivo, la
 * ventana del operador sigue abierta de un capítulo al siguiente y no se vuelve a entrar.
 *
 * @returns {Promise<{ actores: Map<string, object> }>}
 */
export async function ejecutarGuion(guion, {
    config, sesiones = {}, navegador, actores = new Map(), tamano = null, ganchos = {},
}) {
    const { ancho, alto } = tamano ?? config.video ?? {};
    // Actores de los que ya se avisó que su panel dividido sale en blanco: sin esto, un
    // tramo dividido de diez pasos repetía el mismo aviso diez veces.
    const avisadosEnBlanco = new Set();

    async function actorDe(nombre) {
        if (actores.has(nombre)) return actores.get(nombre);
        // Solo un actor CON sesión la exige: `sesion: false` (la app del vecino, un APK sin
        // login previo) abre su contexto limpio, y el propio guion entra si hace falta.
        if (actorConSesion(config, nombre) && !sesiones[nombre]) {
            throw new Error(`el guion usa el actor "${nombre}", que no está en la config`);
        }
        const { opciones, pista } = opcionesDeContexto(config, nombre, sesiones, { ancho, alto });
        const finales = ganchos.opcionesDeActor ? await ganchos.opcionesDeActor(nombre, opciones) : opciones;
        const ctx = await navegador.newContext({ ...finales, locale: 'es-CL' });
        const page = await ctx.newPage();
        // Flecha o indicador de toque según el actor (superficie/dispositivo táctil).
        configurarCursor(page, { tactil: actorTactil(config, nombre) });
        // Dónde va la ficha de `presentar` en esta superficie (`superficies.<id>.presentar`):
        // el APK la quiere arriba porque abajo vive PÁNICO. La llamada del guion manda igual.
        const presentarEn = superficieDe(config, nombre)?.presentar;
        if (presentarEn) configurarPresentacion(presentarEn, page);
        // El cursor se instala ANTES del gancho: el grabador fija el cero de la pista ahí
        // adentro, y el viaje al navegador de instalarlo después correría ese cero.
        await instalarCursor(page);
        const datos = { ctx, page, pista };
        await ganchos.alAbrirActor?.(nombre, datos);
        actores.set(nombre, datos);
        return datos;
    }

    for (const [indiceEscena, escena] of guion.escenas.entries()) {
        // La pantalla dividida no cruza de escena: cada escena abre con su tarjeta de
        // título, y un traspaso que siguiera partido detrás de ella se leería como parte
        // de lo que viene y no de lo que terminó.
        let dividirVigente = null;
        for (const [indice, paso] of escena.pasos.entries()) {
            // Solo `null`/`undefined` apagan el tramo: cualquier otro valor (`false`, `''`,
            // `0`) se valida y revienta, en vez de colarse como «sin dividir» y esconder un
            // guion mal escrito.
            if ('dividir' in paso) dividirVigente = paso.dividir == null ? null : paso.dividir;
            const info = { guion, escena, indiceEscena, indice, paso, dividir: dividirVigente, actor: null, actores };

            for (;;) {
                try {
                    await ejecutarPaso(info);
                    break;
                } catch (error) {
                    if (error instanceof Interrupcion) throw error;
                    const envuelto = errorDePaso(guion, escena, indice, paso, error);
                    if (!ganchos.alFallar) throw envuelto;
                    const decision = await ganchos.alFallar(envuelto, info);
                    if (decision === 'reintentar') continue;
                    if (decision === 'saltar') break;
                    throw envuelto;
                }
            }
        }
    }
    return { actores };

    async function ejecutarPaso(info) {
        const { paso, dividir } = info;
        if (dividir !== null) {
            validarDividir(dividir, paso.actor);
            // Los dos contextos se abren ANTES de actuar: si el otro actor recién se abriera
            // en un paso posterior, su pista no cubriría este tramo y el montaje no tendría
            // qué poner en su mitad de la pantalla.
            for (const otro of dividir) {
                const { page: suPagina } = await actorDe(otro);
                // El actor del paso navega en su propio `hacer`; el otro, si no abrió nada,
                // queda vacío y su panel sale en blanco. No es un error (puede ser a propósito),
                // pero casi siempre es un olvido. Se mira el CONTENIDO, no la URL: un guion que
                // dibuja con `setContent` sigue en about:blank y su panel se ve bien.
                if (otro !== paso.actor && !avisadosEnBlanco.has(otro) && await paginaVacia(suPagina)) {
                    avisadosEnBlanco.add(otro);
                    console.warn(`[demo-engine] dividir: el actor "${otro}" no tiene nada abierto todavía; su panel saldrá en blanco`);
                }
            }
        }

        info.actor = await actorDe(paso.actor);
        const { page } = info.actor;

        if (ganchos.antesDePaso && await ganchos.antesDePaso(info) === 'saltar') return;

        // Se repone el cursor antes de actuar: en un actor reutilizado, el paso anterior pudo
        // haber navegado y una navegación se lleva el cursor consigo.
        await instalarCursor(page);
        await ganchos.alNarrar?.(info);
        // Segundo argumento: el contexto del guion. Como mínimo trae `config`, de donde
        // `portada()`/`cierre()` sacan `config.marca` (nombre, color, escudo). Los guiones que
        // declaran `hacer(page)` a secas lo ignoran y siguen funcionando sin cambios.
        await paso.hacer(page, { config });
        await instalarCursor(page);   // el propio `hacer` también pudo navegar

        await ganchos.esperarNarracion?.(info);

        // El portero, al cierre del paso: lee el DOM (sin OCR, 4-6 ms medido) y cuenta
        // identificadores distintos con el `patron`/`validar` de `config.auditoria`.
        // `paso.variasPersonas: true` es la excepción declarada a propósito; lo seguro es el
        // valor por defecto. Ver src/privacidad.mjs.
        if (!paso.variasPersonas) {
            await exigirUnaSolaPersona(page, config.auditoria);
            // En un tramo dividido el panel del OTRO actor está igual de a la vista (Ley
            // 21.719): sin auditarlo, un listado completo abierto en un paso anterior —con su
            // propia excepción `variasPersonas`— salía al lado de este paso sin ningún
            // control. Repetir el del actor del paso cuesta unos ms y deja el bucle simple.
            for (const otro of dividir ?? []) {
                await exigirUnaSolaPersona(actores.get(otro).page, config.auditoria);
            }
        }

        await ganchos.despuesDePaso?.(info);
    }
}

/**
 * ¿La página no muestra nada? Sólo puede estarlo una about:blank (una URL navegada tiene lo que
 * sirvió el sistema); en ella se ignora lo que inyecta el motor (cursor, halo, cubridor: ids
 * `__…`). Si la página no responde, se la da por no vacía: el aviso es una ayuda, no un error.
 */
export async function paginaVacia(page) {
    if (page.url() !== 'about:blank') return false;
    return page.evaluate(() => {
        const cuerpo = document.body;
        if (!cuerpo) return true;
        const propios = (el) => typeof el.id === 'string' && el.id.startsWith('__');
        const visibles = [...cuerpo.children].filter((el) => !propios(el) && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE');
        return visibles.length === 0 && !cuerpo.textContent.trim();
    }).catch(() => false);
}

/**
 * Una orden que corta el recorrido de un guion sin ser un fallo suyo (reiniciar el capítulo,
 * saltar a otro, pasar al clip grabado, salir). El ejecutor la deja pasar sin envolverla.
 */
export class Interrupcion extends Error {
    constructor(tipo, datos = {}) {
        super(`interrupción: ${tipo}`);
        this.tipo = tipo;
        Object.assign(this, datos);
    }
}

/**
 * Valida un `dividir` contra el actor del paso. Se exige un par EXACTO que incluya al actor
 * que actúa: la pantalla dividida existe para mostrar un traspaso (el vecino envía, el
 * operador lo recibe), y un panel sin el actor que se mueve dejaría la acción fuera de cuadro.
 */
export function validarDividir(dividir, actor) {
    const valido = Array.isArray(dividir) && dividir.length === 2 &&
        dividir[0] !== dividir[1] && dividir.every((x) => typeof x === 'string') &&
        dividir.includes(actor);
    if (!valido) {
        throw new Error(`dividir debe ser un par de actores distintos que incluya a "${actor}", y es ${JSON.stringify(dividir)}`);
    }
}

/**
 * Identifica CON PRECISIÓN qué paso y qué escena fallaron: en un guion largo, "algo reventó"
 * obliga a releer todo el guion para ubicar el punto. `{ cause }` conserva el error original
 * completo (stack incluido) para quien necesite más detalle que el mensaje.
 */
export function errorDePaso(guion, escena, indice, paso, error) {
    return new Error(
        `guion "${guion.id}", escena "${escena.id}" ("${escena.titulo}"), paso ${indice + 1} ` +
        `(actor "${paso.actor}"): ${error?.message ?? error}`,
        { cause: error },
    );
}

/** Los pasos de un guion en orden, aplanados, con su escena: lo que lee el teleprompter. */
export function pasosEnOrden(guion) {
    return (guion.escenas ?? []).flatMap((escena, indiceEscena) =>
        (escena.pasos ?? []).map((paso, indice) => ({ escena, indiceEscena, indice, paso })));
}
