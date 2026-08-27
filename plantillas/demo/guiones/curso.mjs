/**
 * Curso maestro: encadena los capítulos en un solo video, en orden lógico. Cada `cap('id', ...)`
 * apunta a un guion `demo/guiones/<id>.mjs`. `demo curso` graba y encadena; `demo todo` hace
 * además el pack de contexto y el manual.
 *
 *   demo todo            (usa este archivo, id 'curso')
 *   demo curso           (solo el video)
 */
const cap = (guion, titulo) => ({ id: guion, guion, titulo });

const curso = {
    id: 'curso',
    titulo: 'Sistema — Recorrido completo',
    capitulos: [
        cap('ejemplo', 'Capítulo 1 · Un flujo del sistema'),
        // cap('otro-flujo', 'Capítulo 2 · Otro flujo'),
    ],
};
export default curso;
