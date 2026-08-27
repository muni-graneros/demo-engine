# Plantillas de guion (estilo explainer con elenco)

Copiar y adaptar. Requiere demo-engine ≥ v1.8.0 (helpers `elenco`, `presentar`, `anotar`, y
manual con portada+elenco).

## 1. El elenco, definido una vez — `demo/guiones/_elenco.mjs`

```js
// El reparto del sistema. Fotos IA ficticias en demo/assets/ (un retrato por personaje,
// reusado). Se usa en las portadas, en los lower-thirds y en los manuales.
export const CAST = {
    vecino:       { nombre: 'Carlos',  rol: 'Vecino',                    foto: './demo/assets/carlos.png' },
    funcionaria:  { nombre: 'Paula',   rol: 'Funcionaria de mesón',      foto: './demo/assets/paula.png' },
    coordinador:  { nombre: 'Diego',   rol: 'Coordinador de discapacidad',foto: './demo/assets/diego.png' },
    admin:        { nombre: 'Marta',   rol: 'Administradora',            foto: './demo/assets/marta.png' },
};
export const ELENCO = Object.values(CAST);
```

## 2. Capítulo tipo — `demo/guiones/<area>.mjs`

```js
import { portada, cierre, elenco, presentar, quitarPresentacion, anotar, acercarA, alejar } from 'demo-engine';
import { CAST, ELENCO } from './_elenco.mjs';
// import { ir, exigirEnPantalla } from './_comun.mjs';  // helpers propios del sistema

const MARCA = { nombre: 'Municipalidad de Graneros', color: '#0e6b5c', escudo: './public/images/logo-graneros.png' };

export default {
    id: 'atencion',
    titulo: 'La atención de las personas',
    subtitulo: 'Agendar, atender y registrar, paso a paso',  // → bajada del manual
    rol: 'Manual de Oficina de Atención',                     // → chip del manual
    elenco: ELENCO,                                           // → página de elenco del manual
    escenas: [
        // Portada de capítulo con marca
        { id: 'portada', titulo: 'Portada', pasos: [{ actor: 'funcionario', hacer: async (page) => {
            await portada(page, { capitulo: 'Sistema · SIREDIC', titulo: 'La atención de las personas',
                subtitulo: 'Agendar, atender y registrar', marca: MARCA });
        }}]},

        // (Solo el primer capítulo del curso) presentar al elenco:
        // { id:'elenco', titulo:'Elenco', pasos:[{ actor:'funcionario', hacer: async (page) =>
        //     await elenco(page, { titulo:'Quiénes usan SIREDIC', cast: ELENCO, marca: MARCA }) }]},

        // Una tarea = una escena. Lower-third de quién actúa + resaltar lo clave.
        { id: 'agendar', titulo: 'Agendar una cita', pasos: [{
            actor: 'funcionario',
            narrar: 'Paula elige a la persona, la fecha y la hora, y deja el motivo. La cita queda agendada.',
            hacer: async (page) => {
                await presentar(page, { ...CAST.funcionaria });          // lower-third: Paula
                // await ir(page, '/panel/citas/create'); … llenar … crear …
                await anotar(page, '#form\\.fecha', 'Acá va la fecha de la cita');  // resaltar
                // await exigirEnPantalla(page, 'Cita agendada');        // el mensaje REAL cierra la escena
                await quitarPresentacion(page);
            },
        }]},

        { id: 'cierre', titulo: 'Cierre', pasos: [{ actor: 'funcionario', hacer: async (page) => {
            await alejar(page).catch(() => {});
            await cierre(page, { mensaje: 'Agendar, atender y registrar: la atención, de punta a punta.', marca: MARCA });
        }}]},
    ],
};
```

## 3. Curso maestro — `demo/guiones/curso.mjs`

```js
const base = './docs/manual/<salida>';
const cap = (id, titulo) => ({ id, titulo, fuente: 'video', archivo: `${base}/${id}.mp4` });

export default {
    id: 'curso',
    titulo: '<Sistema> — recorrido completo',
    capitulos: [
        // Orden por recorrido real: público → captura (terreno) → gestión → derechos → admin.
        cap('acceso',   'Capítulo 1 · Entrar al sistema'),
        cap('front',    'Capítulo 2 · La App de atención (terreno)'),
        cap('personas', 'Capítulo 3 · El registro de personas'),
        cap('atencion', 'Capítulo 4 · La atención'),
        cap('reportes', 'Capítulo 5 · Reportes y tablero'),
        cap('privacidad','Capítulo 6 · Derechos del vecino (ARCOP)'),
        cap('roles',    'Capítulo 7 · Usuarios y roles'),
        cap('admin',    'Capítulo 8 · Administración'),
    ],
};
```

## 4. Producir

```bash
# por capítulo (con su setup: datos ficticios, MFA/OCR/SSO según toque)
npx demo grabar <area>          # → video del capítulo
npx demo manual <area>          # → manual PDF del capítulo (portada + elenco + pasos)
# el curso completo (video)
npx demo curso                  # pega los capítulos pregrabados
npx demo auditar <area|curso>   # portero OCR: 0 frames con PII real
```

Los retratos del elenco (`demo/assets/*.png`) se generan una vez con IA (ficticios, un retrato por
personaje) y se reusan. Si falta una foto, el motor cae a la inicial del nombre (no rompe).
