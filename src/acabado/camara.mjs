/**
 * Cámara automática del acabado (spec 2026-10-02-video-moderno): acerca y pasea el lienzo
 * siguiendo los clics, al estilo de los videos de producto de hoy.
 *
 * No reemplaza a `acercarA` (src/camara.mjs), que hace zoom DENTRO de la página por CDP cuando el
 * guion lo pide: esto mueve una cámara sobre el lienzo YA compuesto (marco, chip y teléfono
 * incluidos), sin tocar la grabación. Un clic hecho con la página ya acercada no la dispara: dos
 * zoom encima se ven como un salto.
 *
 * El estado de la cámara es el rectángulo visible del lienzo `{ x, y, ancho }` (el alto sale del
 * aspecto). Entre dos estados se interpola el RECTÁNGULO, no el centro y la escala por separado:
 * los dos extremos caben en el lienzo, y una combinación convexa de dos rectángulos que caben
 * también cabe, así que ningún cuadro intermedio muestra lo que hay fuera del lienzo.
 */

const suave = (u) => {
    const c = Math.min(1, Math.max(0, u));
    return c * c * (3 - 2 * c);
};

/**
 * Lleva un punto de la página (px CSS de la pista del actor) al lienzo compuesto, con la misma
 * geometría que `componerEnLienzo`: la pista entra en su hueco sin deformarse y centrada.
 */
export function puntoEnLienzo({ x, y }, { hueco, dim, estirar = false }) {
    // Sin lienzo, el corte estira la pista al cuadro (`scale=W:H`): cada eje con su escala.
    if (estirar) return { x: hueco.x + x * (hueco.ancho / dim.ancho), y: hueco.y + y * (hueco.alto / dim.alto) };
    const escala = Math.min(hueco.ancho / dim.ancho, hueco.alto / dim.alto);
    const dx = (hueco.ancho - dim.ancho * escala) / 2;
    const dy = (hueco.alto - dim.alto * escala) / 2;
    return { x: hueco.x + dx + x * escala, y: hueco.y + dy + y * escala };
}

/** El rectángulo visible centrado en (cx, cy) a escala `zoom`, corrido lo justo para caber. */
export function encuadre({ cx, cy, zoom }, lienzo) {
    const ancho = lienzo.ancho / zoom;
    const alto = lienzo.alto / zoom;
    const x = Math.min(lienzo.ancho - ancho, Math.max(0, cx - ancho / 2));
    const y = Math.min(lienzo.alto - alto, Math.max(0, cy - alto / 2));
    return { x, y, ancho };
}

const reposo = (lienzo) => ({ x: 0, y: 0, ancho: lienzo.ancho });
const igual = (a, b) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.ancho - b.ancho) < 0.5;

export const DEFECTOS_CAMARA = Object.freeze({
    zoom: 1.5, zoomTelefono: 1.3, entradaS: 0.8, salidaS: 0.8, paseoS: 0.6,
    antesS: 0.15, sostenerS: 1.6, agruparS: 3.2, umbralPaseo: 0.06,
});

/**
 * Planifica los movimientos de cámara.
 *
 * @param {{ focos:Array<{t:number, x:number, y:number, encuadre:number, telefono?:boolean}>,
 *           encuadres:Array<{inicio:number, fin:number, camara:boolean}>,
 *           lienzo:{ancho:number, alto:number}, opciones?:object }} entrada
 *   `focos`: cada clic en el reloj final y en px del lienzo, con el índice de su encuadre (un tramo
 *   continuo del video: mismo actor y misma disposición). La cámara nunca cruza el borde de un
 *   encuadre acercada: un corte de plano con zoom se ve como un error.
 * @returns {Array<{desde:number, hasta:number, de:object, a:object}>} transiciones ordenadas; entre
 *   una y otra la cámara queda quieta.
 */
