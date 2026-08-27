/**
 * Config de demo-engine para ESTE sistema. Generado por `demo init` — edítalo.
 * Docs: README de demo-engine. Comandos: `demo preparar|grabar|curso|manual|contexto|todo|auditar`.
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
    actores: {
        funcionario: { email: 'admin@ejemplo.cl', password: 'password' },
    },

    // Datos de demo antes de CADA grabación (opcional). Un comando de tu sistema.
    // sembrar: 'docker compose exec -T app php artisan tu:seeder-demo',

    guiones: './demo/guiones',
    salida: './docs/tutoriales',
    video: { ancho: 1600, alto: 1000 },

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
