# Titularidad y licencia: DECISIÓN PENDIENTE

> Esta sección no resuelve nada. Deja planteada una pregunta que hoy **no tiene respuesta
> escrita en ninguna parte**, para que la conteste César (con Jurídica si corresponde) en
> vez de que la siga contestando el silencio.

### El hecho

Hoy este repositorio **no declara licencia**: no hay archivo `LICENSE` y `package.json` no
trae el campo `license` (ni `author`, ni `repository`). Sin una concesión expresa, lo que
aplica por omisión es "todos los derechos reservados": nadie tiene permiso escrito para
usarlo, ni siquiera quienes ya lo usan.

Y ya lo usan tres frentes que, por regla del ecosistema, **no se mezclan**:

| Consumidor | Frente |
|---|---|
| `atencionvecino`, `licencias-graneros`, `rrhh-graneros`, `discapacidad-graneros` | Municipalidad de Graneros |
| `scaffold-laravel-filament-pwa` | base de **muni-kit** (JV con Gastón Leiva) y de **KraftDo SpA** |

El motor es **genérico** por diseño (invariante 5: no conoce ningún sistema concreto), pero
vive bajo la cuenta `muni-graneros`. Esa combinación —código reutilizable, alojado en la
cuenta de una de las tres entidades, consumido por las tres— es exactamente la que conviene
resolver por escrito antes de que crezca.

### La pregunta

**¿Quién es el titular de los derechos de `demo-engine`, y bajo qué licencia lo consumen los
otros dos frentes?**

El artículo que gobierna esto es el **8° de la Ley 17.336**, que asigna la titularidad del
software producido por un trabajador dependiente. Si aplica o no depende de hechos que solo
César y la Municipalidad conocen —qué dice el contrato, si se produjo en el ejercicio de las
funciones del cargo, con qué equipos y en qué horario—, y eso no se deduce leyendo el repo.
**No lo decida quien mantenga este archivo.**

### Opciones, con sus consecuencias

**A. Titular la Municipalidad, licencia abierta permisiva (MIT / Apache-2.0).**
Es la que menos fricción genera: KraftDo y muni-kit lo consumen sin pedir permiso ni firmar
nada, y el municipio conserva la autoría. A cambio, el motor queda liberado también para
cualquier tercero —incluido un competidor de KraftDo— sin contraprestación. Apache-2.0 suma
una concesión expresa de patentes que MIT no tiene.

**B. Titular la Municipalidad, uso interno, y licencia expresa a los otros dos frentes.**
El municipio mantiene el control y KraftDo/muni-kit operan bajo un convenio escrito
(gratuito o no, revocable o no). Es lo más prolijo para la regla de los tres frentes, pero
hay que redactar y firmar ese convenio: mientras no exista, el consumo actual desde el
scaffold sigue sin respaldo documental.

**C. Titular César, licenciado a la Municipalidad.**
Solo es viable si los hechos del art. 8° respaldan que la obra no es del empleador. Deja a
César libre para explotarlo comercialmente vía KraftDo, y el municipio pasa a depender de
una licencia de un particular: conviene que sea perpetua e irrevocable para lo ya
desplegado, o el municipio queda expuesto si la relación cambia.

**D. Doble licencia.** Abierta para uso municipal y público, comercial para KraftDo. Es la
más flexible y la más cara de mantener: exige que el titular sea uno solo e inequívoco
(vuelve a A, B o C como paso previo) y disciplina para no aceptar contribuciones externas
sin cesión de derechos.

Cualquiera que se elija, hay que **escribirla en `LICENSE` y en el campo `license` de
`package.json`**, y decidir si el repo se queda en la cuenta `muni-graneros` o se muda a
la del titular real.

### Restricción independiente: las dependencias tienen su propia licencia

Esto no depende de quién sea el titular y acota lo que se puede elegir:

| Dependencia | Licencia declarada | Nota |
|---|---|---|
| `ffmpeg-static` 5.3.0 | **GPL-3.0-or-later** | Trae un binario de FFmpeg precompilado |
| `playwright` 1.62.1 | Apache-2.0 | |
| `three` 0.185.1 | MIT | |

El caso a mirar es **`ffmpeg-static`**. El motor lo invoca como **proceso separado**
(`spawnSync` sobre la ruta del binario, en `src/ffmpeg.mjs`), no lo enlaza, que es el
escenario donde habitualmente se sostiene que no se produce una obra derivada. Pero
*redistribuir* ese binario —cosa que pasa sola en cuanto alguien instala el paquete— sí
arrastra las obligaciones de la GPL sobre el binario. Antes de publicar `demo-engine` bajo
una licencia permisiva o comercial, **esto hay que revisarlo con quien corresponda**; acá
solo se deja anotado el hecho, no una opinión legal.

Los modelos de voz (Kokoro y Piper) **no se distribuyen** con el paquete: los descarga el
usuario en su propia máquina con `herramientas/instalar-voces.sh`. Eso simplifica el
problema, pero cada modelo conserva su licencia de origen y hay que verificarla antes de
usar los videos resultantes con fines comerciales.
