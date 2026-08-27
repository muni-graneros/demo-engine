---
name: catalogo-funcional
description: >
  Extrae TODO lo funcional (no lo técnico) de un sistema para alimentar guiones de video y
  manuales de usuario. Usar cuando haya que documentar un sistema desde la mirada del usuario:
  levantar todos los flujos, roles, permisos, reportes, y los mensajes de éxito y de error que
  el usuario realmente ve, más los casos de borde y lo que el sistema hace solo. Producir un
  catálogo de TAREAS en lenguaje de usuario (Qué es / Pasos / El sistema confirma / Quién),
  que sirve igual como escena de video (demo-engine) que como sección de manual. Ordena todo por
  el recorrido real (público → flujos → archivos que se generan → reportes → panel), con un ELENCO
  de personajes ficticios (nombre + cara IA) que atraviesan un caso de punta a punta, al estilo de
  un explainer/onboarding CORPORATIVO. Aplica a Laravel + Filament + Livewire de César (Graneros,
  KraftDo, muni-kit) y, con las técnicas equivalentes, a cualquier stack. Disparar ante: "documentar
  el sistema", "manual de usuario", "guion del video", "tutorial", "presentación del sistema",
  "extraer funcionalidades", "qué hace cada rol", "flujos del sistema".
---

# Catálogo funcional de un sistema

El objetivo es producir el **mapa funcional completo** de un sistema —lo que un usuario puede
hacer, lo que ve al hacerlo, y quién puede hacer qué— listo para escribir **guiones de video**
y **manuales de usuario**. NO es documentación técnica: nada de rutas, cron, comandos artisan
ni permisos Shield en el entregable final. Eso se usa **como fuente**, no como resultado.

## Principio: funcional, no técnico

Cada funcionalidad se describe como una **tarea del usuario**, siempre con el mismo molde:

- **Qué es / para qué** — una o dos líneas → sirve como narración de entrada de la escena.
- **Pasos** — lo que hace la persona, con los nombres que ve en pantalla → lo que se graba / lo que dice el manual.
- **El sistema confirma** — el mensaje o pantalla de resultado → el cierre de la escena.
- **Quién lo usa** — los roles que hacen esa tarea → decide en qué manual va.

Regla de oro: **nombrar todo como lo reconoce el usuario**, no como está construido. Una persona
"registra a un vecino" y "recibe una copia de sus datos", no "hace un POST a un resource".

## Ordenar por el RECORRIDO REAL, no por los módulos técnicos

El orden es lo que hace que se entienda. **No sigas el orden técnico** (recursos alfabéticos,
panel de admin primero). Pensá como un humano lógico que conoce el sistema por primera vez, y
seguí **el camino que recorre la información**, de la cara pública hasta la gestión interna:

1. **Lo PÚBLICO primero.** Lo que cualquiera ve sin entrar: la página pública, qué informa, qué
   puede iniciar o solicitar un vecino, cómo se ingresa. Es la puerta del sistema.
2. **Todos los flujos posibles.** Cada cosa que se puede hacer, incluida la que arranca el
   propio vecino o el funcionario en el punto de contacto (mesón / app de terreno). En un
   sistema con app de terreno, esa app suele ser el **origen** que **alimenta el panel**:
   mostrá primero cómo se captura, después cómo se gestiona.
3. **Los ARCHIVOS que se generan.** Muy importante y fácil de olvidar: mostrá **qué documentos
   produce el sistema** —PDF, expediente, comprobante, exportación CSV, reporte descargable— y
   qué contiene cada uno. El usuario quiere ver "qué sale de acá". Es el resultado tangible.
4. **Los reportes e indicadores** — cómo se ve la información agregada.
5. **El PANEL, al final:** cómo el funcionario/coordinación **gestiona** toda esa información
   que entró antes (revisa, edita, resuelve, administra roles, usuarios y catálogos).

Antes de escribir, preguntate: "si nunca vi este sistema, ¿en qué orden lo entendería?" — de lo
público y lo que sale, hacia adentro. Cada **manual por rol** empieza por lo que ESE rol hace
primero en un día real, no por el índice del sistema.

