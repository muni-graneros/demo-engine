# demo-engine

**Entidad:** Municipalidad de Graneros (motor interno del ecosistema municipal).

## Qué es

Motor Node/ESM (sin TypeScript) que graba, monta y publica videos-tutorial de los
sistemas municipales: lanza Chromium real vía Playwright, navega y simula clics/escritura,
aplica un **portero de privacidad** que cubre datos sensibles en pantalla, sintetiza voz
(Kokoro + Piper; opcionales Pocket TTS y Chatterbox, cada uno en su venv) sin servidor
externo, y monta el MP4 final con ffmpeg (`ffmpeg-static`, local, sin tocar ningún servidor
de los sistemas grabados).

Se instala como dependencia (`npm install github:muni-graneros/demo-engine`) **en la raíz
del proyecto que se va a grabar**, no en una subcarpeta separada — Node resuelve los
imports ESM del paquete desde la ubicación del script hacia arriba, y `NODE_PATH` no ayuda.

Está terminado; se trabaja en `develop` y se pushea solo si César lo pide (mirar
`git status -sb` para saber si hay commits locales pendientes).

## El «portero de privacidad»

`src/privacidad.mjs` + `demo auditar`: cubre pantallas completas (no elementos sueltos)
durante la grabación, y audita **el resultado** en disco (frames del MP4 vía OCR +
capturas incrustadas en el manual), sin confiar en que el guion llamó `abrirFiltrado`.
`exigirEntornoDeDesarrollo` aborta la grabación si no hay `DEMO_ENTORNO`/`APP_ENV`
declarado como local — la IP nunca autoriza, solo puede negar.

## El flag `--aislar`

**No es un flag del CLI de este repo.** Es una convención que `demo-engine` espera del
**sistema Laravel que se está grabando**: `demo.config.mjs` declara
`contexto.aislar = 'docker compose exec -T app php artisan demo:preparar-contexto --aislar'`
(y su contraparte `mostrar`/restaurar). El comando `--aislar` vive en el sistema grabado,
no acá.

## Sesiones en paralelo (Claude Code / Gemini Antigravity / terminal manual)

Varias sesiones de Claude Code y Gemini Antigravity trabajan sobre las mismas
copias de trabajo de `~/Dev`, esta incluida. Antes de tocar nada:
`/home/cesar/Dev/scripts/sesion estado .`. Al empezar: `sesion tomar . "qué vas a
hacer"`. Al terminar: `sesion soltar .`. No bloquea — es un aviso — pero si el
marcador es ajeno, mirá `git log --oneline -5` y `git status` antes de cualquier
`reset`/checkout, y commiteá siempre con `git commit --only -- <rutas>` (el índice
es compartido). Detalle y motivo en `~/Dev/CLAUDE.md`.

## Comandos reales

```bash
npm test                    # node pruebas/correr.mjs  (única fuente de verdad de tests)
node cli.mjs init           # andamiaje en el proyecto que se graba
node cli.mjs preparar       # sesiones de los actores
node cli.mjs grabar <guion>
node cli.mjs curso [maestro]
node cli.mjs manual [guion]
node cli.mjs contexto
node cli.mjs todo [maestro] # pipeline completo: aislar → pack → curso → manual → restaurar
node cli.mjs auditar <guion|video>
node cli.mjs formatos <video.mp4> [--vertical] [--cuadrado]  # 9:16 y 1:1, sin config
node cli.mjs vivo [maestro] [--desde=ID] [--auto] [--headless]  # demo en vivo (src/vivo/), sin grabar
```

Voces: `bash node_modules/demo-engine/herramientas/instalar-voces.sh` (descarga ~670 MB a
`~/.cache/demo-engine/`, no al árbol de trabajo — no lo repitas por worktree). `--pocket` /
`--chatterbox` agregan esos motores y, con red, bajan sus pesos de Hugging Face con una
síntesis de calentamiento: al grabar corren con `HF_HUB_OFFLINE=1` y nada sale a internet.

## Cómo se prueba

`npm test` ejecuta `node pruebas/correr.mjs`, que descubre y ejecuta todos los tests en
`pruebas/*.test.mjs`. El script es compatible con Node 20 y Node 22+, evitando la incompatibilidad
en Node 21+ donde pasar un directorio a `node --test` lo trata como módulo en vez de glob.
Hay pruebas de extremo a extremo (`extremo-a-extremo.test.mjs`, `juguete.test.mjs` contra un
servidor de juguete en `pruebas/juguete/`) además de unitarias por módulo (`privacidad`,
`auditoria`, `voz-*`, `ffmpeg`, `montaje`, etc.).

## Qué NO hacer

- No commitear contraseñas de actores en claro en `demo.config.mjs` de ningún sistema
  (el motor ya avisa cuando las detecta) ni voces/modelos dentro del repo.
- No instalar el paquete en el `node_modules` de una subcarpeta distinta de donde vive
  `demo.config.mjs`.
- No grabar contra un host que no cumpla `exigirEntornoDeDesarrollo` ni forzar con
  `DEMO_FORZAR=1` fuera de un entorno de verdad local.
- No saltarse el hook `commit-msg` (`.githooks/`, `core.hooksPath`): rechaza cualquier
  `Co-Authored-By: Claude` o referencia a `noreply@anthropic.com` en el mensaje.
- No hacer `git push` sin que César lo pida explícitamente.
