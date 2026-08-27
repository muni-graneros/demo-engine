# Producción de nivel explainer + el motor + los manuales

Cómo llevar el video y el manual a calidad de presentación corporativa, y cómo el motor une las
tres cosas (skill → catálogo → **una** fuente → video + manual + catálogo).

## La arquitectura: una fuente, tres salidas

No se escribe nada dos veces. La **skill** produce el catálogo funcional; de ahí salen los
**guiones** (uno por capítulo/rol, con elenco y arco corporativo); y el **motor** renderiza desde
ese mismo guion:

```
catálogo funcional (.md)  →  guiones (demo/guiones/*.mjs)  →  ┌ demo curso   → VIDEO (mp4)
                                                             ├ demo manual  → MANUAL (pdf)
                                                             └ el catálogo   → referencia/QA
```

- **El guion es la fuente de verdad.** El "Qué es" es la narración, los "Pasos" son los
  `hacer(page)`, "El sistema confirma" es un `exigirEnPantalla` con el **mensaje real**.
- `demo manual` toma el mismo guion y arma un **PDF** con las capturas de cada escena y los
  subtítulos como texto → el manual sale gratis del video. Mantener uno mantiene los dos.

## Motores: evaluación honesta

**demo-engine (propio) es el motor correcto.** Graba un navegador real, sintetiza voz local
(Kokoro/Piper), monta con ffmpeg **offline**, tiene portero de privacidad, y ya genera **video +
PDF** del mismo guion. Es self-hosted y no manda nada afuera.

**NUNCA usar SaaS de video IA** (Synthesia, Tavus, Loom-AI, etc.) para estos sistemas: subir
pantallas municipales con datos de vecinos a un tercero es **fuga de PII (Ley 21.719)**. La
grabación de navegador real, offline, no es una limitación: es el requisito. Cualquier "mejor
motor" tiene que cumplir eso, así que el camino es **subir de nivel a demo-engine**, no cambiarlo.

## Features de explainer del motor

**Ya disponibles en demo-engine v1.7.0** (importar desde `demo-engine`):
1. **`elenco(page, { cast, titulo, marca })`** — carta de presentación del reparto (foto + nombre
   + rol de cada personaje), sobre about:blank. Va al inicio del video.
2. **`presentar(page, { nombre, rol, foto })`** — lower-third del personaje que actúa, SOBRE la
   pantalla del sistema (no borra lo de abajo). `quitarPresentacion(page)` lo saca. Poné el
   lower-third al empezar la escena de ese personaje.
3. **`anotar(page, selector, texto, { esperaMs, permanecer })`** — resalta un elemento con un
   anillo y una etiqueta ("acá está el plazo legal"). Dirige la mirada en cada paso clave.
4. **`portada` / `cierre`** — cartas de título y recap con marca (`marca.escudo`, `marca.color`).
5. **`acercarA` / `pulsar`** — acercar el elemento clave y clic con cursor visible.

Las fotos se pasan como ruta de archivo (`demo/assets/<nombre>.png`) y el motor las incrusta; una
foto que falta cae a la inicial del nombre (degrada, no rompe).

**Pendiente para subir aún más el nivel** (aditivo; coordinar con Gemini, que edita el motor en
paralelo, y sacarlo como release con test, no como parche):
- Transiciones (fundido corto) entre capítulos al pegar el curso.
- Música de fondo tenue, normalizada bajo la voz.
- Subtítulos: ya se generan (mov_text); mantenerlos siempre.

## El manual de nivel corporativo (desde el mismo guion)

`demo manual <guion>` ya produce (v1.8.0) un PDF con **portada de marca + página de elenco +
secciones por escena con captura**. Para aprovecharlo, el guion declara:
- `guion.titulo`, `guion.subtitulo` (bajada), `guion.rol` (a qué rol aplica ese manual).
- `guion.elenco = [{ nombre, rol, foto }]` — el reparto que sale en la portada.

Y cada escena aporta su `titulo`, su `narrar` (el "para qué / pasos") y su captura. Para que el
manual quede completo, escribí el `narrar` con los pasos claros y dejá que "el sistema confirma"
aparezca en la captura (el toast real).

El manual y el video comparten elenco, orden y mensajes: son el mismo producto en dos formatos.

## Retratos del elenco (assets)

- **Ficticios, un retrato por personaje, reusado** (consistencia; no re-generar por escena).
- Prompt fijo por personaje: rostro inventado, edad/género, expresión amable, fondo neutro, foto
  tipo carnet, iluminación pareja. Diversidad realista de la comuna.
- Guardar en `demo/assets/<nombre>.png` y referenciar desde el guion.
- Si hay tool de imagen (Canva u otra), generarlos ahí; si no, entregar los prompts al usuario.
- Nunca la cara de un funcionario ni un vecino real.

## Definición de "máximo posible" para un sistema

1. Skill corre → catálogo funcional completo (con elenco + recorrido del caso).
2. Guiones por capítulo/rol, con arco corporativo y mensajes reales verificados.
3. `demo curso` → **video** explainer; `demo manual` → **manual PDF** por rol.
4. Auditoría de privacidad en verde (0 frames con PII real).
5. Todo desde una sola fuente, reutilizable y regenerable cuando el sistema cambie.
