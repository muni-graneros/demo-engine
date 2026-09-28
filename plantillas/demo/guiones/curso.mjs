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
        // Con `superficies` en demo.config.mjs, el curso puede abrir con el mapa completo
        // (sin resaltar) y cada capítulo declarar en qué superficie ocurre:
        // { id: 'mapa', titulo: 'El mapa', tipo: 'mapa', narrar: 'Estas son las partes del sistema y quién usa cada una.' },
        // { ...cap('denuncia', 'Capítulo 2 · La vecina avisa'), superficie: 'vecino' },
        // { id: 'terreno', titulo: 'En terreno', fuente: 'video', archivo: 'demo/clips/terreno.mp4', superficie: 'apk' },
        cap('ejemplo', 'Capítulo 1 · Un flujo del sistema'),
        // cap('otro-flujo', 'Capítulo 2 · Otro flujo'),
    ],
};
export default curso;
