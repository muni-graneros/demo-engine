/**
 * Config de demo-engine para ESTE sistema. Generado por `demo init` — edítalo.
 * Docs: README de demo-engine. Comandos: `demo preparar|grabar|curso|manual|contexto|todo|auditar|formatos`.
 */
export default {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8000',

    // Marca institucional (portadas, elenco, manual). `escudo`: ruta a un PNG DENTRO del proyecto.
    marca: {
        nombre: 'Mi Organización',
        escudo: './public/images/logo.png',
        color: '#1e3a8a',
    },

    // Login del sistema. Ajusta los selectores a tu formulario real (verifícalos en vivo).
    login: {
        url: '/login',
        usuario: 'input[name=email]',
        clave: 'input[name=password]',
        enviar: 'button[type=submit]',
        comprobar: null, // texto que confirma la sesión; null = valida por cookies + salir de /login
    },

    // Actores (usuarios) que graban. La clave es el nombre que usan los guiones (`actor: 'funcionario'`).
    //
    // La contraseña sale de DEMO_CLAVE. El literal que queda de respaldo es la del
    // seeder de demo en local, y está acá a propósito para que `demo grabar` funcione
    // recién clonado el repo — pero NO escribas otra en claro:
    //
    //   * queda en git para siempre, aunque después la cambies;
    //   * es la misma que crea el seeder, así que si ese seeder llegara a correr en
    //     producción (ya está bloqueado en los sistemas, pero el bloqueo es una línea
    //     que alguien puede borrar) la contraseña de las cuentas reales estaría
    //     publicada en el repositorio.
    //
    // Para una demo contra datos que no sean de juguete: exporta DEMO_CLAVE y no toques
    // este archivo.
    actores: {
        funcionario: { email: 'admin@ejemplo.cl', password: process.env.DEMO_CLAVE ?? 'password' },
        // Actor SIN sesión previa (el vecino anónimo, o una app que se loguea dentro del
        // guion): no lleva email/password y `demo preparar` lo salta. `dispositivo` es un
        // nombre de `playwright.devices` (viewport, táctil, userAgent); `baseURL` propia si la
        // app se sirve desde otro puerto (solo con sesion:false). `superficie` lo ubica en
        // el mapa (abajo).
        // vecina: { sesion: false, dispositivo: 'Pixel 7', superficie: 'vecino' },
        // patrullero: { sesion: false, dispositivo: 'Pixel 7', superficie: 'apk',
        //     baseURL: 'http://localhost:8072', permisos: ['geolocation'],
        //     geolocalizacion: { latitude: -34.065, longitude: -70.727 } },
    },

    // Tutorial multi-superficie (opcional): cada superficie sale con su marco (ventana o
    // teléfono) y su chip, y `demo curso` pone la tarjeta «usted está aquí» antes de cada
    // capítulo que declare `superficie`. `color` en hexadecimal. Sin este bloque, todo como
    // siempre. Guía completa: docs/TUTORIALES-MULTISUPERFICIE.md de demo-engine.
    // superficies: {
    //     sala:   { nombre: 'Sala de operaciones', tipo: 'escritorio', color: '#1e3a8a', quien: 'Operador' },
    //     vecino: { nombre: 'App del vecino', tipo: 'telefono', color: '#9a3412', quien: 'Vecina' },
    //     apk:    { nombre: 'App del patrullero · Android', tipo: 'telefono', color: '#166534', quien: 'Patrullero' },
    // },
    // Flechas de la tarjeta: por dónde viaja el caso, como pares [desde, hasta].
    // flujo: [['vecino', 'sala'], ['sala', 'apk'], ['apk', 'vecino']],

    // Audio (opcional). La música la pone el proyecto, con licencia compatible: el motor no
    // trae ninguna. `atenuar` la baja bajo la voz. El clic se sintetiza, sin archivo.
    // audio: {
    //     musica: { archivo: './demo/musica.mp3', volumen: 0.12, atenuar: true },
    //     clic: { activo: true, volumen: 0.5 },
    // },

    // Datos de demo antes de CADA grabación (opcional). Un comando de tu sistema.
    // sembrar: 'docker compose exec -T app php artisan tu:seeder-demo',

    guiones: './demo/guiones',
    salida: './demo/salida', // videos, manual, capturas — ignorado por demo/.gitignore
    video: {
        ancho: 1600, alto: 1000,
        // Presentación (opcional, DENTRO de `video`): fondo, ventana con sombra y transiciones 3D
        // entre capítulos.
        // Quita el bloque y el video sale como la grabación cruda, a pantalla completa.
        // presentacion: {
        //     fondo: null,          // null = gradiente derivado de marca.color
        //     padding: 80, radio: 16, sombra: true, barra: true,
        //     salida: { ancho: 1920, alto: 1080 },
        //     // Las transiciones se renderizan frame a frame (~94 ms por frame): 900 ms entre
        //     // capítulos cuestan ~1 s de render cada una. `activa: false` las apaga y deja
        //     // solo el marco, que es lo indicado si necesitas una versión sin movimiento.
        //     transicion3d: { activa: true, ms: 900, gradosMax: 12 },
        //     mapaMs: 2500,         // cuánto dura la tarjeta de superficies antes de cada capítulo
        // },
    },

    // Pack de contexto (`demo contexto` / `demo todo`): un screenshot por pantalla.
    // `aislar`/`mostrar`: comandos que ocultan/restauran la PII real (ver CONTEXTO-Y-SEEDER.md).
    contexto: {
        salida: './demo/contexto',
        // aislar: 'docker compose exec -T app php artisan demo:preparar-contexto --aislar',
        // mostrar: 'docker compose exec -T app php artisan demo:preparar-contexto --mostrar',
        pantallas: [
            { id: 'pub-01-login', url: '/login', actor: null }, // público (sin sesión)
            { id: 'app-01-inicio', url: '/', actor: 'funcionario' }, // con la sesión del actor
        ],
    },

    // Voz de la narración. Los modelos (~670 MB) se instalan UNA vez y se comparten.
    // Quita este bloque para grabar sin voz.
    // voz: {
    //     motor: 'kokoro', voz: 'ef_dora', respaldo: 'piper', vozRespaldo: 'es_ES-davefx-medium',
    //     venv: '/ruta/a/demo-engine/.venv', voces: '/ruta/a/demo-engine/.voces',
    // },
};
