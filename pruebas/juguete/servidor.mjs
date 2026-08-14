import { createServer } from 'node:http';

const PERSONAS = [
    { rut: '11111111-1', nombre: 'Ana Demo', estado: 'En revisión' },
    { rut: '22222222-2', nombre: 'Beto Demo', estado: 'Aprobado' },
    { rut: '33333333-3', nombre: 'Caro Demo', estado: 'Finalizado' },
];

const marco = (titulo, cuerpo) => `<!doctype html><html lang="es"><head>
<meta charset="utf-8"><title>${titulo}</title>
<style>body{font-family:system-ui;margin:0;padding:32px;background:#f8fafc;color:#0f172a}
table{border-collapse:collapse;width:100%;background:#fff}td,th{border:1px solid #e2e8f0;padding:10px}
button,input{font-size:16px;padding:8px 12px}</style></head><body>${cuerpo}</body></html>`;

function paginaLogin() {
    return marco('Entrar', `<h1>Sistema de juguete</h1>
    <form method="POST" action="/login">
      <p><input name="usuario" placeholder="usuario"></p>
      <p><input name="clave" type="password" placeholder="clave"></p>
      <p><button type="submit" id="entrar">Entrar</button></p>
    </form>`);
}

// Segunda superficie de autenticación: el "portal" del ciudadano, con URL propia. Existe
// para probar que cada actor puede traer su propio bloque `login` (fusionado sobre el
// global) en vez de que un único `login` fuerce a elegir una sola superficie. Reutiliza a
// propósito los MISMOS selectores que el login admin (mismos names/ids), para que el test
// de fusión pueda verificar que basta con que el actor pise solo `url` y herede el resto.
function paginaPortal() {
    return marco('Entrar al portal', `<h1>Portal del ciudadano</h1>
    <form method="POST" action="/portal">
      <p><input name="usuario" placeholder="usuario"></p>
      <p><input name="clave" type="password" placeholder="clave"></p>
      <p><button type="submit" id="entrar">Entrar</button></p>
    </form>`);
}

// El panel filtra EN EL NAVEGADOR, con retardo, imitando a Filament/Livewire: primero
// pinta la tabla COMPLETA y solo después aplica el filtro. Esa ventana es exactamente el
// riesgo de privacidad que el motor debe tapar; un juguete que filtrara en el servidor de
// forma atómica no tendría ese instante peligroso y dejaría al test sin dientes.
function paginaPanel(rut) {
    const filas = PERSONAS
        .map((p) => `<tr class="fila" data-rut="${p.rut}"><td>${p.rut}</td><td>${p.nombre}</td><td>${p.estado}</td>
        <td><a href="/detalle/${p.rut}" class="ver">Ver</a></td></tr>`).join('');
    return marco('Panel', `<h1>Solicitudes</h1>
    <form method="GET" action="/panel">
      <input name="rut" id="filtro" placeholder="Filtrar por RUT" value="${rut ?? ''}">
      <button type="submit" id="buscar">Buscar</button>
    </form>
    <table><thead><tr><th>RUT</th><th>Nombre</th><th>Estado</th><th></th></tr></thead>
    <tbody>${filas}</tbody></table>
    <script>
      // 350 ms de tabla completa a la vista: la ventana que el cubridor debe tapar.
      const buscado = new URL(location.href).searchParams.get('rut');
      if (buscado) setTimeout(() => {
          for (const fila of document.querySelectorAll('tr.fila')) {
              if (fila.dataset.rut !== buscado) fila.remove();
          }
      }, 350);
    </script>`);
}