export function planDeCamara({ focos, encuadres, lienzo, opciones = {} }) {
    const o = { ...DEFECTOS_CAMARA, ...opciones };
    const enCalma = reposo(lienzo);
    const validos = focos
        .filter((f) => encuadres[f.encuadre]?.camara)
        .filter((f) => f.t >= encuadres[f.encuadre].inicio && f.t <= encuadres[f.encuadre].fin)
        .sort((a, b) => a.t - b.t);

    // Tomas: clics seguidos del mismo encuadre, a no más de `agruparS` uno de otro.
    const tomas = [];
    for (const f of validos) {
        const previa = tomas.at(-1);
        if (previa && previa.encuadre === f.encuadre && f.t - previa.focos.at(-1).t <= o.agruparS) previa.focos.push(f);
        else tomas.push({ encuadre: f.encuadre, focos: [f] });
    }

    const movimientos = [];
    let estado = enCalma;
    let libre = 0;   // desde cuándo la cámara puede volver a moverse
    const mover = (desde, hasta, a) => {
        desde = Math.max(desde, libre);
        if (hasta - desde < 0.2) hasta = desde + 0.2;
        if (!igual(estado, a)) movimientos.push({ desde, hasta, de: estado, a });
        estado = a;
        libre = hasta;
    };

    for (const toma of tomas) {
        const { inicio, fin } = encuadres[toma.encuadre];
        toma.focos.forEach((f, i) => {
            const objetivo = encuadre({ cx: f.x, cy: f.y, zoom: f.telefono ? o.zoomTelefono : o.zoom }, lienzo);
            const llegada = Math.max(inicio + 0.2, f.t - o.antesS);
            if (i === 0) {
                mover(Math.max(inicio, llegada - o.entradaS), llegada, objetivo);
                return;
            }
            const lejos = Math.hypot(objetivo.x - estado.x, objetivo.y - estado.y) > o.umbralPaseo * lienzo.ancho
                || Math.abs(objetivo.ancho - estado.ancho) > 1;
            if (lejos) mover(llegada - o.paseoS, llegada, objetivo);
        });
        // Sostener y salir, terminando antes del borde del encuadre.
        const ultimo = toma.focos.at(-1).t;
        const tope = fin - 0.05;
        let salida = Math.min(ultimo + o.sostenerS, tope - o.salidaS);
        salida = Math.max(salida, libre);
        const dura = Math.max(0.25, Math.min(o.salidaS, tope - salida));
        mover(salida, salida + dura, enCalma);
    }
    return movimientos;
}

/** El rectángulo visible en el instante `t` (la misma cuenta que hacen las expresiones de ffmpeg). */
export function estadoEn(movimientos, t, lienzo) {
    let r = reposo(lienzo);
    for (const m of movimientos) {
        const s = suave((t - m.desde) / (m.hasta - m.desde));
        r = {
            x: r.x + (m.a.x - m.de.x) * s,
            y: r.y + (m.a.y - m.de.y) * s,
            ancho: r.ancho + (m.a.ancho - m.de.ancho) * s,
        };
    }
    return r;
}

/** ¿Hay algún movimiento o zoom sostenido entre `desde` y `hasta`? (Si no, la pieza se copia tal cual.) */
export function hayCamaraEntre(movimientos, desde, hasta, lienzo) {
    if (movimientos.some((m) => m.hasta > desde && m.desde < hasta)) return true;
    return !igual(estadoEn(movimientos, desde, lienzo), reposo(lienzo));
}

const num = (n) => Number(n.toFixed(4)).toString();

/**
 * Las ocho expresiones del filtro `perspective` (`sense=source`, `eval=frame`) para una pieza que
 * empieza en `offset` segundos del reloj final y corre a `fps`. Cada transición suma una rampa
 * suave (smoothstep sobre `clip`), sin anidar `if`: la expresión crece lineal con los movimientos y
 * ffmpeg la evalúa en microsegundos por cuadro. Sólo entran las transiciones que tocan la pieza; lo
 * anterior se resume en el estado inicial.
 */
export function expresionesPerspectiva(movimientos, { offset, duracion, fps, lienzo }) {
    const base = estadoEn(movimientos.filter((m) => m.hasta <= offset), offset, lienzo);
    const activos = movimientos.filter((m) => m.hasta > offset && m.desde < offset + duracion);
    const T = `(${num(offset)}+in/${fps})`;
    const rampa = (m) => {
        const u = `clip((${T}-${num(m.desde)})/${num(m.hasta - m.desde)},0,1)`;
        return `(${u}*${u}*(3-2*${u}))`;
    };
    const eje = (clave) => {
        let e = num(base[clave]);
        for (const m of activos) {
            const delta = m.a[clave] - m.de[clave];
            if (Math.abs(delta) > 1e-6) e += `+${num(delta)}*${rampa(m)}`;
        }
        return e;
    };
    const x = eje('x');
    const y = eje('y');
    const ancho = eje('ancho');
    const alto = `((${ancho})*${num(lienzo.alto / lienzo.ancho)})`;
    const x1 = `(${x}+${ancho})`;
    const y2 = `(${y}+${alto})`;
    return { x0: x, y0: y, x1, y1: y, x2: x, y2, x3: x1, y3: y2 };
}

/** El filtro `perspective` armado con esas expresiones. */
export function filtroPerspectiva(expr) {
    const q = (e) => `'${e}'`;
    return `perspective=x0=${q(expr.x0)}:y0=${q(expr.y0)}:x1=${q(expr.x1)}:y1=${q(expr.y1)}`
        + `:x2=${q(expr.x2)}:y2=${q(expr.y2)}:x3=${q(expr.x3)}:y3=${q(expr.y3)}:interpolation=cubic:eval=frame`;
}
