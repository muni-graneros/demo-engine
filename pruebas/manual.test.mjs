import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generarManual } from '../src/manual.mjs';
import { iniciarJuguete } from './juguete/servidor.mjs';
import { prepararSesiones } from '../src/sesiones.mjs';
import { grabar } from '../src/grabador.mjs';
import { crearVoz } from '../src/voz/index.mjs';

test('escribe md, html y pdf desde los pasos grabados', async () => {
    const salida = mkdtempSync(join(tmpdir(), 'demo-man-'));
    const { md, html, pdf } = await generarManual({
        guion: { id: 'curso', titulo: 'Curso completo' },
        pasos: [
            { escena: 'panel', titulo: 'El funcionario abre el panel', actor: 'funcionario',
              narrar: 'Abre el panel de solicitudes.', captura: null },
            { escena: 'detalle', titulo: 'Y entra al detalle', actor: 'funcionario',
              narrar: 'Entra al detalle.', captura: null },
        ],
        marca: { nombre: 'Sistema', color: '#1e3a8a' },
    }, { salida });

    assert.ok(existsSync(md) && existsSync(html) && existsSync(pdf));
    const texto = readFileSync(md, 'utf8');
    assert.match(texto, /# Curso completo/);
    assert.match(texto, /## El funcionario abre el panel/);
    assert.match(texto, /Abre el panel de solicitudes\./);
    assert.match(texto, /funcionario/);
});

test('la portada, el rol y el elenco salen en el HTML del manual', async () => {
    const salida = mkdtempSync(join(tmpdir(), 'demo-man-elenco-'));
    const { html } = await generarManual({
        guion: {
            id: 'atencion', titulo: 'La atención de las personas',
            subtitulo: 'Cómo se atiende a un vecino, paso a paso',
            rol: 'Manual de Oficina de Atención',
            elenco: [{ nombre: 'Carlos', rol: 'Vecino' }, { nombre: 'Paula', rol: 'Funcionaria de mesón' }],
        },
        pasos: [{ escena: 'x', titulo: 'Registrar', actor: 'funcionario', narrar: 'Se registra al vecino.', captura: null }],
        marca: { nombre: 'Municipalidad de Graneros', color: '#0e6b5c' },
    }, { salida });

    const h = readFileSync(html, 'utf8');
    assert.match(h, /class="portada"/);
    assert.match(h, /Cómo se atiende a un vecino/);
    assert.match(h, /Manual de Oficina de Atención/);
    assert.match(h, /class="elenco"/);
    assert.match(h, /Carlos/);
    assert.match(h, /Vecino/);
    assert.match(h, /Paula/);
});

test('la narración con HTML NO se inyecta en el manual: va escapada', async () => {
    const salida = mkdtempSync(join(tmpdir(), 'demo-man-xss-'));
    const { html } = await generarManual({
        guion: { id: 'x', titulo: '<script>alert(1)</script>' },
        pasos: [{
            escena: 'a', titulo: '<img src=x onerror=alert(2)>', actor: 'funcionario',
            narrar: '<script>alert(3)</script> texto normal', captura: null,
        }],
        marca: { nombre: '<b>Municipio</b>' },
    }, { salida });

    const h = readFileSync(html, 'utf8');
    assert.doesNotMatch(h, /<script>alert/);           // ninguna etiqueta <script> cruda del guion
    assert.doesNotMatch(h, /<img[^>]*onerror/);        // ni un <img onerror=...> crudo (el texto escapado sí puede contener "onerror")
    assert.match(h, /&lt;script&gt;alert\(3\)/);       // la narración quedó escapada
    assert.match(h, /texto normal/);
});

test('el manual sale con capturas: integración real de grabar() + generarManual()', async () => {
    // Defecto #4: grabador.mjs nunca escribía paso.captura, así que el manual salía siempre
    // de puro texto pese a que el README promete "manual con capturas". Este test usa los
    // módulos DE VERDAD (no pasos armados a mano) contra el sistema de juguete: es el que
    // habría atrapado el defecto, porque con pasos hechos a mano `captura` sale null y el
    // test de arriba nunca ejercita el camino que realmente los produce.
    const juguete = await iniciarJuguete({ puerto: 0 });
    // grabar() y generarManual() reciben la MISMA carpeta de salida, tal como hace cli.mjs
    // en producción (`config.salida` para ambos): así la ruta relativa que guarda el
    // grabador resuelve bien desde donde vive el .md.
    const salida = mkdtempSync(join(tmpdir(), 'demo-man-int-'));
    const dirSesiones = mkdtempSync(join(tmpdir(), 'demo-ses-'));
    try {
        const config = {
            baseURL: juguete.url,
            login: { url: '/', usuario: 'input[name=usuario]', clave: 'input[name=clave]', enviar: '#entrar' },
            actores: { funcionario: { email: 'f@x.cl', password: 'password' } },
            video: { ancho: 800, alto: 600, pausaMinima: 200 },
        };
        const sesiones = await prepararSesiones(config, { dirSesiones });
        const voz = crearVoz({ motor: 'ninguno', respaldo: 'ninguno' });

        const guion = {
            id: 'recorrido', titulo: 'Recorrido de prueba',
            escenas: [
                { id: 'panel', titulo: 'El funcionario abre el panel', pasos: [
                    { actor: 'funcionario', narrar: 'Abre el panel de solicitudes.',
                      hacer: async (page) => { await page.goto(`${juguete.url}/panel`); } },
                ] },
            ],
        };

        const { pasos } = await grabar(guion, { config, sesiones, salida, voz });
        assert.ok(pasos[0].captura, 'grabar() debe dejar la ruta de la captura en el paso');

        const { md } = await generarManual({ guion, pasos, marca: { nombre: 'Juguete' } }, { salida });

        const texto = readFileSync(md, 'utf8');
        assert.match(texto, /!\[.*\]\(.+\.png\)/, 'el markdown del manual debe traer al menos una imagen');

        const rutaCaptura = join(salida, pasos[0].captura);
        assert.ok(existsSync(rutaCaptura), `el PNG referenciado no existe en disco: ${rutaCaptura}`);
    } finally {
        await juguete.cerrar();
    }
});
