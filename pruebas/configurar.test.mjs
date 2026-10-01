import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cargarConfig, ErrorConfig, superficieDe } from '../src/configurar.mjs';
import { PATRON_POR_DEFECTO } from '../src/auditoria.mjs';

function proyecto(config) {
    const dir = mkdtempSync(join(tmpdir(), 'demo-cfg-'));
    mkdirSync(join(dir, 'guiones'));
    writeFileSync(join(dir, 'demo.config.mjs'), `export default ${JSON.stringify(config)};`);
    return dir;
}

const minima = {
    baseURL: 'http://localhost:8031',
    marca: { nombre: 'Sistema' },
    actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
    guiones: './guiones',
    salida: './salida',
};

test('aplica los valores por defecto', async () => {
    const cfg = await cargarConfig(proyecto(minima));
    assert.equal(cfg.video.ancho, 1600);
    assert.equal(cfg.video.alto, 1000);
    assert.equal(cfg.video.pausaMinima, 350);
    assert.equal(cfg.voz.motor, 'kokoro');
    assert.equal(cfg.voz.respaldo, 'piper');
    assert.equal(cfg.voz.venv, null);
    assert.equal(cfg.voz.voces, null);
    assert.equal(cfg.marca.color, '#1e3a8a');
    // auditoria.ocr queda en null sin defecto: es un host, y el motor no puede adivinarlo
    // (ver src/auditoria.mjs). patron/cada/maximo sí traen un valor razonable.
    assert.equal(cfg.auditoria.ocr, null);
    // El literal vive duplicado en src/configurar.mjs (no se puede importar de
    // src/auditoria.mjs sin crear un ciclo — ver el comentario ahí). Este test compara
    // contra `PATRON_POR_DEFECTO`, la fuente de verdad, para que una futura edición que
    // toque un literal y se olvide del otro rompa acá en vez de divergir en silencio.
    assert.equal(cfg.auditoria.patron, PATRON_POR_DEFECTO);
    assert.equal(cfg.auditoria.cada, 10);
    assert.equal(cfg.auditoria.maximo, null, 'sin tope: demo auditar cubre el video entero');
    assert.equal(cfg.auditoria.token, null, 'el token es un secreto: nunca tiene defecto');
});

// El patrón por defecto quedó ANCLADO en v1.1.1 (ver src/auditoria.mjs,
// PATRON_POR_DEFECTO): antes de esto, `\d{7,8}-[\dkK]` sin anclar mordía dentro de
// cadenas más largas. Se verifica acá, contra el defecto REAL que sale de cargarConfig
// (no una copia del literal en el test), con el caso real reportado en la revisión de
// seguridad.
test('el patrón por defecto no confunde la cola de un número largo con un RUT completo', async () => {
    const cfg = await cargarConfig(proyecto(minima));
    const regex = new RegExp(cfg.auditoria.patron, 'g');

    assert.deepEqual(
        [...'numero de seguimiento: 9918039759-0'.matchAll(regex)].map((m) => m[0]),
        [],
        'un número de 10 dígitos no debe leerse como si terminara en un RUT de 8+1',
    );
    assert.deepEqual(
        [...'Folio 12345678-2024'.matchAll(regex)].map((m) => m[0]),
        [],
        'un folio "8 dígitos - año" no debe leerse como un RUT',
    );
    assert.deepEqual(
        [...'el RUT es 11111111-1'.matchAll(regex)].map((m) => m[0]),
        ['11111111-1'],
        'un RUT real, bien delimitado, sigue matcheando igual que siempre',
    );
});

test('auditoria se fusiona con sus defectos, sin pisar lo que no se declara', async () => {
    const dir = proyecto({ ...minima, auditoria: { ocr: 'http://127.0.0.1:8110/ocr', maximo: 5 } });
    const cfg = await cargarConfig(dir);
    assert.equal(cfg.auditoria.ocr, 'http://127.0.0.1:8110/ocr');
    assert.equal(cfg.auditoria.maximo, 5);
    assert.equal(cfg.auditoria.cada, 10, 'lo no declarado debe seguir viniendo del defecto');
});

