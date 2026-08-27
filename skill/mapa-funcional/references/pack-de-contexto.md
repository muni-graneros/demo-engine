# El pack de contexto (lo que consumen los generadores)

El mapa visual es para humanos; el **pack** es para las máquinas que generan videos y
manuales. Va en `contexto/` dentro del repo del sistema (o donde vivan sus demos), con esta
forma. El corazón es `mapa.json`: un solo archivo que un generador lee para saber qué grabar,
en qué orden, con qué palabras y con qué personajes.

```
contexto/
  mapa.json            # el índice estructurado (esquema abajo)
  pantallas/           # screenshots etiquetados, por frente Y por estado
    01-login.png
    01-login--error.png            # estado ERROR (credenciales/MFA malas)
    02-alta.png
    03-accion-central.png
    03-accion-central--lleno.png   # formulario completo, prueba de que el flujo cierra
    10-historial--vacio.png        # estado VACÍO (lista sin datos)
    20-panel--sin-permiso.png      # el candado por rol ("no disponible para tu perfil")
    ...
  documentos/          # muestras reales de cada salida (ficha.pdf, atenciones.csv, expediente.json)
  elenco/              # retratos IA de los personajes (carlos.png, paula.png, …)
  glosario.md          # términos + vocabularios de estado (legible)
  mensajes.md          # mensajes reales citados (legible)
  gotchas.md           # reglas, validaciones, precondiciones, aislamiento PII
```

## Esquema de `mapa.json`

```json
{
  "sistema": { "nombre": "SIREDIC", "marca": "Municipalidad de Graneros · Oficina de Inclusión",
               "color": "#1e3a8a", "escudo": "./public/images/logo-graneros.png",
               "baseURL": "http://localhost:8000" },

  "capas": {
    "publico":  ["landing", "login", "mfa", "recuperar-contrasena"],
    "frentes":  { "terreno": "/discapacidad-app", "gestion": "/discapacidad" },
    "cumplimiento": ["arcop"]
  },

  "roles": [
    { "id": "of-atencion", "nombre": "Of. Atención Discapacidad", "cae_en": "terreno",
      "puede": ["registrar_persona","registrar_atencion","agendar","atender"],
      "no_puede": ["borrar","panel","reportes"] },
    { "id": "coordinacion", "nombre": "Coordinación Discapacidad", "cae_en": "gestion",
      "puede": ["panel","arcop_resolver","reportes","app_terreno"],
      "no_puede": ["usuarios","borrar_persona","editar_catalogos"] }
  ],

  "permisos": {                         // matriz rol × recurso × verbo (para versiones por rol)
    "persona":   { "of-atencion": ["ver","crear","editar"], "coordinacion": ["ver","crear","editar"] },
    "atencion":  { "of-atencion": ["ver","crear","editar"], "coordinacion": ["ver","crear","editar"] },
    "usuarios":  { "administrador": ["ver","crear","editar","borrar"] }
  },

  "recorrido_caso": [                   // el hilo principal → ORDEN de capítulos del video
    { "id": "alta",     "frente": "terreno", "pantalla": "/discapacidad-app/registro",
      "titulo": "Alta del vecino", "actor": "of-atencion",
      "navegacion": "App de atención → Nuevo registro",
      "obligatorios": ["Tipo de documento","N° documento","Nombres","Apellidos","Consentimiento firmado"],
      "genera": null, "screenshot": "pantallas/02-alta.png" },
    { "id": "agendar",  "frente": "terreno", "pantalla": "/discapacidad-app/agenda",
      "titulo": "Agendar cita", "actor": "of-atencion",
      "obligatorios": ["Persona","Fecha","Tipo de atención","Profesional a cargo"] },
    { "id": "atender",  "frente": "terreno", "pantalla": "/discapacidad-app/agenda",
      "titulo": "Atender", "actor": "of-atencion",
      "conexion": "Atender cierra la cita y GENERA la atención en el historial",
      "genera": "atencion" }
  ],

  "estados": {                          // vocabularios EXACTOS (para narración y manual)
    "atencion": ["en proceso","completada","pendiente","derivada","cancelada"],
    "cita":     ["agendada","confirmada","en proceso","atendida","cancelada","no asistió"],
    "arcop":    ["recibida","en trámite","acogida","acogida parcial","rechazada"]
  },

  "documentos": [
    { "id": "ficha", "nombre": "Ficha clínica imprimible", "formato": "HTML→PDF navegador",
      "ruta": "/discapacidad-ficha/{persona}", "muestra": "documentos/ficha.pdf",
      "protegido": true },
    { "id": "csv-atenciones", "nombre": "CSV de atenciones", "formato": "CSV UTF-8+BOM",
      "respeta_filtros": true, "muestra": "documentos/atenciones.csv" },
    { "id": "expediente-arcop", "nombre": "Expediente del titular", "formato": "JSON",
      "cuando": "derecho de Acceso o Portabilidad", "muestra": "documentos/expediente.json" }
  ],

  "elenco": [
    { "id": "carlos", "nombre": "Carlos Fuentes", "rol": "Vecino · persona con discapacidad", "foto": "elenco/carlos.png" },
    { "id": "paula",  "nombre": "Paula Reyes",    "rol": "Oficina de Atención · mesón",        "foto": "elenco/paula.png" }
  ],

  "mensajes": {                         // citados TEXTUALMENTE
    "login_error": "Credenciales inválidas.",
    "mfa_error": "El código ingresado es incorrecto o ha expirado.",
    "arcop_acogida": "Solicitud acogida.",
    "atencion_ok": "Atención registrada correctamente."
  },

  "gotchas": [
    "El aislamiento PII debe correr ANTES de grabar (comando demo:aislar-personas).",
    "La fecha de la cita no puede ser pasada; el date-picker es readonly (se elige por calendario).",
    "El cese de tratamiento (ARCOP) excluye a la persona de los 3 CSV, aunque siga visible."
  ]
}
```

