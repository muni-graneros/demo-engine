import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cargarConfig, ErrorConfig } from '../src/configurar.mjs';
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
    assert.equal(cfg.video.pausaMinima, 1200);
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
    assert.equal(cfg.auditoria.maximo, 20);
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

test('falla si la carpeta de guiones no existe', async () => {
    const dir = proyecto({ ...minima, guiones: './no-existe' });
    await assert.rejects(() => cargarConfig(dir), /guiones/);
});

test('falla si baseURL no es una URL', async () => {
    const dir = proyecto({ ...minima, baseURL: 'localhost:8031' });
    await assert.rejects(() => cargarConfig(dir), /baseURL/);
});