test('voz.venv y voz.voces relativos se resuelven contra la raíz del proyecto', async () => {
    const dir = proyecto({ ...minima, voz: { venv: './mi-venv', voces: './mis-voces' } });
    const cfg = await cargarConfig(dir);
    assert.equal(cfg.voz.venv, resolve(dir, 'mi-venv'));
    assert.equal(cfg.voz.voces, resolve(dir, 'mis-voces'));
});

test('marca.escudo relativo se resuelve contra la raíz del proyecto, no contra el cwd del proceso', async () => {
    // Sin esto, `portada()` recibe una ruta relativa que solo existe si el CLI se invocó
    // justo desde la raíz del proyecto: bastaba con correr `demo` desde otra carpeta para
    // que "el archivo existe" diera falso y el escudo desapareciera en silencio.
    const dir = proyecto({ ...minima, marca: { nombre: 'Sistema', escudo: './public/escudo.png' } });
    const cfg = await cargarConfig(dir);
    assert.equal(cfg.marca.escudo, resolve(dir, 'public/escudo.png'));
});

test('marca.escudo ausente queda en null, como hoy', async () => {
    const cfg = await cargarConfig(proyecto(minima));
    assert.equal(cfg.marca.escudo, null);
});

test('falla si no hay actores, diciendo cuál es el problema', async () => {
    const dir = proyecto({ ...minima, actores: {} });
    await assert.rejects(() => cargarConfig(dir), (e) => {
        assert.ok(e instanceof ErrorConfig);
        assert.match(e.message, /actores/);
        return true;
    });
});

test('falla si un actor no trae email o password', async () => {
    const dir = proyecto({ ...minima, actores: { funcionario: { email: 'f@x.cl' } } });
    await assert.rejects(() => cargarConfig(dir), /funcionario.*password/);
});

// ── El aviso de contraseñas en claro ───────────────────────────────────────────
//
// La plantilla enseñaba `password: 'lo-que-sea'` y cuatro sistemas lo copiaron, así
// que la clave del actor terminaba versionada en git. Se arregló en los cinco, pero
// el arreglo no se sostiene solo: el próximo `demo init` copia la plantilla y el
// siguiente que agregue un actor escribe la clave en claro otra vez.
//
// Por eso el aviso vive acá, en la carga: es el único punto por el que pasan TODOS
// los consumidores. La comprobación es sobre el TEXTO del archivo y no sobre el
// valor cargado, que es la distinción que hace que esto sirva: en tiempo de
// ejecución `process.env.DEMO_CLAVE ?? 'password'` y un literal son indistinguibles
// —los dos son un string—, y lo que importa no es qué clave se usa sino si quedó
// escrita en el repositorio.

/** Escribe un demo.config.mjs con el TEXTO dado, sin pasar por JSON.stringify. */
function proyectoCrudo(fuente) {
    const dir = mkdtempSync(join(tmpdir(), 'demo-cfg-'));
    mkdirSync(join(dir, 'guiones'));
    writeFileSync(join(dir, 'demo.config.mjs'), fuente);
    return dir;
}

/** Corre `fn` capturando lo que se avise por console.warn. */
async function avisos(fn) {
    const original = console.warn;
    const capturado = [];
    console.warn = (...args) => capturado.push(args.join(' '));
    try {
        await fn();
    } finally {
        console.warn = original;
    }
    return capturado;
}

const fuenteCon = (linea) => `export default {
    baseURL: 'http://localhost:8031',
    marca: { nombre: 'Sistema' },
    guiones: './guiones',
    salida: './salida',
    actores: {
        funcionario: { email: 'f@x.cl', ${linea} },
    },
};
`;

test('avisa cuando la contraseña de un actor está escrita en claro en el archivo', async () => {
    const dir = proyectoCrudo(fuenteCon("password: 'Clave-Real-2026'"));

    const capturado = await avisos(() => cargarConfig(dir));

    assert.equal(capturado.length, 1, 'debía avisar exactamente una vez');
    assert.match(capturado[0], /demo\.config\.mjs:7/, 'el aviso debe decir dónde está');
    assert.match(capturado[0], /DEMO_CLAVE/, 'y debe decir cómo arreglarlo');
    assert.ok(
        !capturado[0].includes('Clave-Real-2026'),
        'el aviso NO puede imprimir la contraseña: sería filtrarla al log que se quería evitar',
    );
});

