# Empezar en este sistema

`demo init` te dejó: `demo.config.mjs`, `demo/guiones/` (con `_elenco.mjs`, `_ui.mjs`,
`ejemplo.mjs`, `curso.mjs`) y esta guía. Pasos para tener el tutorial completo:

## 1. Configura
Edita `demo.config.mjs`: `baseURL`, la `marca` (con el escudo), el `login` (verifica los
selectores en vivo) y los `actores`. Pon las fotos del elenco en `demo/assets/` y ajústalas en
`demo/guiones/_elenco.mjs`.

## 2. Escribe un guion por flujo
Copia `ejemplo.mjs` por cada flujo. El patrón: **portada → elenco → el flujo real → cierre**.
Reglas que hacen que se vea VIVO:
- **Teclea los datos a la vista** con `tipear(page, selector, texto)` (no `fill` instantáneo).
- **Muestra la notificación** tras cada acción con `esperarAviso(page)`.
- Verifica los selectores REALES en vivo antes de guionizar; no los asumas del código.
Encadénalos en `curso.mjs`.

## 3. El dataset determinista (clave, específico de tu sistema)
Para que las pantallas salgan pobladas y SIN PII, tu sistema necesita un comando que:
- Siembre un mundo ficticio **determinista e idempotente** (el elenco como registros reales,
  datos con identificadores válidos, y al menos un registro por cada estado posible).
- **Oculte los datos reales** durante la captura y los **restaure** después (reversible).

En Laravel, un `php artisan demo:preparar-contexto` con flags `--aislar` / `--mostrar`. Modelo
de referencia (idempotente, con seguro para restaurar): pídeselo a Claude con la skill
`mapa-funcional`, que trae la plantilla del seeder. Luego apunta `contexto.aislar` /
`contexto.mostrar` en `demo.config.mjs` a ese comando.

## 4. Genera todo
```
demo preparar     # inicia sesión de los actores (una vez)
demo todo         # aislar → pack de contexto → curso (video) → manual (PDF) → restaurar PII
```
Salidas en `config.salida` y `config.contexto.salida`. **No versiones** los videos ni el pack
(son binarios grandes y data sensible): agrégalos a `.gitignore`.

## 5. El mapa de flujos (Mermaid)
El mapa visual del sistema no lo hace el CLI: lo produce el análisis funcional con la skill
`mapa-funcional` y se publica como artifact. Es el paso previo que da el ORDEN de los capítulos.
