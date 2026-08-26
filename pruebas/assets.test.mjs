import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imagenComoDataUri } from '../src/assets.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
);

test('incrusta una imagen que está DENTRO del proyecto', () => {
    const dentro = join(process.cwd(), 'pruebas', 'tmp-asset.png');
    writeFileSync(dentro, PNG_1x1);
    try {
        assert.match(imagenComoDataUri(dentro), /^data:image\/png;base64,/);
    } finally {
        rmSync(dentro, { force: true });
    }
});

test('rechaza (null) una imagen FUERA del proyecto', () => {
    const fuera = join(tmpdir(), `demo-fuera-${process.pid}.png`);
    writeFileSync(fuera, PNG_1x1);
    try {
        assert.equal(imagenComoDataUri(fuera), null);
    } finally {
        rmSync(fuera, { force: true });
    }
});

test('rechaza lo que no es imagen y las rutas que se escapan del proyecto', () => {
    assert.equal(imagenComoDataUri('package.json'), null);          // dentro, pero no es imagen
    assert.equal(imagenComoDataUri('../../../../etc/hostname'), null); // fuera / traversal
    assert.equal(imagenComoDataUri(null), null);
    assert.equal(imagenComoDataUri('no-existe.png'), null);
});
