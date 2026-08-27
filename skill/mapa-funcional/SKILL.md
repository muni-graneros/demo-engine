---
name: mapa-funcional
description: >-
  Úsala ANTES de guionizar videos o escribir manuales de un sistema que aún no
  mapeaste: produce una radiografía funcional completa de cómo funciona TODO el
  sistema —el recorrido del caso, las capas (público/frentes/gestión), los roles,
  los ciclos de estado y los documentos que genera— como (1) un mapa visual Mermaid
  publicado como artifact y (2) un pack de contexto estructurado (md+json) que
  alimenta a los generadores (demo-engine para video, y los manuales). Pensada para
  el stack municipal/KraftDo Laravel + Filament + Livewire. Dispara con: "mapa de
  flujos", "cómo funciona todo el sistema", "contexto para los videos/manuales",
  "radiografía del sistema", "diagrama de los flujos", o cuando vas a hacer un
  tutorial de un sistema que todavía no entendiste de punta a punta.
---

# Mapa funcional — radiografía de un sistema para alimentar generadores

## El principio (el error que evita)

**Primero el mapa, después los guiones.** El error clásico —y caro— es improvisar
capítulo por capítulo sin entender cómo funciona todo: terminas mostrando dos veces lo
que es un solo flujo, saltándote el frente donde de verdad ocurre la acción, o narrando
un rol que no hace lo que crees. Esta skill hace el análisis completo UNA vez, contra el
**sistema real y verificado en vivo** (rutas, recursos, componentes, permisos), y deja
ese entendimiento en dos entregables que todo lo demás reutiliza.

Dos salidas:
1. **Mapa visual de flujos** — artifact HTML con diagramas Mermaid; el contexto de una mirada.
2. **Pack de contexto** — estructurado (md + json); lo que los generadores consumen sin adivinar.

Es la capa de arriba de [[catalogo-funcional]] (que extrae el detalle funcional en texto) y
la que precede a [[produccion-explainer]] / demo-engine (que producen el video y el manual).

## El método — 5 pasos

### 1. Inventario de superficie (las capas)
Lee las rutas y descubre la forma real del sistema. Casi siempre hay **tres capas**, no dos:
- **Acceso / público**: landing, login, segundo factor (MFA), recuperar contraseña.
- **Frentes operativos**: puede haber más de uno (una PWA de terreno + un panel; una app
  ciudadana + back-office). NO asumas "todo es el panel".
- **Gestión / control**: el panel administrativo, reportes, privacidad, usuarios, auditoría.

Comandos: `php artisan route:list --except-vendor`, grep de `app/Filament/**/Resources`,
`app/Livewire/**`, y `routes/web.php` para los frentes propios. Anota qué pantalla vive en
cada capa antes de profundizar.

### 2. Análisis funcional en paralelo (un subagente por área)
Lanza **un subagente por frente/área** (típicamente 3: panel de gestión / app operativa /
roles+acceso+documentos). Cada uno reporta **FLUJOS DE USUARIO, no código**: qué hace el
usuario en cada pantalla, campos obligatorios (labels exactos), acciones especiales,
mensajes de éxito/error, y qué documentos genera. La lente exacta está en
[[catalogo-funcional]] y su `references/comandos-extraccion.md`. Dales el path del repo y
pídeles trazabilidad (citar el archivo de cada recurso).

Por qué en paralelo: un sistema real no cabe en una sola pasada de lectura sin perder
detalle; tres análisis enfocados y simultáneos cubren más y más hondo.

### 3. Dataset determinista + verificación en vivo + screenshots
Primero, **siembra el mundo ficticio determinista** (un `demo:preparar-contexto` idempotente:
el elenco como personas/usuarios reales de la BD, registros en TODOS los estados, datos con RUT
válido y coordenadas en la comuna, PII real aislada). Sin datos buenos, las pantallas salen
vacías y el mapa es una hipótesis. Detalle y por qué en `references/pack-de-contexto.md`.

Luego captura las pantallas con **`demo contexto`** (motor reutilizable de demo-engine ≥ v1.9.0:
declaras las pantallas en `demo.config.mjs` y corre solo; ver `references/pack-de-contexto.md`):
- **Un screenshot** de cada flujo (login, alta, la acción central, la ficha, el reporte, el
  ciclo de cumplimiento), y también los estados **vacío / error / sin-permiso**.
