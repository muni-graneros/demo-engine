// El CI corre la suite en la línea Node que declare, y esa línea envejece.
//
// Node 20 quedó EOL y no recibe los parches de seguridad de octubre de 2026 (los que
// corrigieron CVE-2026-111497, Brotli, y otros). Un workflow que siga en `20` corre código
// sin los parches que el resto del mundo ya tiene, y el fallo aparece como una vulnerabilidad
// explotable, no como un job rojo: por eso el requisito se comprueba con una prueba y no
// con la buena voluntad de quien edita el YAML.
//
// La comprobación es sobre el TEXTO del workflow, no sobre un YAML parseado: el paquete no
// tiene parser de YAML como dependencia y meter uno solo para leer una línea sería más
// superficie que el problema. Se acepta cualquier forma válida de `node-version` (comillas
// o no) y se exige que todas las que aparezcan en `.github/workflows/` sean la misma versión
// objetivo: si aparece una línea nueva con otra versión, la prueba lo avisa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION_NODE = '24';

function versionesDeclaradas() {
    const carpeta = join(raiz, '.github', 'workflows');
    const declaradas = [];

    for (const archivo of readdirSync(carpeta)) {
        if (!archivo.endsWith('.yml') && !archivo.endsWith('.yaml')) continue;

        const texto = readFileSync(join(carpeta, archivo), 'utf8');
        for (const linea of texto.split('\n')) {
            const coincidencia = linea.match(/node-version:\s*['"]?([^'"\s#]+)/);
            if (coincidencia) declaradas.push({ workflow: archivo, version: coincidencia[1] });
        }
    }

    return declaradas;
}

test('todos los workflows del CI corren en Node 24', () => {
    const declaradas = versionesDeclaradas();

    assert.ok(declaradas.length > 0, 'no se encontró ningún node-version en .github/workflows/');
    for (const { workflow, version } of declaradas) {
        assert.equal(
            version,
            VERSION_NODE,
            `${workflow} declara node-version ${version}; la línea ${version} está EOL o no es la línea soportada`,
        );
    }
});

test('package.json exige Node 24 en engines', () => {
    const paquete = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'));

    assert.equal(paquete.engines?.node, `>=${VERSION_NODE}`);
});
