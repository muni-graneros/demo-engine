/**
 * Recorte de silencios del acabado (spec 2026-10-02-video-moderno).
 *
 * Un tutorial se siente lento por los huecos donde la pantalla espera sin voz: en el de
 * seguridad-graneros, 44 s en la reproducción del recorrido (c16b). Acá se planifica qué sacar:
 * de cada hueco sin voz de más de `maxSeg` se quita el centro y se conservan `margenSeg` a cada
 * lado (la acción que termina y la que empieza siguen viéndose). Lo `protegido` (alrededor de
 * cada clic, o un paso con `sinRecorte`) no se corta nunca: un clic que desaparece es un salto
 * que nadie entiende.
 *
 * Todo se redondea a la grilla de cuadros (`fps`): las piezas del acabado se codifican por
 * separado y se pegan sin recodificar, así que cada una tiene que medir un número entero de
 * cuadros o el reloj se corre pieza a pieza.
 */

const redondear = (t, fps) => Math.round(t * fps) / fps;

/** Une intervalos que se tocan o se pisan; devuelve una lista ordenada y disjunta. */
export function unir(intervalos) {
    const orden = intervalos
        .filter((i) => i.fin > i.inicio)
        .map((i) => ({ inicio: i.inicio, fin: i.fin }))
        .sort((a, b) => a.inicio - b.inicio);
    const fuera = [];
    for (const i of orden) {
        const previo = fuera.at(-1);
        if (previo && i.inicio <= previo.fin) previo.fin = Math.max(previo.fin, i.fin);
        else fuera.push(i);
    }
    return fuera;
}

/** `intervalo` menos todos los `quitar` (ya unidos): los pedazos que sobreviven. */
function restar(intervalo, quitar) {
    let pedazos = [intervalo];
    for (const q of quitar) {
        pedazos = pedazos.flatMap((p) => {
            if (q.fin <= p.inicio || q.inicio >= p.fin) return [p];
            const quedan = [];
            if (q.inicio > p.inicio) quedan.push({ inicio: p.inicio, fin: q.inicio });
            if (q.fin < p.fin) quedan.push({ inicio: q.fin, fin: p.fin });
            return quedan;
        });
    }
    return pedazos;
}

/**
 * Planifica el recorte.
 *
 * @param {{ total:number, voces:Array<{inicio:number,fin:number}>, protegidos?:Array<{inicio:number,fin:number}>,
 *           maxSeg?:number, margenSeg?:number, minimoSeg?:number, fps?:number }} opciones
 * @returns {{ cortes:Array<{inicio:number,fin:number}>, total:number,
 *             mapear:(t:number)=>number, mapearEvento:(t:number)=>number|null,
 *             piezas:Array<{inicio:number,fin:number,origen:number}> }}
 *   `cortes` en el reloj ORIGINAL; `total` el largo nuevo; `mapear` lleva un tiempo original al
 *   nuevo (dentro de un corte, al punto de empalme); `mapearEvento` igual pero da `null` dentro
 *   de un corte (un evento que ya no se ve); `piezas` son los tramos conservados en el reloj
 *   NUEVO, cada uno con su `origen` en el original.
 */
export function planDeRecorte({ total, voces, protegidos = [], maxSeg = 2, margenSeg = 0.5, minimoSeg = 0.5, fps = 60 }) {
    if (!(total > 0)) throw new Error(`planDeRecorte: total inválido (${total})`);
    if (!(margenSeg >= 0) || !(maxSeg > 2 * margenSeg)) {
        throw new Error(`planDeRecorte: maxSeg (${maxSeg}) tiene que ser mayor que dos márgenes (${margenSeg})`);
    }
    const habladas = unir(voces.map((v) => ({ inicio: Math.max(0, v.inicio), fin: Math.min(total, v.fin) })));
    const intocables = unir(protegidos);

    // Huecos sin voz: lo que queda entre locuciones (y antes de la primera / después de la última).
    const huecos = [];
    let cursor = 0;
    for (const v of habladas) {
        if (v.inicio > cursor) huecos.push({ inicio: cursor, fin: v.inicio });
        cursor = Math.max(cursor, v.fin);
    }
    if (cursor < total) huecos.push({ inicio: cursor, fin: total });

    const cortes = [];
    for (const h of huecos) {
        if (h.fin - h.inicio <= maxSeg) continue;
        const candidato = { inicio: h.inicio + margenSeg, fin: h.fin - margenSeg };
        for (const p of restar(candidato, intocables)) {
            const c = { inicio: redondear(p.inicio, fps), fin: redondear(p.fin, fps) };
            if (c.fin - c.inicio >= minimoSeg) cortes.push(c);
        }
    }

    const quitadoAntes = (t) => cortes.reduce((s, c) => s + (c.fin <= t ? c.fin - c.inicio : 0), 0);
    const dentro = (t) => cortes.find((c) => t > c.inicio && t < c.fin);
    const mapear = (t) => {
        const c = dentro(t);
        return (c ? c.inicio : t) - quitadoAntes(c ? c.inicio : t);
    };
    const mapearEvento = (t) => (dentro(t) ? null : t - quitadoAntes(t));

    const piezas = [];
    let origen = 0;
    for (const c of [...cortes, { inicio: total, fin: total }]) {
        if (c.inicio > origen) piezas.push({ inicio: mapear(origen), fin: mapear(origen) + (c.inicio - origen), origen });
        origen = c.fin;
    }
    const nuevo = total - cortes.reduce((s, c) => s + (c.fin - c.inicio), 0);
    return { cortes, total: nuevo, mapear, mapearEvento, piezas };
}