- **Confirma selectores y mensajes** reales (no los asumas del código); guarda un screenshot del
  formulario ya lleno como prueba de que el flujo cierra.
- **Nunca PII real** (Ley 21.719): solo el mundo ficticio del paso anterior.

Sin este paso, el mapa es una hipótesis. Con él, es la verdad.

### 4. Consolidar el mapa visual (Mermaid → artifact)
Reúne todo en **cinco diagramas** (plantillas listas en `references/mermaid-plantillas.md`):
1. **Recorrido del caso** — el hilo principal, con las flechas ETIQUETADAS (la conexión que
   nadie adivina: p. ej. "Atender cierra la cita y genera la atención").
2. **Las capas** — público → rol te enruta → frentes → documentos.
3. **Roles** — quién cae en qué herramienta y con qué alcance (+ tabla).
4. **Ciclos de estado** — el ciclo de cumplimiento/negocio (ARCOP, estados de una solicitud).
5. **Documentos** — lo que el sistema produce.
Publica como artifact (shell HTML con tema e identidad institucional en la plantilla). Una
figura, una afirmación; etiqueta cada flecha; el detalle largo va en el pack, no en el dibujo.

### 5. Empaquetar el contexto (el pack)
Deja el pack estructurado que los generadores consumen. Estructura y esquema en
`references/pack-de-contexto.md`. Contenido mínimo:
- **pantallas/** — screenshots etiquetados por frente.
- **recorridos** — el caso completo y un journey por rol (day-in-the-life).
- **permisos** — matriz rol × capacidad (ver/crear/editar/borrar/exportar por recurso).
- **glosario + estados** — términos del dominio y los vocabularios de estado exactos.
- **mensajes** — éxito/error/vacío/validación, citados TEXTUALMENTE.
- **documentos** — cada salida (ficha, CSV, expediente…) con formato y muestra.
- **elenco** — personajes ficticios con rostro IA + su rol (reutilizable en todo asset).
- **gotchas** — validaciones, precondiciones, detección de duplicados, y el aislamiento PII.

## El orden lógico (pensar como humano)

El recorrido nunca es "por el menú". Es el del caso real:

> público → **entrada/alta** del sujeto → **flujos operativos** (el frente de terreno donde
> ocurre la acción) → **lo que se genera** (documentos) → **gestión y control** (panel) →
> **privacidad/cumplimiento**.

De ahí caen dos ejes para los generadores:
- **El recorrido del caso da el ORDEN de los capítulos.**
- **Los roles dan las VERSIONES por perfil** (el operador de mesón no ve lo mismo que la jefatura).

## Handoff a los generadores

- **A demo-engine (video)**: el recorrido → guiones por caso; la matriz de permisos →
  guiones por rol; el elenco → `presentar`/`elenco`; los screenshots confirman selectores.
  Ver [[plantilla-guiones]] y [[produccion-explainer]].
- **A los manuales**: pantallas + mensajes + documentos + glosario → un manual por rol,
  con capturas reales y las palabras exactas del sistema.
- **Al tour in-app**: si el sistema tiene onboarding (botón "Ayuda"), sus pasos salen del mismo
  `recorrido_caso`. Un cambio, y se actualizan tour + video + manual a la vez.

## Barra de calidad

- Cada afirmación del mapa es verificable contra el sistema en vivo. Si no la verificaste,
  no la dibujes.
- Flechas etiquetadas: una flecha sin verbo es "relacionado con algo", no información.
- Nada de PII real en screenshots, ejemplos ni el pack. Ficticio y aislado, siempre.
- Frentes múltiples explícitos: si hay app de terreno + panel, el mapa lo separa; no fundir.
- Mensajes citados, no parafraseados.

## Qué NO hacer

- No guionizar ni grabar antes de tener el mapa validado por César.
- No asumir que "el panel es todo el sistema": busca los frentes propios en `routes/web.php`.
- No inventar un flujo que el código no respalda; ante la duda, abrir la pantalla y mirar.
- No meter el detalle largo en los diagramas: el dibujo muestra el mecanismo, el pack guarda el detalle.
