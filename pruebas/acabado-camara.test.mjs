import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    puntoEnLienzo, encuadre, planDeCamara, estadoEn, hayCamaraEntre, expresionesPerspectiva, filtroPerspectiva,
} from '../src/acabado/camara.mjs';

const LIENZO = { ancho: 1920, alto: 1080 };
const cerca = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('puntoEnLienzo usa la geometría de componerEnLienzo (encaje sin deformar, centrado)', () => {
    // pista 1600x1000 en un hueco de 1600x900: escala 0.9, sobra 80 px a cada lado
    const p = puntoEnLienzo({ x: 800, y: 500 }, { hueco: { x: 100, y: 50, ancho: 1600, alto: 900 }, dim: { ancho: 1600, alto: 1000 } });
    cerca(p.x, 100 + 80 + 720, 1e-9, 'x');
    cerca(p.y, 50 + 450, 1e-9, 'y');
});

test('encuadre se corre para no mostrar fuera del lienzo', () => {
    const r = encuadre({ cx: 10, cy: 1070, zoom: 2 }, LIENZO);
    assert.deepEqual(r, { x: 0, y: 540, ancho: 960 });
});

test('un clic aislado: entra antes del clic, sostiene y sale dentro del encuadre', () => {
    const movs = planDeCamara({
        focos: [{ t: 5, x: 1500, y: 300, encuadre: 0 }],
        encuadres: [{ inicio: 0, fin: 20, camara: true }],
        lienzo: LIENZO, opciones: { zoom: 1.5 },
    });
    assert.equal(movs.length, 2, 'entrar y salir');
    assert.ok(movs[0].hasta <= 5, 'la cámara ya llegó cuando ocurre el clic');
    const enClic = estadoEn(movs, 5, LIENZO);
    cerca(enClic.ancho, 1280, 0.01, 'zoom 1.5');
    assert.ok(enClic.x <= 1500 && enClic.x + enClic.ancho >= 1500, 'el clic queda en cuadro');
    cerca(estadoEn(movs, 19.9, LIENZO).ancho, 1920, 0.01, 'al final volvió al plano completo');
});

test('nunca cruza el borde del encuadre acercada', () => {
    const movs = planDeCamara({
        focos: [{ t: 3.6, x: 900, y: 500, encuadre: 0 }],
        encuadres: [{ inicio: 0, fin: 4, camara: true }, { inicio: 4, fin: 10, camara: true }],
        lienzo: LIENZO,
    });
    cerca(estadoEn(movs, 4, LIENZO).ancho, 1920, 0.5, 'en el corte de plano está en reposo');
});

test('clics cercanos forman una sola toma con paseo, sin salir entre medio', () => {
    const movs = planDeCamara({
        focos: [{ t: 4, x: 400, y: 300, encuadre: 0 }, { t: 6, x: 1500, y: 800, encuadre: 0 }],
        encuadres: [{ inicio: 0, fin: 20, camara: true }],
        lienzo: LIENZO,
    });
    assert.equal(movs.length, 3, 'entrar, pasear, salir');
    assert.ok(estadoEn(movs, 5, LIENZO).ancho < 1920, 'entre los dos clics sigue acercada');
    const en6 = estadoEn(movs, 6, LIENZO);
    assert.ok(en6.x <= 1500 && en6.x + en6.ancho >= 1500, 'el segundo clic queda en cuadro');
});

test('un encuadre sin cámara (portada) ignora sus clics', () => {
    const movs = planDeCamara({
        focos: [{ t: 2, x: 900, y: 500, encuadre: 0 }],
        encuadres: [{ inicio: 0, fin: 5, camara: false }],
        lienzo: LIENZO,
    });
    assert.deepEqual(movs, []);
});

test('el teléfono usa su propio zoom', () => {
    const movs = planDeCamara({
        focos: [{ t: 3, x: 960, y: 500, encuadre: 0, telefono: true }],
        encuadres: [{ inicio: 0, fin: 10, camara: true }],
        lienzo: LIENZO, opciones: { zoomTelefono: 1.25 },
    });
    cerca(estadoEn(movs, 3, LIENZO).ancho, 1920 / 1.25, 0.01, 'zoom del teléfono');
});

test('ningún cuadro muestra fuera del lienzo', () => {
    const movs = planDeCamara({
        focos: [{ t: 2, x: 5, y: 5, encuadre: 0 }, { t: 4, x: 1915, y: 1075, encuadre: 0 }],
        encuadres: [{ inicio: 0, fin: 9, camara: true }],
        lienzo: LIENZO,
    });
    for (let t = 0; t <= 9; t += 0.05) {
        const r = estadoEn(movs, t, LIENZO);
        const alto = r.ancho * 1080 / 1920;
        assert.ok(r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.ancho <= 1920 + 1e-6 && r.y + alto <= 1080 + 1e-6, `t=${t}`);
    }
});

test('hayCamaraEntre distingue piezas quietas de piezas con cámara', () => {
    const movs = planDeCamara({
        focos: [{ t: 5, x: 900, y: 500, encuadre: 0 }],
        encuadres: [{ inicio: 0, fin: 20, camara: true }],
        lienzo: LIENZO,
    });
    assert.equal(hayCamaraEntre(movs, 0, 3, LIENZO), false);
    assert.equal(hayCamaraEntre(movs, 4, 6, LIENZO), true);
    assert.equal(hayCamaraEntre(movs, 5.5, 6, LIENZO), true, 'zoom sostenido sin movimiento también cuenta');
    assert.equal(hayCamaraEntre(movs, 12, 20, LIENZO), false);
});

/** Evalúa en JS una expresión de ffmpeg de las que arma expresionesPerspectiva. */
function evaluar(expr, n) {
    const js = expr.replace(/\bin\b/g, String(n)).replace(/clip\(/g, 'clipf(');
    // eslint-disable-next-line no-new-func
    return Function('clipf', `return ${js};`)((v, a, b) => Math.min(b, Math.max(a, v)));
}

test('las expresiones de perspective reproducen estadoEn, también con offset de pieza', () => {
    const movs = planDeCamara({
        focos: [{ t: 3, x: 400, y: 300, encuadre: 0 }, { t: 5, x: 1500, y: 800, encuadre: 0 }],
        encuadres: [{ inicio: 0, fin: 12, camara: true }],
        lienzo: LIENZO,
    });
    for (const offset of [0, 4.5]) {
        const expr = expresionesPerspectiva(movs, { offset, duracion: 6, fps: 60, lienzo: LIENZO });
        for (const n of [0, 30, 95, 200, 359]) {
            const t = offset + n / 60;
            const r = estadoEn(movs, t, LIENZO);
            cerca(evaluar(expr.x0, n), r.x, 0.05, `x0 t=${t}`);
            cerca(evaluar(expr.y0, n), r.y, 0.05, `y0 t=${t}`);
            cerca(evaluar(expr.x1, n), r.x + r.ancho, 0.05, `x1 t=${t}`);
            cerca(evaluar(expr.y2, n), r.y + r.ancho * 1080 / 1920, 0.05, `y2 t=${t}`);
        }
    }
    const filtro = filtroPerspectiva(expresionesPerspectiva(movs, { offset: 0, duracion: 6, fps: 60, lienzo: LIENZO }));
    assert.match(filtro, /^perspective=x0='.+':interpolation=cubic:eval=frame$/);
});
