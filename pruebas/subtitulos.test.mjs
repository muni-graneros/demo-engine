import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarVtt, generarSrt, parseVtt } from '../src/subtitulos.mjs';

const SEGMENTOS = [
    { inicioSeg: 0, finSeg: 4.5, narrar: 'El ciudadano envía su solicitud.' },
    { inicioSeg: 4.5, finSeg: 9, narrar: 'El funcionario la revisa.' },
    { inicioSeg: 9, finSeg: 12, narrar: undefined },
];

test('el VTT lleva cabecera y una entrada por locución', () => {
    const vtt = generarVtt(SEGMENTOS);
    assert.match(vtt, /^WEBVTT/);
    assert.equal((vtt.match(/-->/g) ?? []).length, 2, 'el segmento sin narración no genera entrada');
    assert.match(vtt, /00:00:00\.000 --> 00:00:04\.500/);
});

test('el SRT numera las entradas y usa coma decimal', () => {
    const srt = generarSrt(SEGMENTOS);
    assert.match(srt, /^1\n00:00:00,000 --> 00:00:04,500\nEl ciudadano envía su solicitud\./);
    assert.match(srt, /\n2\n/);
});

test('una hora larga se formatea con las horas correctas', () => {
    const vtt = generarVtt([{ inicioSeg: 3725.5, finSeg: 3727, narrar: 'Cierre.' }]);
    assert.match(vtt, /01:02:05\.500 --> 01:02:07\.000/);
});

test('los milisegundos acarrean en vez de producir un timestamp inválido', () => {
    // Redondear la fracción por separado da "00:00:59.1000" (cuatro dígitos), y el
    // navegador descarta esa cue EN SILENCIO: el subtítulo desaparece sin error.
    const vtt = generarVtt([
        { inicioSeg: 0, finSeg: 59.9999, narrar: 'Cruza el minuto.' },
        { inicioSeg: 3599.9996, finSeg: 3601, narrar: 'Cruza la hora.' },
    ]);
    assert.doesNotMatch(vtt, /\.\d{4}/, 'ningún timestamp puede tener cuatro dígitos de ms');
    assert.match(vtt, /00:00:00\.000 --> 00:01:00\.000/);
    assert.match(vtt, /01:00:00\.000 --> 01:00:01\.000/);

    const srt = generarSrt([{ inicioSeg: 59.9999, finSeg: 60.5, narrar: 'Cruza.' }]);
    assert.match(srt, /00:01:00,000 --> 00:01:00,500/);
});

test('parseVtt recupera las cues con sus tiempos y su texto', () => {
    const cues = parseVtt(generarVtt(SEGMENTOS));
    assert.equal(cues.length, 2, 'el segmento sin narración no genera cue');
    assert.deepEqual(cues[0], { inicioSeg: 0, finSeg: 4.5, narrar: 'El ciudadano envía su solicitud.' });
    assert.deepEqual(cues[1], { inicioSeg: 4.5, finSeg: 9, narrar: 'El funcionario la revisa.' });
});

test('parseVtt ignora la cabecera y los bloques sin marca de tiempo (NOTE, etc.)', () => {
    const cues = parseVtt('WEBVTT\n\nNOTE algo que no es una cue\n\n00:00:01.000 --> 00:00:02.000\nHola.\n');
    assert.equal(cues.length, 1);
    assert.equal(cues[0].narrar, 'Hola.');
});

test('parseVtt entiende horas de más de un dígito de reloj (curso largo)', () => {
    const cues = parseVtt('WEBVTT\n\n01:02:05.500 --> 01:02:07.000\nCierre.\n');
    assert.equal(cues[0].inicioSeg, 3725.5);
    assert.equal(cues[0].finSeg, 3727);
});

// C2 (G8-02): `generarVtt` escribía UN cue por paso con toda la locución (hasta 269
// caracteres en una sola línea): ilegible en cualquier reproductor. Ahora parte cada cue en
// frases y cada frase en bloques de a lo más 2 líneas de 42 caracteres, con el tiempo
// repartido en proporción al largo. Lógica portada de seguridad-graneros
// (tools/demo/subtitulos-legibles.mjs, a99bf657) con sus mismas pruebas.
import { ANCHO_SUBTITULO, partirCue, partirCues, cuesLargos, configurarSubtitulos } from '../src/subtitulos.mjs';

const LARGO = 'Vuelve a marcar «Cerrar sus sesiones de la app de terreno»: la app de ese teléfono se cierra. '
    + 'Ojo: con su contraseña podría volver a entrar. Si el teléfono no aparece, también se le quita el rol Patrullero.';