test('no avisa cuando la contraseña viene del entorno', async () => {
    const dir = proyectoCrudo(fuenteCon("password: process.env.DEMO_CLAVE ?? 'password'"));

    const capturado = await avisos(() => cargarConfig(dir));

    assert.deepEqual(capturado, [], 'el respaldo `password` del seeder no es una filtración');
});

test('no avisa por la contraseña del seeder ni por una línea comentada', async () => {
    // `'password'` es el valor que deja el seeder de demo en todos los sistemas: es
    // público, está en el repo del scaffold y no identifica ninguna cuenta real.
    // Avisar por él sería ruido, y el ruido es lo que hace que se ignore el aviso.
    const dir = proyectoCrudo(`export default {
    baseURL: 'http://localhost:8031',
    marca: { nombre: 'Sistema' },
    guiones: './guiones',
    salida: './salida',
    // Ejemplo para quien copie esto:
    //   password: 'la-que-sea',
    actores: {
        funcionario: { email: 'f@x.cl', password: 'password' },
    },
};
`);

    const capturado = await avisos(() => cargarConfig(dir));

    assert.deepEqual(capturado, []);
});

test('un selector CSS que menciona password no dispara el aviso', async () => {
    // El scaffold tiene `clave: 'input[wire\\:model="data.password"]'` para el
    // formulario de login. Confundirlo con una contraseña haría que el aviso saliera
    // en todos los sistemas siempre, que es la forma más rápida de que deje de leerse.
    const dir = proyectoCrudo(`export default {
    baseURL: 'http://localhost:8031',
    marca: { nombre: 'Sistema' },
    guiones: './guiones',
    salida: './salida',
    selectores: { clave: 'input[wire\\\\:model="data.password"]' },
    actores: {
        funcionario: { email: 'f@x.cl', password: process.env.DEMO_CLAVE ?? 'password' },
    },
};
`);

    const capturado = await avisos(() => cargarConfig(dir));

    assert.deepEqual(capturado, []);
});

test('falla si la carpeta de guiones no existe', async () => {
    const dir = proyecto({ ...minima, guiones: './no-existe' });
    await assert.rejects(() => cargarConfig(dir), /guiones/);
});

test('falla si baseURL no es una URL', async () => {
    const dir = proyecto({ ...minima, baseURL: 'localhost:8031' });
    await assert.rejects(() => cargarConfig(dir), /baseURL/);
});

test('el ritmo por defecto es el ágil: un proyecto nuevo no hereda pausas muertas', async () => {
    const cfg = await cargarConfig(proyecto(minima));

    // Estos tres números son el resultado de una medición, no una preferencia: con
    // los valores viejos (1200 / 550 / 1) el mismo tutorial duraba 7:28 y con estos
    // 3:13, sin sacar una sola escena. Más de la mitad eran huecos.
    //
    // Se fijan en una prueba para que devolverlos a los lentos tenga que ser una
    // decisión explícita de alguien, y no el efecto de un merge distraído.
    assert.ok(cfg.video.pausaMinima <= 400,
        `la pausa mínima por defecto debe ser ágil y es ${cfg.video.pausaMinima} ms`);
    assert.ok(cfg.video.msCursor <= 300,
        `el viaje del puntero por defecto debe ser ágil y es ${cfg.video.msCursor} ms`);
    assert.ok(cfg.voz.velocidad > 1,
        `la locución por defecto debe ir por encima de la velocidad natural y va a ${cfg.voz.velocidad}`);
});

test('un tutorial que quiera ir pausado puede pedirlo, y se respeta', async () => {
    // El defecto ágil no puede convertirse en una imposición: una capacitación
    // larga sí quiere aire entre paso y paso.
    const cfg = await cargarConfig(proyecto({
        ...minima,
        video: { pausaMinima: 1800, msCursor: 700 },
        voz: { velocidad: 0.95 },
    }));

    assert.equal(cfg.video.pausaMinima, 1800);
    assert.equal(cfg.video.msCursor, 700);
    assert.equal(cfg.voz.velocidad, 0.95);
});

