#!/usr/bin/env bash
# Descarga (una vez) los modelos de voz. Todo queda en disco: nada sale a internet al grabar.
#
# El destino por omisión es la caché del usuario, NO el directorio del paquete. Son ~670 MB
# (venv ~270 + modelos ~400): dentro del repo ensucian el árbol de trabajo, se duplican en
# cada worktree y en cada proyecto que instale demo-engine como dependencia, y se pierden
# con cada `rm -rf node_modules`. En la caché se bajan una vez por máquina y se comparten.
#
#   bash herramientas/instalar-voces.sh
#
# Se puede forzar otro destino con DEMO_VENV / DEMO_VOCES, que son las mismas variables que
# lee el motor (src/voz/resolver.mjs). También se respeta XDG_CACHE_HOME.
#
# ---------------------------------------------------------------------------------------
# ¿Ya tenías las voces dentro del repo?
#
# No hace falta hacer nada: el resolver mira el directorio del paquete ANTES que la caché,
# así que una instalación vieja sigue funcionando tal cual. Si igual las querés mover para
# recuperar el espacio del árbol de trabajo:
#
#   raiz="${XDG_CACHE_HOME:-$HOME/.cache}/demo-engine"
#   mkdir -p "$raiz"
#   mv .voces "$raiz/voces"
#   rm -rf .venv                                   # el venv trae rutas absolutas horneadas
#   bash herramientas/instalar-voces.sh            # lo recrea en la caché; no rebaja modelos
#
# El venv NO se mueve, se rehace: sus scripts y su pyvenv.cfg guardan la ruta absoluta con
# la que se creó, y un venv movido a mano queda apuntando a un intérprete que no está ahí.
# Los modelos sí son archivos sueltos y se mueven sin problema; el script se saltea las
# descargas que ya existan en el destino.
# ---------------------------------------------------------------------------------------
set -euo pipefail

RAIZ="${XDG_CACHE_HOME:-$HOME/.cache}/demo-engine"
VENV="${DEMO_VENV:-$RAIZ/venv}"
VOCES="${DEMO_VOCES:-$RAIZ/voces}"
mkdir -p "$VOCES"

python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q piper-tts kokoro-onnx soundfile

base="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
[ -f "$VOCES/kokoro-v1.0.onnx" ] || curl -L "$base/kokoro-v1.0.onnx" -o "$VOCES/kokoro-v1.0.onnx"
[ -f "$VOCES/voices-v1.0.bin" ] || curl -L "$base/voices-v1.0.bin"  -o "$VOCES/voices-v1.0.bin"

piper="https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium"
for ext in onnx onnx.json; do
  [ -f "$VOCES/es_ES-davefx-medium.$ext" ] || \
    curl -L "$piper/es_ES-davefx-medium.$ext" -o "$VOCES/es_ES-davefx-medium.$ext"
done
echo "Venv instalado en  $VENV"
echo "Voces instaladas en $VOCES"
