/**
 * Convierte los pasos grabados en segmentos ordenados cronológicamente.
 *
 * Cada actor se graba en su propio contexto, así que su video corre en un reloj propio
 * (`tLocal`). El orden narrativo, en cambio, vive en `tGlobal`. Esta función traduce de
 * uno al otro: el segmento dice de qué pista cortar (`actor`), qué tramo de esa pista
 * (`desdeSeg`/`hastaSeg`, en su reloj local) y en qué lugar del relato va (`tGlobal`).
 *
 * @param {Array<{escena:string,actor:string,tLocal:number,tGlobal:number,duracionMs:number,narrar?:string,wav?:string|null}>} pasos
 * @returns {Array<{actor:string,escena:string,desdeSeg:number,hastaSeg:number,tGlobal:number,narrar?:string,wav?:string|null}>}
 */
export function construirLineaDeTiempo(pasos) {
    for (const p of pasos) {
        if (typeof p.duracionMs !== 'number' || p.duracionMs <= 0) {
            throw new Error(`el paso "${p.escena}" (${p.actor}) no trae duracionMs: sin ella el corte quedaría vacío`);
        }
    }

    return [...pasos]
        .sort((a, b) => a.tGlobal - b.tGlobal)
        .map((p) => ({
            actor: p.actor,
            escena: p.escena,
            desdeSeg: p.tLocal / 1000,
            hastaSeg: (p.tLocal + p.duracionMs) / 1000,
            tGlobal: p.tGlobal,
            narrar: p.narrar,
            // El grabador ya sintetizó (o ya intentó y perdió) esta locución: sin propagar
            // `wav` acá, montar() nunca se enteraba de ese trabajo y sintetizaba TODO de
            // nuevo, duplicando el paso más caro del pipeline en cada corrida.
            wav: p.wav,
        }));
}
