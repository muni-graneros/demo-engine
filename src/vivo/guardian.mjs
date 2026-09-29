import { exigirEntornoDeDesarrollo } from '../privacidad.mjs';

/**
 * El guardián de la demo en vivo: más estricto que el de la grabación, a propósito.
 *
 * Al grabar, el portero de privacidad PREVIENE: si un paso deja a la vista varias personas,
 * la toma se aborta y ningún video sale. En vivo no hay toma que abortar: cuando el chequeo
 * corre al final del paso, el público ya vio la pantalla. La única protección real es que
 * los datos sean ficticios y el sistema, local. Por eso, además de pasar por
 * `exigirEntornoDeDesarrollo` (entorno declarado, host no público):
 *
 * - `DEMO_FORZAR=1` no vale: es el escape de la grabación para quien sabe lo que hace, y en
 *   una presentación no hay margen para «saber lo que hace»;
 * - solo se acepta loopback, `localhost` y `*.test`. Una IP de la red
 *   municipal pasa el guardián de grabación (no es pública), pero en esa red la VPN y la
 *   producción usan los mismos rangos privados: un `BASE_URL` mal puesto apuntaría a datos
 *   reales frente a un auditorio. Un servidor de demo en la red se declara a mano, host por
 *   host, con `--permitir-host` o `vivo.permitirHosts`.
 *
 * Se revisa la baseURL global y la de cada actor que declare una propia.
 *
 * @param {object} config
 * @param {{ permitirHosts?: string[], env?: NodeJS.ProcessEnv }} [opciones]
 */
export function exigirEntornoEnVivo(config, { permitirHosts = [], env = process.env } = {}) {
    if (env.DEMO_FORZAR === '1') {
        throw new Error('DEMO_FORZAR=1 no se acepta en la demo en vivo: el portero no alcanza a tapar nada frente al público. Quita la variable y usa un stack local.');
    }
    const permitidos = new Set([...(config.vivo?.permitirHosts ?? []), ...permitirHosts].map((h) => h.toLowerCase()));
    const urls = [
        ['baseURL', config.baseURL],
        ...Object.entries(config.actores ?? {}).filter(([, a]) => a.baseURL).map(([n, a]) => [`actores.${n}.baseURL`, a.baseURL]),
    ];
    for (const [nombre, url] of urls) {
        exigirEntornoDeDesarrollo(url, env);
        const host = new URL(url).hostname.toLowerCase();
        if (!hostLocal(host) && !permitidos.has(host)) {
            throw new Error(
                `${nombre} apunta a "${host}", que no es local: la demo en vivo solo corre contra 127.0.0.1, ` +
                'localhost o *.test. Si de verdad es un servidor de demo aislado, decláralo con ' +
                `--permitir-host=${host} (o vivo.permitirHosts en demo.config.mjs).`,
            );
        }
    }
}

/** Loopback de verdad (IPv4 127/8, ::1), `localhost` y los dominios reservados para pruebas. */
export function hostLocal(host) {
    const h = host.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.test') ||
        h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}
