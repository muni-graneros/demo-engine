import { portada, cierre, elenco, presentar, quitarPresentacion } from 'demo-engine';
import { MARCA, CLIENTE, FUNCIONARIA } from './_elenco.mjs';
import { tipear, esperarAviso } from './_ui.mjs';

/**
 * Capítulo de EJEMPLO. Muestra el patrón: portada → elenco → un flujo real (con datos que se
 * TECLEAN a la vista y una notificación al final) → cierre. Copia este archivo por cada flujo.
 *
 * Grábalo con:  demo grabar ejemplo
 */
const ejemplo = {
    id: 'ejemplo',
    titulo: 'Un flujo del sistema',
    elenco: [CLIENTE, FUNCIONARIA],
    escenas: [
        {
            id: 'portada', titulo: 'Portada',
            pasos: [{ actor: 'funcionario',
                narrar: 'Veamos cómo funciona este flujo del sistema, paso a paso.',
                hacer: async (page) => {
                    await page.goto('about:blank');
                    await portada(page, { capitulo: 'Sistema', titulo: 'Un flujo del sistema', subtitulo: 'De principio a fin', marca: MARCA });
                } }],
        },
        {
            id: 'elenco', titulo: 'Quiénes participan',
            pasos: [{ actor: 'funcionario',
                narrar: 'Acompañamos a Carlos, que usa el servicio, y a Paula, que lo atiende.',
                hacer: async (page) => { await elenco(page, { cast: [CLIENTE, FUNCIONARIA], titulo: 'Quiénes participan', marca: MARCA }); } }],
        },
        {
            id: 'accion', titulo: 'La acción principal',
            pasos: [{ actor: 'funcionario',
                narrar: 'Paula abre el formulario y escribe los datos, a la vista, y guarda. El sistema confirma.',
                hacer: async (page, { config }) => {
                    await page.goto(`${config.baseURL}/`); // <-- cambia a la URL real del flujo
                    await page.waitForLoadState('networkidle').catch(() => {});
                    await presentar(page, FUNCIONARIA);
                    // await tipear(page, 'input[name=nombre]', 'Rosa Elena');   // teclea a la vista
                    // await page.locator('button:has-text("Guardar")').click();
                    // await esperarAviso(page);                                  // muestra la notificación
                    await page.waitForTimeout(1500);
                    await quitarPresentacion(page);
                } }],
        },
        {
            id: 'cierre', titulo: 'Cierre',
            pasos: [{ actor: 'funcionario',
                narrar: 'Y con eso, el flujo queda completo y registrado.',
                hacer: async (page) => { await cierre(page, { mensaje: 'Flujo completo.', marca: MARCA }); } }],
        },
    ],
};
export default ejemplo;
