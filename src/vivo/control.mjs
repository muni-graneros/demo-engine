import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { emitKeypressEvents } from 'node:readline';

/**
 * El control de la demo en vivo: el estado que ve el presentador y las órdenes que manda.
 *
 * Es el único punto por el que entran las órdenes, vengan de la página de la consola
 * (`consola.html`, servida en 127.0.0.1), de la terminal (teclas con `readline`) o de una
 * prueba. El ejecutor de la demo espera órdenes con `esperar()` en puntos bien definidos
 * (antes de cada paso, tras un fallo, entre capítulos): una orden que llega mientras un paso
 * está actuando NO lo corta a la mitad —un `hacer` interrumpido deja la base a medio
 * cambiar—, queda pendiente para el próximo punto de espera.
 *
 * Órdenes (`{ tipo, valor? }`):
 * - `siguiente`   ejecuta el paso que viene (o pasa al capítulo siguiente);
 * - `saltar`      no ejecuta el paso que viene (o el que falló);
 * - `reintentar`  vuelve a ejecutar el paso que falló;
 * - `reiniciar`   vuelve a sembrar el capítulo y lo empieza de cero;
 * - `ir`          salta al capítulo `valor` (índice desde 0);
 * - `seguro`      modo seguro: abre el MP4 grabado del capítulo en vez de ejecutarlo;
 * - `pausa`       congela el avance (inmediata; en automático detiene el reloj);
 * - `negro`       tapa las ventanas de los actores (inmediata);
 * - `salir`       termina la demo.
 */

export const ORDENES = ['siguiente', 'saltar', 'reintentar', 'reiniciar', 'ir', 'seguro', 'pausa', 'negro', 'salir'];
/** Las que cortan el recorrido del capítulo: quedan pendientes si llegan mientras se actúa. */
const INTERRUPCIONES = ['reiniciar', 'ir', 'seguro', 'salir'];
const INMEDIATAS = ['pausa', 'negro'];

/**
 * Teclas, con el `key` de un KeyboardEvent del navegador. Son las que mandan los presentadores
 * inalámbricos (PageDown/PageUp, flechas, «b» o «.» para la pantalla negra). La terminal
 * traduce sus nombres a éstos (`teclaDeTerminal`), así la página y la terminal no pueden
 * desalinearse.
 */
export const TECLAS = {
    ArrowRight: 'siguiente', PageDown: 'siguiente', ' ': 'siguiente',
    // «Anterior» no puede deshacer: un paso cambió la base (asignar, cerrar el caso). Lo más
    // útil que puede hacer la tecla de retroceso del clicker es reintentar el paso que falló.
    ArrowLeft: 'reintentar', PageUp: 'reintentar', r: 'reintentar',
    s: 'saltar', p: 'pausa', b: 'negro', '.': 'negro', c: 'seguro', i: 'reiniciar', Home: 'reiniciar',
};

/** La orden de una tecla (1…9 salta a ese capítulo), o null. */
export function ordenDeTecla(tecla) {
    if (/^[1-9]$/.test(tecla)) return { tipo: 'ir', valor: Number(tecla) - 1 };
    const tipo = TECLAS[tecla] ?? TECLAS[tecla?.toLowerCase?.()];
    return tipo ? { tipo } : null;
}

const NOMBRES_TERMINAL = { right: 'ArrowRight', left: 'ArrowLeft', pagedown: 'PageDown', pageup: 'PageUp', space: ' ', home: 'Home' };

/** Traduce una tecla de `readline` (keypress) al `key` del navegador. */
export function teclaDeTerminal(str, key = {}) {
    return NOMBRES_TERMINAL[key.name] ?? str ?? key.name ?? null;
}

/**
 * @param {{ capitulos: Array<{id:string,titulo:string}>, auto?: boolean, alInmediata?: (orden, estado) => void|Promise<void> }} opciones
 */