test('la version declarada en package.json coincide con el ultimo tag publicado', async () => {
    // Se publicaron cinco versiones seguidas sin tocar este campo: el tarball de
    // v1.6.0 traía adentro `"version": "1.1.2"`, y quien lo instalaba y verificaba
    // creía tener una versión vieja. Un tag no actualiza el package.json solo.
    const { execFileSync } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');

    const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
    const declarada = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8')).version;
    const ultimoTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: raiz, encoding: 'utf8' }).trim();

    assert.equal(`v${declarada}`, ultimoTag,
        `package.json dice ${declarada} y el último tag es ${ultimoTag}: uno de los dos quedó atrás`);
});

test('presentacion queda en null si el proyecto no la declara', async () => {
    const cfg = await cargarConfig(proyecto(minima));
    assert.equal(cfg.video.presentacion, null);
});

test('presentacion aplica sus defectos cuando el bloque existe', async () => {
    const cfg = await cargarConfig(proyecto({ ...minima, video: { presentacion: { padding: 120 } } }));
    const p = cfg.video.presentacion;
    assert.equal(p.padding, 120);          // lo declarado gana
    assert.equal(p.radio, 16);             // el resto viene del defecto
    assert.equal(p.sombra, true);
    assert.equal(p.barra, true);
    assert.equal(p.fondo, null);           // null = derivar de marca.color
    assert.deepEqual(p.salida, { ancho: 1920, alto: 1080 });
    assert.deepEqual(p.transicion3d, { activa: true, ms: 900, gradosMax: 12 });
    // declarar presentacion no debe pisar ancho/alto de grabación
    assert.equal(cfg.video.ancho, 1600);
    assert.equal(cfg.video.alto, 1000);
});

test('presentacion respeta un sub-bloque parcial de transicion3d', async () => {
    const cfg = await cargarConfig(proyecto({
        ...minima, video: { presentacion: { transicion3d: { activa: false } } },
    }));
    assert.equal(cfg.video.presentacion.transicion3d.activa, false);
    assert.equal(cfg.video.presentacion.transicion3d.ms, 900);
});

// ---------------------------------------------------------------------------------
// Superficies, actores con dispositivo y audio (tutoriales multi-superficie).
//
// Un tutorial que cruza escritorio, teléfono y APK necesita que la config diga en qué
// superficie y dispositivo vive cada actor, y admitir actores sin cuenta (el vecino
// anónimo o la app que se loguea dentro del guion). Todo es opt-in: una config de 1.13
// debe cargar igual que antes.
// ---------------------------------------------------------------------------------

/** Config cruda con la carpeta de guiones del helper ya declarada. */
const conGuiones = (cuerpo) => proyectoCrudo(`export default { guiones:'./guiones', ${cuerpo} };`);

test('sin superficies ni audio, la config queda como en 1.13 (compatibilidad)', async () => {
    const c = await cargarConfig(conGuiones(`baseURL:'http://localhost:8000',
        marca:{nombre:'M'}, actores:{ a:{email:'a@x', password:'password'} }`));
    assert.equal(c.superficies, null);
    assert.deepEqual(c.flujo, []);
    assert.deepEqual(c.audio, { musica: null, clic: { activo: false, volumen: 0.5 } });
    assert.equal(c.actores.a.sesion, true);
    assert.equal(superficieDe(c, 'a'), null);
});

test('actor sesion:false no exige email ni password', async () => {
    const c = await cargarConfig(conGuiones(`baseURL:'http://localhost:8000',
        marca:{nombre:'M'}, actores:{ vecina:{ sesion:false } }`));
    assert.equal(c.actores.vecina.sesion, false);
});