Ajusta las claves al dominio; lo invariante es la INTENCIÓN de cada sección:
`recorrido_caso` (orden de capítulos), `permisos` (versiones por rol), `estados`+`mensajes`
(palabras exactas), `documentos` (qué se genera), `elenco` (personajes), `gotchas` (reglas + PII).

## Captura en vivo: la herramienta `demo contexto`

No escribas un script de captura a mano: **demo-engine (≥ v1.9.0) trae `demo contexto`**, el
motor de captura reutilizable para cualquier sistema. Declara las pantallas en
`demo.config.mjs` y corre `demo contexto`; el motor reutiliza la sesión (`demo preparar`),
captura un PNG por pantalla, y escribe el manifiesto `pantallas.json`. Aísla la PII por fuera
con `aislar`/`mostrar` (y `mostrar` corre en `finally`, así los datos reales se restauran aunque
la captura falle a la mitad).

```js
// demo.config.mjs
contexto: {
  salida: './demo/contexto',
  aislar: 'docker compose exec -T app php artisan demo:preparar-contexto --aislar',
  mostrar: 'docker compose exec -T app php artisan demo:preparar-contexto --mostrar',
  pantallas: [
    { id: 'pub-01-landing', url: '/', actor: null },                              // público (sin sesión)
    { id: 'pub-02-login--error', url: '/login', actor: null, hacer: async (page) => {
        await page.locator('input[name=email]').fill('nadie@x.cl');
        await page.locator('input[name=password]').fill('mala');
        await page.locator('button[type=submit]').click();
        await page.waitForTimeout(1500);                                          // estado ERROR
    } },
    { id: 'app-02-registro', url: '/app/registro', actor: 'funcionario', esperaTexto: 'Datos personales' },
    { id: 'panel-05-arcop', url: '/panel/solicitudes', actor: 'funcionario' },
    // ... una entrada por pantalla clave, incluyendo vacío/error/sin-permiso y los documentos
  ],
}
```

Campos de una pantalla: `id` (nombre del PNG), `url` (relativa a `baseURL`), `actor` (usa su
sesión; `null` = público sin sesión), `esperaTexto` (confirma que cargó), `hacer(page)`
(interacción antes del screenshot: llenar, abrir panel, provocar un error), `completa` (página
entera para listas largas). Robusto: una pantalla que falle no aborta el resto; queda anotada
con su error en `pantallas.json`.

**El dataset determinista es el requisito previo**: `aislar` acá invoca a `demo:preparar-contexto
--aislar`, que siembra el mundo ficticio Y oculta a los reales. Sin ese mundo, las capturas
salen vacías o con PII.

Para mapear un formulario desconocido (labels, campos obligatorios, selects nativos vs
buscables, date-pickers readonly) ANTES de declararlo, sondéalo en vivo con `page.evaluate`
—los selectores reales, no los del código— y guarda un screenshot del formulario ya lleno como
prueba de que el flujo se completa. Ese mismo mapeo evita re-grabar un flujo roto.

## Cómo lo usan los generadores

