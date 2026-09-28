/**
 * Arma la mezcla de audio del video: silencio base + locuciones en su marca + (opcional)
 * música en bucle atenuada bajo la voz + (opcional) un clic corto por pulsación.
 *
 * Estéreo 48 kHz: el curso ya re-encodeaba a estéreo, y una música mono suena pobre.
 * El clic se sintetiza con `aevalsrc` (ruido con decaimiento exponencial), sin archivo:
 * el motor no puede traer audio de terceros por licencia.
 *
 * La entrada 0 es SIEMPRE el video del que llama: pone `-i video` y después `...entradas`.
 *
 * loudnorm (I=-16, TP=-1.5, LRA=11, el mismo objetivo que montaje.mjs) se aplica SOLO a la
 * voz, no a la mezcla: en una sola pasada es un control automático de ganancia, y sobre la
 * mezcla entera subía la música ~20 dB en cada silencio hasta igualarla con la voz. Así la
 * voz queda a su sonoridad objetivo y la música/clics a su `volumen` relativo a ella.
 */
export function cadenaDeMezcla({ total, locuciones, musica, clics, clic }) {
    const entradas = ['-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=stereo'];
    let idx = 1;                                   // 0 es el video del que llama
    const base = `[${idx++}:a]`;
    const filtros = [];
    const voces = [];
    for (const { wav, inicioSeg } of locuciones) {
        entradas.push('-i', wav);
        const ms = Math.round(Math.max(0, inicioSeg) * 1000);   // adelay rechaza negativos
        filtros.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${idx}]`);
        voces.push(`[v${idx}]`);
        idx++;
    }
    const efectos = [];
    if (clic?.activo && clics.length) {
        // UNA sola entrada de clic, repartida con asplit: así `entradas` no crece con la
        // cantidad de pulsaciones y los índices que usa el montaje (subtítulos) son estables.
        entradas.push('-f', 'lavfi', '-t', '0.06', '-i', `aevalsrc=(random(0)*2-1)*exp(-t*90):s=48000:c=stereo`);
        const volumen = clic.volumen ?? 0.5;           // sin volumen, ffmpeg recibiría "undefined"
        const copias = clics.map((_, i) => `[cs${i}]`);
        filtros.push(`[${idx}:a]volume=${volumen},asplit=${clics.length}${copias.join('')}`);
        clics.forEach((t, i) => {
            const ms = Math.round(Math.max(0, t) * 1000);
            filtros.push(`[cs${i}]adelay=${ms}|${ms}[c${i}]`);
            efectos.push(`[c${i}]`);
        });
        idx++;
    }
    let vozMezclada = null;
    if (voces.length) {
        // apad hasta `total`: sidechaincompress se detiene cuando se acaba su llave, y sin
        // relleno la música se cortaba en seco al terminar la última locución. Además la
        // llave normalizada tiene un nivel conocido, así el umbral no depende del motor de voz.
        filtros.push(`${voces.join('')}amix=inputs=${voces.length}:normalize=0,` +
            `loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo,` +
            `apad=whole_dur=${total},asplit=2[voz][llave]`);
        vozMezclada = '[voz]';
    }
    let musicaFinal = null;
    if (musica) {
        entradas.push('-stream_loop', '-1', '-i', musica.archivo);
        filtros.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total},volume=${musica.volumen}[mus]`);
        idx++;
        if (musica.atenuar && vozMezclada) {
            // La llave es la voz ya normalizada (~-16 LUFS), así que estos valores dan una
            // atenuación estable de ~12 dB bajo la voz (medida en pruebas/mezcla.test.mjs);
            // con 0.03/8 quedaba en ~8 dB y la música competía con la locución.
            filtros.push(`[mus][llave]sidechaincompress=threshold=0.02:ratio=20:attack=20:release=400[musAt]`);
            musicaFinal = '[musAt]';
        } else {
            musicaFinal = '[mus]';
            if (vozMezclada) filtros.push('[llave]anullsink');
        }
    } else if (vozMezclada) {
        filtros.push('[llave]anullsink');
    }
    const partes = [base, ...(vozMezclada ? [vozMezclada] : []), ...(musicaFinal ? [musicaFinal] : []), ...efectos];
    // duration=first: el silencio base mide exactamente `total` y fija el largo de todo.
    // amix con normalize=0 suma sin bajar nada: voz + música alta + clic llegaban a 0 dBFS y
    // el AAC saturaba. El limitador corta a -1 dBFS; level=disabled porque su auto-nivel en
    // ffmpeg 7 volvería a actuar como control de ganancia sobre toda la mezcla.
    filtros.push(`${partes.join('')}amix=inputs=${partes.length}:normalize=0:duration=first,` +
        `alimiter=limit=0.891:level=disabled,aresample=48000[a]`);
    return { entradas, filtro: filtros.join(';'), salida: '[a]' };
}
