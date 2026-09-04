/**
 * Declara la suite como entorno de desarrollo, para el guardián de `src/privacidad.mjs`.
 *
 * Las pruebas SON un entorno de desarrollo, pero desde que el guardián dejó de deducirlo por
 * la IP hay que decirlo en voz alta: el servidor de juguete vive en 127.0.0.1, y una
 * dirección privada ya no prueba nada —en la red municipal la producción usa esos mismos
 * rangos—, así que `grabar()`, `prepararSesiones()` y el CLI fallan cerrado sin declaración.
 * Que la suite tenga que declararlo es justamente la contraprueba de que el flujo de
 * desarrollo sigue entero cuando se lo declara.
 *
 * Se fijan las DOS variables sin condición (no con `??=`): la suite tiene que dar lo mismo
 * corra donde corra, y como el guardián niega en cuanto CUALQUIERA de las dos dice
 * producción, un `APP_ENV=production` heredado de la shell de quien la lanza —o del .envrc
 * del proyecto— la pondría roja entera por un motivo que no tiene nada que ver con el
 * código. Los tests del CLI lanzan el binario como proceso hijo sin `env` propio, así que
 * heredan esto.
 */
export function declararEntornoDePruebas() {
    process.env.DEMO_ENTORNO = 'testing';
    process.env.APP_ENV = 'testing';
}