// Segunda pantalla de código, para el usuario "conmfa". Existe para que el camino del
// TOTP tenga cobertura: el sistema real (Filament con MFA) pide el código en una pantalla
// aparte, y ese salto es justo donde se rompen las sesiones de los actores.
// El juguete NO valida el código contra un secreto —eso lo prueba el vector del RFC 6238—;
// solo exige que llegue un código de seis dígitos, que es lo que ejercita el flujo.
function paginaCodigo() {
    return marco('Código', `<h1>Verificación en dos pasos</h1>
    <form method="POST" action="/codigo">
      <p><input name="code" placeholder="código de 6 dígitos"></p>
      <p><button type="submit" id="entrar">Entrar</button></p>
    </form>`);
}

function paginaDetalle(rut) {
    const p = PERSONAS.find((x) => x.rut === rut);
    if (!p) return null;
    return marco('Detalle', `<h1>${p.nombre}</h1><p>RUT: ${p.rut}</p>
    <p>Estado: <strong id="estado">${p.estado}</strong></p>
    <button id="aprobar">Aprobar</button>`);
}

/** Lee un cuerpo `application/x-www-form-urlencoded` y lo entrega como objeto. */
function leerCuerpo(req, seguir) {
    let crudo = '';
    req.on('data', (trozo) => { crudo += trozo; });
    req.on('end', () => seguir(Object.fromEntries(new URLSearchParams(crudo))));
}

/** Levanta el sistema de juguete. `puerto: 0` toma uno libre. */
export function iniciarJuguete({ puerto = 0 } = {}) {
    const servidor = createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        const conSesion = (req.headers.cookie ?? '').includes('sesion=');
        const html = (cuerpo) => {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            res.end(cuerpo);
        };

        if (url.pathname === '/') return html(paginaLogin());
        if (url.pathname === '/login' && req.method === 'POST') {
            return leerCuerpo(req, (datos) => {
                if (datos.usuario === 'conmfa') {           // este actor pasa por el 2º factor
                    res.writeHead(302, { location: '/codigo' });
                    return res.end();
                }
                // Credenciales inválidas: vuelve al login SIN dejar cookie, como cualquier
                // sistema real. Existe para probar la verificación por defecto (sin
                // `login.comprobar`) cuando el login de verdad falla.
                if (datos.usuario === 'malacontra') {
                    res.writeHead(302, { location: '/' });
                    return res.end();
                }
                res.writeHead(302, { location: '/panel', 'set-cookie': 'sesion=funcionario; Path=/' });
                res.end();
            });
        }
        if (url.pathname === '/portal' && req.method === 'POST') {
            return leerCuerpo(req, (datos) => {
                res.writeHead(302, { location: '/portal/panel', 'set-cookie': 'sesion=portalciudadano; Path=/' });
                res.end();
            });
        }
        if (url.pathname === '/portal') return html(paginaPortal());
        if (url.pathname === '/portal/panel') return html(marco('Portal', '<h1 id="portal-ok">Portal ciudadano</h1>'));
        if (url.pathname === '/codigo' && req.method === 'GET') return html(paginaCodigo());
        if (url.pathname === '/codigo' && req.method === 'POST') {
            return leerCuerpo(req, (datos) => {
                if (!/^\d{6}$/.test(datos.code ?? '')) {
                    res.writeHead(302, { location: '/codigo' });
                    return res.end();
                }
                res.writeHead(302, { location: '/panel', 'set-cookie': 'sesion=profesional; Path=/' });
                res.end();
            });
        }
        if (!conSesion) {
            res.writeHead(302, { location: '/' });
            return res.end();
        }
        if (url.pathname === '/panel') return html(paginaPanel(url.searchParams.get('rut')));
        if (url.pathname.startsWith('/detalle/')) {
            const pagina = paginaDetalle(url.pathname.split('/')[2]);
            if (pagina) return html(pagina);
        }
        res.writeHead(404);
        res.end('no existe');
    });

    return new Promise((listo) => {
        servidor.listen(puerto, '127.0.0.1', () => {
            const { port } = servidor.address();
            listo({
                url: `http://127.0.0.1:${port}`,
                cerrar: () => new Promise((f) => servidor.close(f)),
            });
        });
    });
}
