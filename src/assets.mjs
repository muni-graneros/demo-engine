import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

const MIME_POR_EXTENSION = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
};

const ENTIDADES_HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapa texto para incrustarlo en HTML (contenido y atributos con comillas dobles o simples).
 * Fuente única del escapado del lado Node. Los rótulos que se serializan dentro de
 * `page.evaluate` no pueden importar esto —viven en el contexto del navegador— y por eso
 * repiten una copia mínima e idéntica; esa duplicación es a propósito, no un descuido.
 */
export function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, (c) => ENTIDADES_HTML[c]);
}

/**
 * Incrusta una imagen (escudo, retrato del elenco) como `data:` URI, CONFINADA al proyecto.
 *
 * Endurecido a propósito: el motor puede correr guiones/config de una fuente no confiable, así
 * que solo lee archivos que estén DENTRO del directorio de trabajo, con una extensión de imagen
 * conocida. Una ruta que se escape del proyecto —`../../etc/passwd`, una absoluta afuera, un
 * symlink que apunte fuera—, que no exista, o cuya extensión no sea imagen, devuelve `null`, y el
 * llamador degrada en silencio (cae a la inicial del nombre o a la portada sin escudo). Nunca
 * lanza: una imagen mal declarada no debe tumbar la grabación ni leer algo que no corresponde.
 */
export function imagenComoDataUri(ruta) {
    if (!ruta) return null;
    const mime = MIME_POR_EXTENSION[extname(String(ruta)).toLowerCase()];
    if (!mime) return null;

    // `realpathSync` resuelve symlinks: así el confinamiento no se burla con un enlace.
    let real;
    let base;
    try {
        if (!existsSync(ruta)) return null;
        real = realpathSync(resolve(String(ruta)));
        base = realpathSync(process.cwd());
    } catch {
        return null;
    }
    if (real !== base && !real.startsWith(base + sep)) return null; // fuera del proyecto

    try {
        return `data:${mime};base64,${readFileSync(real).toString('base64')}`;
    } catch {
        return null;
    }
}