- **demo-engine (video)**: `recorrido_caso` → un capítulo por paso, en orden; `permisos` →
  versiones por rol; `elenco` → `elenco()`/`presentar()`; `estados`+`mensajes` → narración
  exacta; `screenshot` de cada paso → confirmar selectores antes de grabar. Handoff detallado
  en [[plantilla-guiones]] y [[produccion-explainer]].
- **Manuales**: `pantallas/` incrustadas + `mensajes` + `documentos` + `glosario` → un manual
  por rol, con capturas reales y las palabras del sistema. La generación del manual PDF ya la
  hace demo-engine (`demo manual`) desde el mismo guion.

Una sola fuente (el pack) → tres salidas coherentes (mapa, video, manual).

### `demo todo`: un comando que genera todo (demo-engine ≥ v1.10.0)

Con el sistema configurado (un seeder determinista + `contexto` en `demo.config.mjs` + un guion
maestro de curso), **`demo todo <maestro>`** hace el pipeline completo en una corrida:

1. `config.contexto.aislar` → siembra el mundo determinista y oculta la PII real.
2. captura el **pack de contexto** (los screenshots).
3. graba el **curso** (cada capítulo del maestro) y lo encadena en un `.mp4` con capítulos + subtítulos.
4. genera el **manual** (PDF) de los mismos pasos, sin re-grabar.
5. `config.contexto.mostrar` → restaura la PII real (en `finally`: pasa aunque algo falle).

Lo único por sistema —el seeder determinista y los guiones— se escribe UNA vez siguiendo esta
skill. Después, regenerar todo (reproducible, sin PII) es un solo comando. El **mapa Mermaid**
es la parte que no automatiza el CLI: sale del análisis funcional (esta skill) y se publica como
artifact.

## Lo que sube la calidad del contexto y de la data

### Dataset demo DETERMINISTA (el mayor retorno)
El pack solo es tan bueno como los datos que hay cuando se captura. Un `demo:preparar-contexto`
—UN comando idempotente— debe dejar SIEMPRE el mismo mundo ficticio:
- **El elenco existe en la BD**: los personajes (Carlos como vecino con RUT válido y ficha
  completa; Paula/Diego como usuarios con su rol). Así "Carlos" es el MISMO en cada pantalla
  (su ficha, su historial), no una persona demo distinta cada vez.
- **Registros en todos los estados** (ver abajo), datos con dígito verificador válido,
  coordenadas dentro de la comuna (para que mapa y gráficos se vean reales), y las solicitudes
  de cumplimiento en cada estado de su ciclo.
- **Idempotente y aislado**: correrlo dos veces no revienta ni duplica; y esconde/excluye la
  PII real (nunca vecinos reales). Reemplaza el baile de comandos no-idempotentes que obliga a
  restaurar a mano. Es la causa raíz de las pantallas vacías y de re-grabar flujos rotos.

Regla: **antes de capturar pantallas o grabar, corre el comando determinista.** Reproducibilidad
= poder regenerar el mismo video/manual mañana y que salga idéntico.

### Cobertura de la máquina de estados
Del vocabulario `estados` del pack, siembra al menos UN registro por cada valor (cita agendada
/confirmada/atendida/…; atención en proceso/completada/…; solicitud recibida/en trámite/acogida
/parcial/rechazada). Así el video y el manual pueden mostrar CADA estado con su color, no solo
el feliz.

### Estados de pantalla: vacío, error y sin-permiso
No captures solo el happy path. Por cada pantalla clave, guarda además —cuando exista— el
estado **vacío** (lista sin datos), **error** (validación / credenciales / MFA), y **sin
permiso** (el candado por rol). Son la materia prima de la sección "qué hacer si…" del manual y
de mostrar los límites de cada perfil.

### Voz, tono y terminología (una sola fuente de palabras)
Agrega `voz.md` al pack: registro (institucional, cálido, accesible), nivel de lectura, y las
sustituciones de término del dominio ("vecino" no "usuario"; "credencial" no "documento"). La
narración del video y la redacción del manual salen de ahí — así todo suena igual.

### Sello de versión + drift
`mapa.json` graba el commit/versión del que se extrajo. Un chequeo barato compara las rutas y
mensajes del pack contra el sistema actual y marca lo que cambió, para que un video no envejezca
en silencio. Sin esto, un vecino termina viendo un tutorial de una pantalla que ya no existe.

### El tour in-app desde la MISMA fuente (lo más estratégico)
Si el sistema tiene un tour de onboarding (el botón "Ayuda"), sus pasos deben salir del mismo
`recorrido_caso` que el video y el manual. Un cambio y se actualizan los tres. El pack es el
contrato que mantiene sincronizados tour + video + manual.