test('un cue que ya cabe se devuelve tal cual', () => {
    const cue = { inicioSeg: 1, finSeg: 3, narrar: 'Guarda, y queda en el historial.' };
    assert.deepEqual(partirCue(cue), [cue]);
});

test('un cue largo se parte en bloques de a lo más 2 líneas de 42 caracteres', () => {
    assert.equal(ANCHO_SUBTITULO, 42);
    const partidos = partirCue({ inicioSeg: 0, finSeg: 20, narrar: LARGO });
    assert.ok(partidos.length > 1);
    for (const { narrar } of partidos) {
        const lineas = narrar.split('\n');
        assert.ok(lineas.length <= 2, narrar);
        for (const linea of lineas) assert.ok(linea.length <= 42, `${linea.length}: ${linea}`);
    }
});

test('cubre el mismo intervalo, sin huecos ni solapes, y no pierde palabras', () => {
    const partidos = partirCue({ inicioSeg: 5, finSeg: 25, narrar: LARGO });
    assert.equal(partidos[0].inicioSeg, 5);
    assert.equal(partidos.at(-1).finSeg, 25);
    partidos.slice(1).forEach((cue, i) => assert.equal(cue.inicioSeg, partidos[i].finSeg));
    assert.equal(partidos.map((c) => c.narrar.replace(/\s+/g, ' ')).join(' '), LARGO);
});

test('el tiempo de cada bloque es proporcional a su largo', () => {
    const partidos = partirCue({ inicioSeg: 0, finSeg: 30, narrar: 'Corta. ' + 'Esta frase es bastante más larga que la otra.' });
    const [a, b] = partidos.map((c) => c.finSeg - c.inicioSeg);
    assert.ok(b > a * 3, `la frase larga debe durar más: ${a} vs ${b}`);
});

test('un bloque no cruza el final de una frase', () => {
    const partidos = partirCue({ inicioSeg: 0, finSeg: 10, narrar: 'Uno corto. Dos también. Tres igual de corto.' });
    assert.deepEqual(partidos.map((c) => c.narrar), ['Uno corto.', 'Dos también.', 'Tres igual de corto.']);
});

test('una palabra más larga que el ancho se corta en vez de desbordar', () => {
    const [cue] = partirCue({ inicioSeg: 0, finSeg: 1, narrar: 'x'.repeat(100) });
    assert.ok(cue.narrar.split('\n').every((linea) => linea.length <= 42));
});

test('generarVtt y generarSrt ya parten las locuciones largas: ningún cue pasa de 84 caracteres', () => {
    const segmentos = [{ inicioSeg: 0, finSeg: 20, narrar: LARGO }, { inicioSeg: 20, finSeg: 22, narrar: 'Listo.' }];
    const cues = parseVtt(generarVtt(segmentos));
    assert.ok(cues.length > 2, 'la locución larga debía partirse');
    assert.equal(cuesLargos(cues).length, 0);
    assert.equal(cues[0].inicioSeg, 0);
    assert.equal(cues.at(-1).finSeg, 22);
    const srt = generarSrt(segmentos);
    assert.equal((srt.match(/-->/g) ?? []).length, cues.length, 'el SRT (pista del MP4) parte igual que el VTT');
});

test('partir de nuevo un VTT ya partido no cambia nada (pegarCapitulos lo relee y reescribe)', () => {
    const una = generarVtt([{ inicioSeg: 0, finSeg: 20, narrar: LARGO }]);
    assert.equal(generarVtt(parseVtt(una)), una);
    assert.deepEqual(partirCues(parseVtt(una)), parseVtt(una));
});

test('partir:false conserva un cue por paso (compatibilidad), y el ancho/líneas se pueden cambiar', () => {
    const segmentos = [{ inicioSeg: 0, finSeg: 20, narrar: LARGO }];
    assert.equal((generarVtt(segmentos, { partir: false }).match(/-->/g) ?? []).length, 1);
    const angosto = parseVtt(generarVtt(segmentos, { ancho: 30, lineas: 1 }));
    assert.ok(angosto.every((c) => !c.narrar.includes('\n') && c.narrar.length <= 30));
});

test('configurarSubtitulos fija el defecto del proceso (lo llama cargarConfig) y se puede volver atrás', () => {
    const segmentos = [{ inicioSeg: 0, finSeg: 20, narrar: LARGO }];
    try {
        configurarSubtitulos({ partir: false });
        assert.equal((generarVtt(segmentos).match(/-->/g) ?? []).length, 1);
    } finally {
        configurarSubtitulos();
    }
    assert.ok((generarVtt(segmentos).match(/-->/g) ?? []).length > 1);
});
