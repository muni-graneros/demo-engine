#!/usr/bin/env bash
# Descarga (una vez) los modelos de voz. Todo queda en disco: nada sale a internet al grabar.
#
# El destino por omisión es la caché del usuario, NO el directorio del paquete. Son ~670 MB
# (venv ~270 + modelos ~400): dentro del repo ensucian el árbol de trabajo, se duplican en
# cada worktree y en cada proyecto que instale demo-engine como dependencia, y se pierden
# con cada `rm -rf node_modules`. En la caché se bajan una vez por máquina y se comparten.
#
#   bash herramientas/instalar-voces.sh
#   bash herramientas/instalar-voces.sh --pocket        # además, Pocket TTS (venv-pocket)
#   bash herramientas/instalar-voces.sh --chatterbox    # además, Chatterbox (venv-chatterbox)
#
# Pocket y Chatterbox van en venvs PROPIOS, hermanos de `venv`: los dos arrastran torch (CPU),
# y mezclarlo con kokoro-onnx en un solo venv obliga a rehacer todo si una pila se rompe.
# Son opcionales: sin flags el script hace exactamente lo mismo de siempre. Sus pesos se bajan
# de Hugging Face la primera vez que el motor sintetiza, no acá.
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

POCKET=0
CHATTERBOX=0
for arg in "$@"; do
  case "$arg" in
    --pocket) POCKET=1 ;;
    --chatterbox) CHATTERBOX=1 ;;
    *) echo "Flag desconocido: $arg (válidos: --pocket, --chatterbox)" >&2; exit 2 ;;
  esac
done

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

# Se usa $RAIZ y no $VENV: DEMO_VENV nombra el venv de kokoro/piper, y el motor busca estos
# dos en <caché>/demo-engine/venv-{pocket,chatterbox} (src/voz/pocket.mjs, chatterbox.mjs).
#
# Cada paso va en su propia línea a propósito: con `a && b && c`, `set -e` NO aborta si falla
# un comando que no es el último, y el script imprimía «instalado» y salía con 0 tras un pip roto.
#
# torch y el paquete se resuelven en UNA sola instalación con el índice de CPU como extra: si
# se instala torch CPU primero, el paquete puede fijar otra versión y pip la reemplaza por una
# build con CUDA de varios GB. Después se verifica que efectivamente quedó la de CPU.
verificar_torch_cpu() {
  "$1/bin/python" -c "import torch,sys; sys.exit(1 if torch.version.cuda else 0)" || {
    echo "ERROR: en $1 quedó instalado torch con CUDA (varios GB, inútil en esta máquina): abortar." >&2
    exit 1
  }
}

if [ "$POCKET" = 1 ]; then
  V="$RAIZ/venv-pocket"
  python3 -m venv "$V"
  "$V/bin/pip" install -q --upgrade pip
  "$V/bin/pip" install --extra-index-url https://download.pytorch.org/whl/cpu pocket-tts scipy
  verificar_torch_cpu "$V"
  echo "Pocket TTS instalado en $V"
  echo "  AVISO: los pesos de Pocket TTS (Kyutai) son CC-BY-4.0: todo video que use esta voz"
  echo "  tiene que atribuirlo en los créditos (p. ej. «Voz sintética: Pocket TTS, Kyutai, CC-BY-4.0»)."
  echo "  Clonar una voz a partir de un .wav exige el consentimiento escrito de esa persona (Ley 21.719)."
fi

if [ "$CHATTERBOX" = 1 ]; then
  V="$RAIZ/venv-chatterbox"
  python3 -m venv "$V"
  "$V/bin/pip" install -q --upgrade pip
  "$V/bin/pip" install --extra-index-url https://download.pytorch.org/whl/cpu chatterbox-tts torchaudio
  verificar_torch_cpu "$V"
  echo "Chatterbox instalado en $V"
  echo "  AVISO: Chatterbox siempre clona una voz de referencia (voz: ruta a un .wav). Usar solo la"
  echo "  voz de una persona que dio su consentimiento por escrito (Ley 21.719: la voz es dato personal)."
  echo "  El audio lleva la marca de agua Perth de Resemble, que lo identifica como voz sintética."
fi