Sé **lo más claro y concreto posible**: frases cortas, un paso por línea, el nombre exacto del
botón entre comillas, y el resultado que la persona ve. Es para usuarios, no para desarrolladores.

## Antes de empezar: privacidad

Si el sistema tiene datos personales reales (Ley 21.719), NUNCA documentes ni grabes con ellos.
Aislá los datos reales y sembrá ficticios (patrón `demo:aislar-personas` + `demo:sembrar-poblacion`
en los sistemas de Graneros). Los mensajes y flujos son los mismos; los datos, inventados.

## El flujo de extracción (en orden)

Trabajá de afuera hacia adentro y **verificá en vivo** lo que puedas, porque el código miente por
omisión (un mensaje puede estar en un `lang/`, una acción condicionada por permiso, un estado que
solo aparece tras otro). Ver `references/comandos-extraccion.md` para los comandos concretos.

1. **Superficie y frentes.** ¿Cuántos frentes tiene? (público / panel de administración / app de
   terreno / API). Enumerá las áreas, no las rutas: "Personas", "Atención", "Reportes"…

2. **Roles y alcance.** Listá los roles y, por cada uno, **qué áreas ve y qué puede hacer**
   (gestiona / ve / sin acceso). Esto define la matriz de cobertura y en qué manual va cada tarea.
   No listes los permisos uno por uno en el entregable: resumí por área.

3. **Por cada área, sus flujos.** Para cada recurso/pantalla: alta, edición, borrado, y las
   **acciones extra** (exportar, confirmar, cancelar, asignar, descargar, resúmenes) y los
   **filtros** y **estados** (una cita va Agendada → Confirmada → Atendida → Cancelada…). Cada uno
   es una tarea o un paso.

