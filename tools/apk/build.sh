#!/usr/bin/env bash
# ============================================================================
#  Construit dist/protoLibVR.apk : lanceur hors-ligne pour Meta Quest.
#  L'APK embarque tout le site (vidéos comprises), le sert en local et l'ouvre
#  dans le Quest Browser. Aucun Gradle : SDK Android (côté Windows) + JDK (WSL).
#
#  Usage : bash tools/apk/build.sh
#  Variables : ANDROID_SDK (défaut : SDK Windows de l'utilisateur), VERSION_CODE, VERSION_NAME,
#    APP_NAME / APP_ID / PORT / APK_FILE : identité de l'appli. Chaque variante a son propre
#    identifiant et son propre port, et peut donc être installée à côté des autres. Ancienne
#    « Bibliothèque VR » :
#    APP_NAME="Bibliothèque VR" APP_ID=com.frenchflair.libvr PORT=8723 APK_FILE=BibliothequeVR bash tools/apk/build.sh
# ============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SDK="${ANDROID_SDK:-/mnt/c/Users/rafae/AppData/Local/Android/Sdk}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -n1)"
PLATFORM="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -n1)"
ANDROID_JAR="$PLATFORM/android.jar"
VERSION_CODE="${VERSION_CODE:-1}"
VERSION_NAME="${VERSION_NAME:-1.0}"
APP_NAME="${APP_NAME:-protoLibVR}"
APP_ID="${APP_ID:-com.frenchflair.protolibvr}"
PORT="${PORT:-8724}"
APK_FILE="${APK_FILE:-protoLibVR}"
KEYSTORE="$HERE/libvr.keystore"   # à conserver : les mises à jour doivent être signées pareil
KS_PASS="libvr-quest"

BUILD="$HERE/build"
OUT="$ROOT/dist/$APK_FILE.apk"
rm -rf "$BUILD"; mkdir -p "$BUILD"/{classes,dex,stage/assets/web} "$ROOT/dist"

# Les outils Windows (.exe) se bloquent quand ils écrivent dans un dossier WSL (\\wsl.localhost\...) :
# ils travaillent donc dans un dossier temporaire Windows, avec des chemins relatifs à « \ ».
WIN_TMP="$(wslpath "$(cmd.exe /c echo %TEMP% 2>/dev/null | tr -d '\r')")"
[ -n "$WIN_TMP" ] && [ -d "$WIN_TMP" ] || { echo "Dossier temporaire Windows introuvable"; exit 1; }
WORK="$WIN_TMP/libvr-apk"
rm -rf "$WORK"; mkdir -p "$WORK"/{res,resdir/mipmap}
AAPT2="$BT/aapt2.exe"; ZIPALIGN="$BT/zipalign.exe"
WIN_ANDROID_JAR="$(wslpath -w "$ANDROID_JAR")"

echo "== 1/6 Icône et ressources"
python3 "$HERE/make_icon.py" "$WORK/resdir/mipmap/ic_launcher.png" "$([ "$APP_ID" = com.frenchflair.libvr ] || echo proto)"
sed "s|android:label=\"[^\"]*\"|android:label=\"$APP_NAME\"|" "$HERE/AndroidManifest.xml" > "$WORK/AndroidManifest.xml"
( cd "$WORK" && "$AAPT2" compile -o res 'resdir\mipmap\ic_launcher.png' )

echo "== 2/6 Manifeste (aapt2 link)"
( cd "$WORK" && "$AAPT2" link -o base.apk -I "$WIN_ANDROID_JAR" --manifest AndroidManifest.xml \
    --min-sdk-version 29 --target-sdk-version 32 \
    --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
    --rename-manifest-package "$APP_ID" \
    'res\mipmap_ic_launcher.png.flat' )

echo "== 3/6 Compilation Java + dex"
cp -r "$HERE/src" "$BUILD/src"
cat > "$BUILD/src/com/frenchflair/libvr/AppConfig.java" <<JAVA
package com.frenchflair.libvr;

/** Généré par tools/apk/build.sh */
final class AppConfig {
    static final String NAME = "$APP_NAME";
    static final int PORT = $PORT;

    private AppConfig() {}
}
JAVA
javac -nowarn --release 11 -encoding UTF-8 -cp "$ANDROID_JAR" -d "$BUILD/classes" $(find "$BUILD/src" -name '*.java') 2>&1 \
  | grep -v '^warning: \[options\]' || true
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 --release --min-api 29 --lib "$ANDROID_JAR" \
  --output "$BUILD/dex" $(find "$BUILD/classes" -name '*.class')

echo "== 4/6 Site web (assets/web, stocké sans compression pour la lecture vidéo)"
for p in index.html src vendor assets scenes videos; do cp -rL "$ROOT/$p" "$BUILD/stage/assets/web/"; done
find "$BUILD/stage" -name '*:Zone.Identifier' -delete
cp "$BUILD/dex/classes.dex" "$BUILD/stage/"
( cd "$BUILD/stage" && zip -q -0 -r "$WORK/base.apk" assets classes.dex )

echo "== 5/6 Alignement (zipalign)"
( cd "$WORK" && "$ZIPALIGN" -f -p 4 base.apk aligned.apk )

echo "== 6/6 Signature (apksigner)"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" -alias libvr \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Bibliotheque VR" >/dev/null 2>&1
fi
java -jar "$BT/lib/apksigner.jar" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" \
  --out "$OUT" "$WORK/aligned.apk"
java -jar "$BT/lib/apksigner.jar" verify "$OUT"
rm -f "$OUT.idsig"; rm -rf "$WORK" "$BUILD"

echo
echo "APK prêt : $OUT ($(du -h "$OUT" | cut -f1)) — « $APP_NAME » ($APP_ID, port $PORT)"
