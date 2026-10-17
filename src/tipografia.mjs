/**
 * Stack tipográfico canónico del cromo del motor.
 *
 * El navegador usa el primer fuente disponible; en máquinas sin Noto/Inter cae
 * a system-ui, mismo render que antes. La unificación es de string: garantiza
 * que portada, cierre, explainer, grabador y los rótulos del acabado usen
 * exactamente el mismo stack en el mismo orden.
 */
export const STACK_TIPOGRAFIA = "'Noto Sans','Inter','DejaVu Sans',system-ui,sans-serif";