export function crearControl({ capitulos = [], auto = false, alInmediata = null } = {}) {
    const estado = {
        fase: 'preparando', capitulos, capitulo: null, paso: null, siguiente: null,
        pausado: false, negro: false, auto, error: null, clip: null, aviso: null,
        inicioCapitulo: null, pasosHechos: 0,
    };
    const suscriptores = new Set();
    let espera = null;          // { aceptadas:Set, resolver, temporizador, msAuto }
    let pendiente = null;       // una interrupción llegada mientras se actuaba

    function emitir() {
        const foto = JSON.stringify(estado);
        for (const s of suscriptores) s(foto, estado);
    }

    function actualizar(parcial) {
        Object.assign(estado, parcial);
        emitir();
    }

    function armarAuto() {
        if (!espera || !espera.msAuto || estado.pausado) return;
        clearTimeout(espera.temporizador);
        espera.temporizador = setTimeout(() => resolverEspera({ tipo: 'siguiente', auto: true }), espera.msAuto);
    }

    function resolverEspera(orden) {
        const { resolver, temporizador } = espera;
        clearTimeout(temporizador);
        espera = null;
        resolver(orden);
    }

    /**
     * Recibe una orden. Devuelve `{ aceptada, mensaje }` para que la consola lo muestre.
     */
    async function orden(o) {
        const tipo = o?.tipo;
        if (!ORDENES.includes(tipo)) return { aceptada: false, mensaje: `orden desconocida: ${tipo}` };
        if (tipo === 'ir' && !(Number.isInteger(o.valor) && o.valor >= 0 && o.valor < capitulos.length)) {
            return { aceptada: false, mensaje: `no hay capítulo ${o.valor}` };
        }
        if (INMEDIATAS.includes(tipo)) {
            if (tipo === 'pausa') {
                estado.pausado = !estado.pausado;
                if (estado.pausado && espera) clearTimeout(espera.temporizador);
                else armarAuto();
            } else {
                estado.negro = !estado.negro;
            }
            await alInmediata?.(o, estado);
            emitir();
            return { aceptada: true, mensaje: tipo === 'pausa' ? (estado.pausado ? 'en pausa' : 'reanudado') : (estado.negro ? 'pantalla negra' : 'pantalla visible') };
        }
        if (espera && espera.aceptadas.has(tipo)) {
            if (tipo === 'siguiente' && estado.pausado) {
                return avisar('En pausa: reanuda (P) antes de avanzar.');
            }
            resolverEspera({ tipo, valor: o.valor });
            return { aceptada: true, mensaje: tipo };
        }
        if (INTERRUPCIONES.includes(tipo)) {
            pendiente = { tipo, valor: o.valor };
            return avisar(`Se hará al terminar el paso en curso: ${tipo}.`);
        }
        if (tipo === 'reintentar') return avisar('No hay un paso fallido que reintentar. Retroceder no deshace lo hecho: para repetir, reinicia el capítulo (I).');
        return avisar(estado.fase === 'actuando' ? 'El paso todavía está actuando.' : `Ahora no se puede: ${tipo}.`);
    }

    function avisar(mensaje) {
        actualizar({ aviso: mensaje });
        return { aceptada: false, mensaje };
    }

    /**
     * Espera una orden de las `aceptadas`. Con `msAuto`, pasado ese tiempo sin pausa resuelve
     * sola como `siguiente` (modo automático). Una interrupción pendiente se entrega de
     * inmediato si se acepta aquí.
     */
    function esperar(aceptadas, { msAuto = 0 } = {}) {
        if (espera) throw new Error('control: ya hay una espera en curso');
        const conjunto = new Set(aceptadas);
        if (pendiente && conjunto.has(pendiente.tipo)) {
            const o = pendiente;
            pendiente = null;
            return Promise.resolve(o);
        }
        pendiente = null;
        return new Promise((resolver) => {
            espera = { aceptadas: conjunto, resolver, temporizador: null, msAuto };
            armarAuto();
        });
    }

    /**
     * Sirve la consola en 127.0.0.1. Nunca en otra interfaz: la consola manda sobre un
     * navegador con sesiones de funcionarios, y exponerla a la red exigiría autenticarla
     * (fase 3). Además se rechaza cualquier petición cuyo `Host` no sea el loopback (evita
     * que una página ajena llegue por DNS rebinding) y las órdenes exigen JSON (un
     * formulario de otro sitio no puede mandarlo sin una preflight que acá nadie contesta).
     */
    function servir({ puerto = 0 } = {}) {
        const html = readFileSync(new URL('./consola.html', import.meta.url), 'utf8')
            .replace('/*TECLAS*/{}', JSON.stringify(TECLAS));
        const servidor = createServer((req, res) => {
            const host = (req.headers.host ?? '').replace(/:\d+$/, '');
            if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
                res.writeHead(403).end('solo 127.0.0.1');
                return;
            }
            const url = new URL(req.url, 'http://127.0.0.1');
            if (req.method === 'GET' && url.pathname === '/') {
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
                return;
            }
            if (req.method === 'GET' && url.pathname === '/estado') {
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(estado));
                return;
            }
            if (req.method === 'GET' && url.pathname === '/eventos') {
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
                const enviar = (foto) => res.write(`data: ${foto}\n\n`);
                suscriptores.add(enviar);
                enviar(JSON.stringify(estado));
                req.on('close', () => suscriptores.delete(enviar));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/orden') {
                if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
                    res.writeHead(415).end('se espera application/json');
                    return;
                }
                let cuerpo = '';
                req.on('data', (d) => { cuerpo += d; if (cuerpo.length > 4096) req.destroy(); });
                req.on('end', async () => {
                    let o;
                    try { o = JSON.parse(cuerpo); } catch { res.writeHead(400).end('JSON inválido'); return; }
                    const r = await orden(o);
                    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r));
                });
                return;
            }
            res.writeHead(404).end('no existe');
        });
        return new Promise((listo, fallo) => {
            servidor.once('error', fallo);
            servidor.listen(puerto, '127.0.0.1', () => {
                const { port } = servidor.address();
                listo({
                    url: `http://127.0.0.1:${port}/`,
                    cerrar: () => new Promise((f) => {
                        servidor.closeAllConnections?.();
                        servidor.close(() => f());
                    }),
                });
            });
        });
    }

    /**
     * Teclas en la terminal (solo si es una TTY): las mismas que la página, más `q` o Ctrl+C
     * para salir. Imprime una línea por cambio de paso con la narración, como teleprompter
     * de respaldo si la página no está a mano.
     */
    function conectarTerminal({ entrada = process.stdin, salida = process.stdout } = {}) {
        if (!entrada.isTTY) return { cerrar: () => {} };
        emitKeypressEvents(entrada);
        entrada.setRawMode(true);
        entrada.resume();
        const alTecla = (str, key = {}) => {
            if ((key.ctrl && key.name === 'c') || str === 'q') {
                orden({ tipo: 'salir' });
                return;
            }
            const o = ordenDeTecla(teclaDeTerminal(str, key));
            if (o) orden(o).then((r) => { if (!r.aceptada) salida.write(`  · ${r.mensaje}\n`); });
        };
        entrada.on('keypress', alTecla);
        let ultimo = '';
        const pintar = (foto, e) => {
            const clave = `${e.fase}|${e.capitulo}|${e.paso?.numero}|${e.error}|${e.clip}`;
            if (clave === ultimo) return;
            ultimo = clave;
            const cap = e.capitulos[e.capitulo];
            const cabeza = cap ? `[${cap.id}] ${cap.titulo}` : '';
            if (e.fase === 'esperando' && e.paso) {
                salida.write(`\n${cabeza} · paso ${e.paso.numero}/${e.paso.total} · ${e.paso.actor}\n  ▶ ${e.paso.narrar ?? '(sin narración)'}\n`);
                if (e.siguiente) salida.write(`    después: ${e.siguiente.narrar ?? '(sin narración)'}\n`);
            } else if (e.fase === 'fallo') {
                salida.write(`\n✖ ${e.error}\n  R reintentar · S saltar · I reiniciar capítulo · C clip grabado\n`);
            } else if (e.fase === 'clip') {
                salida.write(`\n▶ modo seguro: ${e.clip ?? e.aviso}\n`);
            } else if (e.fase === 'sembrando') {
                salida.write(`\n${cabeza} · sembrando…\n`);
            } else if (e.fase === 'fin') {
                salida.write('\nFin de la demo. Q para salir.\n');
            }
        };
        suscriptores.add(pintar);
        return {
            cerrar: () => {
                suscriptores.delete(pintar);
                entrada.off('keypress', alTecla);
                entrada.setRawMode(false);
                entrada.pause();
            },
        };
    }

    return { estado, actualizar, orden, esperar, servir, conectarTerminal, suscribir: (f) => { suscriptores.add(f); return () => suscriptores.delete(f); } };
}