test('superficie desconocida, dispositivo inexistente y baseURL inválida fallan con mensaje claro', async () => {
    const base = (actor) => conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'},
        superficies:{ sala:{ nombre:'Sala', tipo:'escritorio' } }, actores:{ x:${actor} }`);
    await assert.rejects(cargarConfig(base(`{sesion:false, superficie:'nada'}`)), /superficie "nada"/);
    await assert.rejects(cargarConfig(base(`{sesion:false, dispositivo:'Nokia 3310'}`)), /dispositivo "Nokia 3310"/);
    await assert.rejects(cargarConfig(base(`{sesion:false, baseURL:'ftp://x'}`)), /baseURL del actor "x"/);
});

test('superficie con tipo inválido o sin nombre falla', async () => {
    const con = (s) => conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'},
        superficies:{ s:${s} }, actores:{ x:{sesion:false} }`);
    await assert.rejects(cargarConfig(con(`{ nombre:'S', tipo:'tablet' }`)), /tipo "tablet"/);
    await assert.rejects(cargarConfig(con(`{ tipo:'telefono' }`)), /superficie "s" no trae nombre/);
});

test('superficies reciben defectos de ícono y color, y superficieDe las resuelve por actor', async () => {
    const c = await cargarConfig(conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M', color:'#123456'},
        superficies:{ apk:{ nombre:'App del patrullero · Android', tipo:'telefono' } },
        flujo:[['apk','apk']], actores:{ p:{ sesion:false, superficie:'apk', dispositivo:'Pixel 7' } }`));
    assert.deepEqual(superficieDe(c, 'p'), { id:'apk', nombre:'App del patrullero · Android', tipo:'telefono', icono:'phone', color:'#123456' });
});

test('flujo con una superficie inexistente falla', async () => {
    await assert.rejects(cargarConfig(conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'},
        superficies:{ a:{nombre:'A', tipo:'escritorio'} }, flujo:[['a','b']], actores:{ x:{sesion:false} }`)), /flujo.*"b"/);
});

test('Review Focus #4: audio.musica.archivo inexistente es error de config', async () => {
    await assert.rejects(cargarConfig(conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'},
        actores:{ x:{sesion:false} }, audio:{ musica:{ archivo:'./no-existe.mp3' } }`)), /audio\.musica\.archivo/);
});

test('audio.musica existente recibe ruta absoluta y defectos de volumen y atenuación', async () => {
    const dir = conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'},
        actores:{ x:{sesion:false} }, audio:{ musica:{ archivo:'./fondo.mp3' }, clic:{ activo:true } }`);
    writeFileSync(join(dir, 'fondo.mp3'), '');
    const c = await cargarConfig(dir);
    assert.deepEqual(c.audio, { musica: { archivo: join(dir, 'fondo.mp3'), volumen: 0.12, atenuar: true }, clic: { activo: true, volumen: 0.5 } });
});

test('presentacion recibe mapaMs por defecto', async () => {
    const c = await cargarConfig(conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'},
        actores:{ x:{sesion:false} }, video:{ presentacion:{} }`));
    assert.equal(c.video.presentacion.mapaMs, 2500);
});

test('audio.musica sin archivo, como string o apuntando a una carpeta es error de config', async () => {
    const con = (musica) => conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'},
        actores:{ x:{sesion:false} }, audio:{ musica:${musica} }`);
    await assert.rejects(cargarConfig(con(`{}`)), /audio\.musica\.archivo es obligatorio/);
    await assert.rejects(cargarConfig(con(`{ volumen:0.2 }`)), /audio\.musica\.archivo es obligatorio/);
    await assert.rejects(cargarConfig(con(`'./x.mp3'`)), /audio\.musica\.archivo es obligatorio/);
    await assert.rejects(cargarConfig(con(`{ archivo:'./' }`)), /audio\.musica\.archivo no existe/);
});

test('flujo que no es una lista de pares falla con mensaje claro', async () => {
    const con = (flujo) => conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'},
        superficies:{ a:{nombre:'A', tipo:'escritorio'} }, flujo:${flujo}, actores:{ x:{sesion:false} }`);
    await assert.rejects(cargarConfig(con(`'a>b'`)), /flujo debe ser una lista de pares/);
    await assert.rejects(cargarConfig(con(`[['a']]`)), /flujo debe ser una lista de pares/);
});

test('baseURL por actor solo con sesion:false: la sesión se prepara contra la baseURL global', async () => {
    const con = (actor) => conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'}, actores:{ x:${actor} }`);
    await assert.rejects(cargarConfig(con(`{ email:'a@b.cl', password:process.env.X ?? 'p', baseURL:'http://localhost:9000' }`)),
        /baseURL por actor solo se admite con sesion:false/);
    const c = await cargarConfig(con(`{ sesion:false, baseURL:'http://localhost:9000' }`));
    assert.equal(c.actores.x.baseURL, 'http://localhost:9000');
});

