import { strict as assert } from 'node:assert';
import test from 'node:test';

import { enmascararIdentificador, listaEnmascarada } from '../src/privacidad.mjs';

/**
 * El portero existe para el caso en que los datos NO son del seeder ficticio.
 *
 * Cuando encuentra más de un identificador en pantalla, escribía los RUT
 * completos a stdout y al mensaje del error. En CI, o en un `tee`, eso queda en
 * un log; y el portero se dispara justamente cuando algo salió mal y hay datos
 * reales a la vista, que es el momento en que menos conviene copiarlos a otro
 * sitio.
 *
 * Lo que hace falta para depurar es CUÁNTOS eran y poder reconocerlos si uno los
 * tiene delante, no el identificador entero.
 */
test('enmascara el RUT dejando lo justo para reconocerlo', () => {
    assert.equal(enmascararIdentificador('12.345.678-5'), '12.345.***-*');
});

test('funciona igual sin puntos', () => {
    assert.equal(enmascararIdentificador('12345678-5'), '12345***-*');
});

test('no revienta con algo que no parece un identificador', () => {
    assert.equal(enmascararIdentificador(''), '');
    assert.equal(enmascararIdentificador('x'), '*');
});

test('deja bastante para distinguir dos identificadores distintos', () => {
    // Contraprueba: enmascarar de más volvería el portero inútil, porque dos
    // personas distintas se verían iguales en el log.
    assert.notEqual(
        enmascararIdentificador('12.345.678-5'),
        enmascararIdentificador('9.876.543-2'),
    );
});

test('la lista enmascarada no contiene ningún identificador completo', () => {
    const salida = listaEnmascarada(['12.345.678-5', '9.876.543-2']);

    assert.ok(!salida.includes('12.345.678-5'), 'el RUT completo sigue saliendo');
    assert.ok(!salida.includes('9.876.543-2'), 'el RUT completo sigue saliendo');
    assert.ok(salida.includes('12.345.'), 'no queda nada con que reconocerlo');
});

test('con DEMO_DEPURAR se puede pedir el identificador completo', () => {
    // Depurar un falso positivo del portero exige ver qué encontró. Se pide a
    // propósito y no queda como comportamiento por omisión.
    const antes = process.env.DEMO_DEPURAR;
    process.env.DEMO_DEPURAR = '1';
    try {
        assert.ok(listaEnmascarada(['12.345.678-5']).includes('12.345.678-5'));
    } finally {
        if (antes === undefined) delete process.env.DEMO_DEPURAR;
        else process.env.DEMO_DEPURAR = antes;
    }
});
