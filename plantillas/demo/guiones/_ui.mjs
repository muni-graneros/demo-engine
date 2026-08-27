/**
 * Ayudantes de UI para que los videos se vean VIVOS: teclear los datos a la vista (no de golpe)
 * y detenerse en la notificación del sistema tras cada acción. Genérico; sirve en cualquier app.
 */

/** Escribe TECLEANDO carácter a carácter (visible), no con fill instantáneo. */
export async function tipear(page, selector, texto, { limpiar = false, delay = 45 } = {}) {
    const campo = page.locator(selector).first();
    await campo.scrollIntoViewIfNeeded().catch(() => {});
    await campo.click().catch(() => {});
    if (limpiar) await campo.fill('');
    await campo.pressSequentially(String(texto), { delay });
    await page.waitForTimeout(250);
}

/** Espera a que aparezca un aviso/notificación tras una acción y se detiene para que se vea. */
export async function esperarAviso(page, ms = 2200) {
    await page.locator('.fi-no-notification, [role="status"], [role="alert"], .toast')
        .first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(ms);
}