test('el color de una superficie se valida como hexadecimal al cargar la config', async () => {
    const con = (color) => conGuiones(`baseURL:'http://localhost:8000', marca:{nombre:'M'},
        superficies:{ s:{ nombre:'S', tipo:'escritorio', color:${JSON.stringify(color)} } }, actores:{ x:{sesion:false} }`);
    await assert.rejects(cargarConfig(con('rgb(1,2,3)')), (e) => e instanceof ErrorConfig && /superficies\.s\.color debe ser hexadecimal/.test(e.message));
    await assert.rejects(cargarConfig(con('red')), /hexadecimal/);
    const c = await cargarConfig(con('#ABC'));
    assert.equal(c.superficies.s.color, '#aabbcc');
});

// C2, C9, D96 (1.15): bloques nuevos, todos opcionales y con defecto.
import { generarVtt } from '../src/subtitulos.mjs';

test('subtitulos: por defecto parte en 2 líneas de 42; se puede apagar o cambiar, y se valida', async () => {
    const largo = 'Una locución larga de verdad que no cabe en una sola línea de subtítulo. Y otra frase más.';
    const cfg = await cargarConfig(proyecto(minima));
    assert.deepEqual(cfg.subtitulos, { partir: true, ancho: 42, lineas: 2 });
    assert.ok((generarVtt([{ inicioSeg: 0, finSeg: 5, narrar: largo }]).match(/-->/g) ?? []).length > 1);

    const apagado = await cargarConfig(proyecto({ ...minima, subtitulos: { partir: false } }));
    assert.equal(apagado.subtitulos.partir, false);
    assert.equal((generarVtt([{ inicioSeg: 0, finSeg: 5, narrar: largo }]).match(/-->/g) ?? []).length, 1,
        'cargarConfig aplica la config al generador de subtítulos del proceso');

    await cargarConfig(proyecto(minima)); // vuelve al defecto para el resto de la suite
    for (const malo of [{ ancho: 0 }, { lineas: 1.5 }, { partir: 'no' }, 'x']) {
        await assert.rejects(cargarConfig(proyecto({ ...minima, subtitulos: malo })), ErrorConfig, JSON.stringify(malo));
    }
});

test('navegador.args: por defecto vacío; acepta banderas de Chromium y rechaza lo que no lo es', async () => {
    const cfg = await cargarConfig(proyecto(minima));
    assert.deepEqual(cfg.navegador, { args: [], idioma: 'es-CL', canal: 'chromium' });

    const reglas = '--host-resolver-rules=MAP seguridad.municipalidadgraneros.cl 127.0.0.1';
    const con = await cargarConfig(proyecto({ ...minima, navegador: { args: [reglas] } }));
    assert.deepEqual(con.navegador.args, [reglas]);

    for (const malo of [{ args: '--x' }, { args: ['sin-guiones'] }, { args: [3] }, { args: [''] }]) {
        await assert.rejects(cargarConfig(proyecto({ ...minima, navegador: malo })), ErrorConfig, JSON.stringify(malo));
    }
});

