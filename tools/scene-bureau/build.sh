#!/usr/bin/env bash
# Construit le décor « bureau » avec Blender (Windows) depuis WSL.
#   bash tools/scene-bureau/build.sh quick          # aperçu rapide (~quelques minutes)
#   bash tools/scene-bureau/build.sh final          # qualité finale (lightmap 4K) → scenes/bureau/bureau.glb (Bureau 1)
#   bash tools/scene-bureau/build.sh final nofurn   # base vide pour Moda → tools/scene-bureau/sources/bureau_nofurn.glb
# Ne sont gardés dans out-<mode>/ que le .glb, le .blend final et ses textures (les fichiers
# intermédiaires du précalcul, très lourds, sont supprimés à la fin).
set -euo pipefail
cd "$(dirname "$0")"
MODE="${1:-quick}"
VARIANT="${2:-}"
NAME="bureau${VARIANT:+_$VARIANT}"
BLENDER="${BLENDER:-/mnt/c/Program Files/Blender Foundation/Blender 5.2/blender.exe}"
OUTDIR="$PWD/out-$MODE${VARIANT:+-$VARIANT}"
mkdir -p "$OUTDIR"
[ -d assets/textures ] || python3 fetch_assets.py
"$BLENDER" -b --factory-startup --python "$(wslpath -w "$PWD/build_scene.py")" -- \
  "$(wslpath -w "$PWD/assets")" "$(wslpath -w "$OUTDIR")" "$MODE" "$VARIANT" 2>&1 | grep -vE "^(Fra:|Info: Saved)" | tee "$OUTDIR/build.log"
rm -f "$OUTDIR"/lightmap_raw.npy "$OUTDIR"/lightmap_denoised.exr "$OUTDIR"/*.blend1 "$OUTDIR"/*_avant_bake.blend
if [ "$MODE" = "final" ]; then
  if [ "$VARIANT" = "nofurn" ]; then DEST="sources"; else DEST="../../scenes/bureau"; fi
  mkdir -p "$DEST"
  cp "$OUTDIR/$NAME.glb" "$DEST/$NAME.glb"
  echo "→ $(realpath --relative-to=../.. "$DEST/$NAME.glb") mis à jour"
fi