4. **Los mensajes que ve el usuario.** Los dos importan y hay que capturarlos TAL CUAL:
   - **Éxito:** las notificaciones al guardar/resolver ("Persona registrada", "el plazo legal
     empezó a correr"). Buscalos en el código (`Notification::make`, `->success(`, archivos
     `lang/`) y **confirmalos abriendo la pantalla y haciendo la acción**.
   - **Error / negativo:** validaciones ("RUT inválido"), permisos denegados ("Esta sección no
     está disponible para tu perfil"), reglas de negocio ("identidad no verificada", "toda
     resolución debe ir fundada"). Son escenas de manual valiosísimas ("qué pasa si…").

5. **Los documentos que produce.** Enumerá lo que el sistema **genera y entrega**: PDF,
   expediente, comprobante, exportación CSV/Excel, reporte descargable, correo con adjunto.
   Buscalos por las descargas/streams y las acciones de exportar (ver cheatsheet), y **abrí al
   menos uno** para describir qué contiene. Cada documento es una tarea ("Descargar el
   expediente") y, en el video, una escena que muestra el archivo resultante.

6. **Flujos automáticos.** Lo que el sistema hace solo (recordatorios, avisos, anonimización,
   respaldos). Se cuentan funcionalmente: "recibirás un correo con las citas de mañana".

7. **Casos de borde legales o de negocio.** Menores, representación, consentimiento, cese,
   retención. Cada uno es una sección de "casos especiales".

8. **Traducir a tareas.** Recién acá se escribe el catálogo funcional con el molde de arriba,
   ordenado por el recorrido real (público → flujos → documentos → reportes → panel), y con la
   matriz de roles.

## Pensá en PERSONAS y en el CASO completo, no en tareas sueltas

Un sistema no lo usa "un rol": lo usan personas con un trabajo que hacer, y un mismo caso pasa
por varias de ellas. Ahí está la lógica real. Antes de listar tareas, hacé dos cosas:

### 1. Definí las personas (no los permisos)
Por cada perfil, escribí una línea de **quién es y qué quiere lograr**, no qué permisos tiene:
- *"La funcionaria del mesón: atiende al vecino que llega, lo registra y lo cita rápido, sin que
  se le vaya nadie."*
- *"El coordinador: no atiende público; revisa, reporta a la jefatura y resuelve los derechos."*
- *"El administrador: mantiene el sistema —usuarios, roles, catálogos— y controla que todo cuadre."*

Eso da el tono del manual de cada uno y hace que el usuario se reconozca ("esta soy yo").

### 2. Seguí UN caso de punta a punta (el hilo conductor)
La forma más humana de entender un sistema es **seguir un caso real cruzando a todos los que lo
tocan**, no saltar entre módulos. Ejemplo del hilo:

> Un vecino llega al mesón → **la funcionaria lo registra** (terreno) → **le agenda una cita** →
> el día de la cita **registra la atención** → **le entrega una ayuda técnica** → más tarde el
> vecino **pide una copia de sus datos** y **el coordinador resuelve la solicitud** y le da el
> expediente → a fin de mes **la jefatura ve el reporte** con todo eso adentro.

Ese hilo es, a la vez, el **mejor video introductorio** (una historia que se entiende sola) y la
**primera página del manual general** (el mapa mental antes del detalle). Contá el sistema como
una historia con esa continuidad, y recién después abrí el detalle por área.

### 3. Marcá los TRASPASOS entre usuarios
Donde lo que hace una persona se convierte en el punto de partida de otra, decilo explícito: "lo
que la funcionaria registra en terreno, el coordinador lo ve en el panel y lo reporta". Los
traspasos son la lógica del sistema; sin ellos, el manual es una lista de botones.

### 4. Cada manual por rol = un día real de esa persona
Ordená el manual de cada rol como le pasan las cosas en su jornada, no por el índice del sistema.
El de la funcionaria empieza en "llega un vecino"; el del coordinador, en "abro el panel y reviso
lo pendiente".

### 5. Dale NOMBRE y CARA a cada persona: un elenco
Las personas abstractas se olvidan; un personaje con nombre y cara se sigue solo. Convertí cada
perfil (y el vecino) en un **personaje fijo del sistema** y usalo en TODOS los videos y manuales:

- **Un elenco chico y fijo (3–5).** Nombre + rol + una línea de personalidad/objetivo + una foto.
  Ej.: *Carlos* (vecino que llega a atenderse), *Paula* (funcionaria de mesón), *Diego*
  (coordinador), *Marta* (administradora). Diversidad realista de la comuna (edad, género).
- **La foto la genera IA, y es FICTICIA.** Nunca imitar la cara de un funcionario ni de un vecino
  real (Ley 21.719 / imagen). Un rostro inventado, amable, fondo neutro, tipo foto carnet.
- **Consistencia = una sola foto por personaje, reusada.** Generá **un** retrato por personaje,
  guardalo como asset y reusalo como avatar estático en todas las escenas. NO re-generes la cara
  por escena: los generadores de IA no mantienen el mismo rostro, y el personaje "cambia de cara".
  Si hay tool de imagen disponible (p. ej. Canva), generalos ahí con un prompt fijo por personaje;
  si no, entregá los prompts para que el usuario los genere.
- **Narrá los flujos con ellos.** "Llega **Carlos** al mesón y **Paula** lo registra… más tarde
  Carlos pide una copia de sus datos y **Diego, el coordinador**, resuelve la solicitud." El
  recorrido del caso (punto 2) se cuenta con el elenco actuando.
- **En el video:** una **carta de presentación del elenco** al inicio (foto + nombre + rol de cada
  uno), y cuando un personaje actúa, un rótulo con su foto y nombre (lower-third) para que se sepa
  quién está en pantalla. En demo-engine, las fotos van en `demo/assets/` y se muestran en la
  portada del personaje o como avatar.
- **Accesibilidad:** la cara acompaña, no reemplaza — siempre el nombre y el rol en texto.
- **Reusá el elenco** entre videos del mismo sistema: el usuario ya conoce a Carlos y Paula, y eso
  encadena los capítulos.

En el catálogo, agregá al bloque "Las personas que lo usan" el **nombre, la foto y la línea** de
cada personaje, y usá esos nombres en el "recorrido del caso" y en las narraciones de cada tarea.

## El estándar de producción: explainer corporativo

El resultado NO es una captura de pantalla cruda: es un **tutorial estilo presentación
corporativa / onboarding de producto**, como los explainer que sube una plataforma SaaS para
enseñar a usarla. Pulido, guiado y con marca. Ese es el listón.

**El arco del video (como una presentación):**
1. **Apertura con marca** — logo e identidad del municipio/sistema, título, "Te damos la bienvenida a <Sistema>".
2. **Agenda** — en 10 segundos, qué vas a ver (los capítulos), para que el espectador se ubique.
3. **El elenco** — presentar a los personajes con su foto y rol (te vas a cruzar con ellos).
4. **El recorrido del caso** — la historia de punta a punta, como gancho.
5. **Los capítulos** — cada sección abre con su **carta de título** ("Capítulo 2 · El registro de personas").
6. **Cierre / recap** — resumen de lo visto + un mensaje de confianza ("y todo queda registrado y auditado").

**Tono de la narración:** profesional pero cálido, en segunda persona, de guía —"Veamos cómo…",
"Ahora, Paula abre el panel…"—. Nunca robótico ni técnico. Frases cortas, una idea por escena.

**Recursos que lo hacen ver corporativo (no plano):**
- Cartas de título entre secciones, con la marca (colores institucionales, logo) consistente.
- **Lower-third** con la foto y el nombre del personaje cuando actúa (se sabe quién está en pantalla).
- **Resaltar/acercar** el elemento clave de cada paso (no dejar la pantalla quieta y plana).
- Cursor visible y movimientos **deliberados**, no bruscos; transiciones suaves entre capítulos.
- Callouts/anotaciones sobre lo importante; mostrar el **archivo que se genera** (el PDF, el reporte).
- Ritmo pausado: la locución guía, la pantalla acompaña; una acción por vez.

**En demo-engine:** `portada`/cartas de título con la marca, `acercarA` para resaltar, `cierre`
para el recap, los retratos del elenco como assets, y voz IA con tono cálido. Todos los capítulos
comparten la misma identidad visual para que se sienta un solo producto.

## Verificar en vivo (no adivinar los mensajes)

Los mensajes de éxito y error son lo que más se inventa mal. Para cada flujo clave:

- Preparar datos ficticios y entrar con un usuario de cada rol.
- Hacer la acción y **leer el toast/mensaje real** (Playwright/chrome-devtools, o el navegador).
- Probar el **camino negativo** (dato inválido, sin permiso) y leer ese mensaje.
- Anotar el texto EXACTO en "El sistema confirma".

Un catálogo con los mensajes reales sirve; uno con mensajes inventados hace que el manual mienta.

## Formato de salida

Un `.md` con esta estructura (ver el ejemplo real en `~/Dev/SIREDIC-funcional-guiones-y-manuales.md`):

```
# <Sistema> — Catálogo funcional
> Qué es el sistema en una línea · sus frentes · quiénes lo usan.
> Convención de cada tarea (Qué es / Pasos / El sistema confirma / Quién).

# El elenco (quiénes lo usan)
Un personaje fijo por perfil + el vecino. Foto IA ficticia (un retrato por personaje, reusado).
- **<Nombre>** — <rol> · foto: `demo/assets/<nombre>.png` · <quién es y qué quiere, una línea>.
- **<Nombre>** — <rol> · foto: … · …
> Prompt de cada retrato (si se generan aparte): rostro ficticio, <edad/género>, expresión amable,
> fondo neutro, foto tipo carnet. Nunca un funcionario/vecino real.

# El recorrido de un caso (de punta a punta)
Una historia corta que sigue UN caso cruzando al elenco, **nombrando a cada personaje** ("llega
Carlos… Paula lo registra… Diego resuelve"), desde que entra hasta el reporte final. Es el mapa
mental del sistema y el guion del video introductorio.

# Parte 1 · <Área>  (p. ej. Entrar al sistema)
## 1.1 <Tarea>
- Qué es / para qué:
- Pasos:
- El sistema confirma:
- Quién:
...

# Parte N · Lo que el sistema hace solo   (flujos automáticos, framea funcional)

# Matriz de cobertura por rol   (área × rol: gestiona / ve / sin acceso)

# Cómo usar esto
## Para los MANUALES
- Uno por persona/rol, ORDENADO como su día real (empieza por lo primero que hace, no por el índice).
- Cada manual abre con "quién sos y qué vas a lograr" + el trozo del recorrido del caso que te toca.
- Una guía aparte para el vecino / la cara pública.
## Para los GUIONES
- Un video introductorio = el recorrido del caso completo (la historia de punta a punta).
- Después, un capítulo por parte; cada tarea = una escena (Qué es → narrar, Pasos → grabar,
  El sistema confirma → cierre). Los capítulos por rol se graban entrando con ese usuario.
```

Cerrá siempre con las **dos guías de uso** (manuales por rol + capítulos de video): es lo que
convierte el catálogo en algo accionable para producir los videos y los manuales.

## De catálogo a guiones de demo-engine

Cada tarea del catálogo mapea directo a una escena de un guion de `demo-engine`:
- "Qué es" → `narrar`.
- "Pasos" → los `hacer(page)` (navegar y actuar).
- "El sistema confirma" → un `exigirEnPantalla(page, '<mensaje real>')` que cierra la escena.

Los capítulos por rol se graban entrando con el usuario de ese rol; los flujos que muestran
listas/mapas se graban con la población ficticia y `variasPersonas: true` (ver la skill/guía de
demo-engine y el gotcha del login Filament).

**Plantillas listas para copiar** en `references/plantilla-guiones.md`: el elenco (`_elenco.mjs`),
un capítulo tipo (portada con marca → `presentar` el personaje → `anotar` lo clave → cierre) y el
`curso.mjs` maestro. Requieren demo-engine ≥ v1.8.0 (`elenco`/`presentar`/`anotar` + manual con
portada y elenco).

## Barra de calidad (definición de terminado)

No está terminado hasta que se cumple TODO esto. Es lo que separa un buen tutorial de uno de
clase mundial.

**Contenido**
- [ ] Cubre el 100% de las áreas y **todos los flujos posibles** (positivos, negativos, automáticos, documentos).
- [ ] Cada mensaje de éxito y de error es el **texto real** (verificado en vivo), no inventado.
- [ ] Muestra los **archivos que se generan** (PDF, expediente, CSV) y qué contiene cada uno.
- [ ] Ordenado por el recorrido real (público → flujos → archivos → reportes → panel), no por módulos.

**Humano**
- [ ] Elenco fijo con nombre y cara; el recorrido del caso los nombra y encadena.
- [ ] Traspasos entre usuarios explícitos.
- [ ] Cada manual por rol arranca por lo que ESA persona hace primero en su día.
- [ ] Lenguaje de usuario, cero jerga técnica.

**Producción (ver `references/produccion-explainer.md`)**
- [ ] Arco de explainer: apertura con marca → agenda → elenco → historia → capítulos con carta de título → recap.
- [ ] Lower-third (foto + nombre) cuando un personaje actúa; se resalta/acerca el elemento clave de cada paso.
- [ ] Marca consistente en cada capítulo; voz cálida de guía; ritmo pausado.
- [ ] Subtítulos siempre (accesibilidad); la cara acompaña al texto, no lo reemplaza.
- [ ] Cero PII real en pantalla, verificado (auditoría OCR si el motor la trae).

## Qué NO hacer

- No entregar el mapa técnico (rutas, cron, comandos, 181 permisos) como si fuera el catálogo:
  eso es la fuente, no el resultado. Si además lo piden, va como anexo aparte.
- No inventar mensajes de éxito/error: capturá los reales.
- No documentar con datos de personas reales.
- No describir con jerga de implementación ("resource", "policy", "webhook"): lenguaje de usuario.