test('tactil: se valida como booleano en superficie y actor, y actorTactil decide por dispositivo si no se declara', async () => {
    const { actorTactil } = await import('../src/contexto-actor.mjs');
    const cfg = await cargarConfig(proyecto({
        ...minima,
        superficies: {
            apk: { nombre: 'APK', tipo: 'telefono' },
            kiosco: { nombre: 'Kiosco', tipo: 'escritorio', tactil: true },
            web: { nombre: 'Web móvil', tipo: 'telefono', tactil: false },
        },
        actores: {
            funcionario: { email: 'f@x.cl', password: 'password' },
            patrullero: { sesion: false, dispositivo: 'Pixel 7', superficie: 'apk' },
            kiosco: { sesion: false, superficie: 'kiosco' },
            vecina: { sesion: false, dispositivo: 'Pixel 7', superficie: 'web' },
            forzado: { sesion: false, dispositivo: 'Pixel 7', superficie: 'web', tactil: true },
        },
    }));
    assert.equal(actorTactil(cfg, 'funcionario'), false, 'escritorio sin declarar: flecha, como siempre');
    assert.equal(actorTactil(cfg, 'patrullero'), true, 'dispositivo táctil sin declarar: toque');
    assert.equal(actorTactil(cfg, 'kiosco'), true, 'la superficie lo declara');
    assert.equal(actorTactil(cfg, 'vecina'), false, 'la superficie lo apaga aunque el dispositivo sea táctil');
    assert.equal(actorTactil(cfg, 'forzado'), true, 'el actor manda sobre su superficie');

    await assert.rejects(cargarConfig(proyecto({ ...minima, superficies: { a: { nombre: 'A', tipo: 'telefono', tactil: 'si' } } })), ErrorConfig);
    await assert.rejects(cargarConfig(proyecto({ ...minima, actores: { f: { sesion: false, tactil: 1 } } })), ErrorConfig);
});

test('video.cursorEnCapturas: por defecto true (como siempre) y se valida', async () => {
    assert.equal((await cargarConfig(proyecto(minima))).video.cursorEnCapturas, true);
    assert.equal((await cargarConfig(proyecto({ ...minima, video: { cursorEnCapturas: false } }))).video.cursorEnCapturas, false);
    await assert.rejects(cargarConfig(proyecto({ ...minima, video: { cursorEnCapturas: 'no' } })), ErrorConfig);
});

test('navegador.args: --host-resolver-rules solo puede mapear a loopback (no desviar el guardián de entorno)', async () => {
    // El guardián decide por el host de baseURL. Una regla que mande `localhost` (u otro
    // nombre) a otra máquina lo burlaría: se graba contra lo que diga la regla, no el host.
    const ok = ['--host-resolver-rules=MAP seguridad.municipalidadgraneros.cl 127.0.0.1:8071, MAP *.graneros.cl localhost, EXCLUDE x.cl'];
    assert.deepEqual((await cargarConfig(proyecto({ ...minima, navegador: { args: ok } }))).navegador.args, ok);
    for (const malo of ['--host-resolver-rules=MAP localhost 10.0.0.5', '--host-resolver-rules=MAP * 190.1.2.3', '--host-resolver-rules=REMAP x']) {
        await assert.rejects(cargarConfig(proyecto({ ...minima, navegador: { args: [malo] } })), ErrorConfig, malo);
    }
});

test('superficies.<id>.presentar y video.presentacion.textoAqui se validan al cargar, no a mitad de la grabación', async () => {
    const sup = (presentar) => ({ ...minima, superficies: { apk: { nombre: 'APK', tipo: 'telefono', presentar } } });
    const ok = await cargarConfig(proyecto(sup({ posicion: 'arriba-derecha', evitar: ['#panico'] })));
    assert.deepEqual(ok.superficies.apk.presentar, { posicion: 'arriba-derecha', evitar: ['#panico'] });
    await assert.rejects(cargarConfig(proyecto(sup({ posicion: 'al-medio' }))), /superficies\.apk\.presentar/);
    await assert.rejects(cargarConfig(proyecto(sup('arriba'))), /superficies\.apk\.presentar/);
    await assert.rejects(cargarConfig(proyecto(sup({ evitar: '#panico' }))), /superficies\.apk\.presentar/);

    const conTexto = (textoAqui) => ({ ...minima, video: { presentacion: { textoAqui } } });
    assert.equal((await cargarConfig(proyecto(conTexto('Usted está aquí')))).video.presentacion.textoAqui, 'Usted está aquí');
    assert.equal((await cargarConfig(proyecto({ ...minima, video: { presentacion: {} } }))).video.presentacion.textoAqui, null);
    await assert.rejects(cargarConfig(proyecto(conTexto(''))), /textoAqui/);
});
