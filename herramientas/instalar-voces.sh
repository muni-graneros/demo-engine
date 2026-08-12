#!/usr/bin/env bash
# Descarga (una vez) los modelos de voz. Todo queda en disco: nada sale a internet al grabar.
set -euo pipefail
VENV="${DEMO_VENV:-$PWD/.venv}"
VOCES="${DEMO_VOCES:-$PWD/.voces}"
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
echo "Voces instaladas en $VOCES"
