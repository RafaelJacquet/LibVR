#!/usr/bin/env bash
# Précalcule l'éclairage d'une map exportée par l'éditeur Moda (décor + objets placés).
#   bash tools/scene-bureau/render_map.sh tools/scene-bureau/sources/bureau_nofurn-map.glb [final|quick]
# Résultat : scenes/bureau/<map>_rendu.glb (l'export Moda d'origine n'est pas modifié).
# La variante du décor (bureau / bureau_nofurn) est déduite de la map elle-même.
# Pour l'ajouter aux lieux de l'appli : une entrée dans MAPS (src/config.js), puis
# `node tools/previews.cjs` pour son aperçu.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
MAP="$(realpath "$1")"
MODE="${2:-final}"
NAME="$(basename "${MAP%.glb}")_rendu"
BLENDER="${BLENDER:-/mnt/c/Program Files/Blender Foundation/Blender 5.2/blender.exe}"
OUTDIR="$HERE/out-$MODE-$(basename "${MAP%.glb}")"
mkdir -p "$OUTDIR"
cd "$HERE"
[ -d assets/textures ] || python3 fetch_assets.py
"$BLENDER" -b --factory-startup --python "$(wslpath -w "$HERE/build_scene.py")" -- \
  "$(wslpath -w "$HERE/assets")" "$(wslpath -w "$OUTDIR")" "$MODE" "" "$(wslpath -w "$MAP")" 2>&1 \
  | grep -vE "^(Fra:|Info: Saved)" | tee "$OUTDIR/build.log"
rm -f "$OUTDIR"/lightmap_raw.npy "$OUTDIR"/lightmap_denoised.exr "$OUTDIR"/*.blend1 "$OUTDIR"/*_avant_bake.blend
mkdir -p "$ROOT/scenes/bureau"
cp "$OUTDIR/$NAME.glb" "$ROOT/scenes/bureau/$NAME.glb"
echo "→ scenes/bureau/$NAME.glb"
