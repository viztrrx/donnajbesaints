#!/usr/bin/env bash
# Builds the REAL EaglercraftX 1.8 JavaScript client for the Eaglercraft tab,
# with EaglercraftX's own build tool (CompileLatestClient, headless mode).
# Nothing here is a stand-in: the output is what the official tool produces.
#
#   npm run build:eaglercraft          (or: bash scripts/build-eaglercraft.sh)
#
# Output: build/eaglercraft-client/  (classes.js, classes.js.map, assets.epk,
#         lang/, index.html, favicon.png). It contains Mojang's code and
#         assets: host it privately and point EAGLER_CLIENT at it. build/ is
#         git-ignored; never commit it.
#
# Needs: Java 11+ (17+ recommended), git, curl, node, ffmpeg, and these three
# inputs in build/eaglercraft-inputs/ (or the paths below):
#   1.8.8.jar   Minecraft 1.8.8 client      } downloaded from Mojang's official
#   1.8.json    Minecraft 1.8 asset index   } version manifest if missing
#   mcp918.zip  Mod Coder Pack 9.18          you supply it (no official
#                                             download host exists any more)
# The build also downloads the game's sounds and languages listed in
# 1.8.json from resources.download.minecraft.net, and TeaVM from Maven Central.
#
# Settings (environment variables, all optional):
#   EAGLER_SRC_REPO   EaglercraftX 1.8 source repository
#   EAGLER_SRC_REF    commit to build (pinned: the one the loader was checked
#                     against, client version u35)
#   MCP918_ZIP / MINECRAFT_JAR / ASSETS_INDEX   input paths
#   EAGLER_OUT_DIR    output folder (default build/eaglercraft-client)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/build"
WORK="$BUILD/eaglercraft-work"
INPUTS="${EAGLER_INPUTS_DIR:-$BUILD/eaglercraft-inputs}"
OUT="${EAGLER_OUT_DIR:-$BUILD/eaglercraft-client}"
SRC_REPO="${EAGLER_SRC_REPO:-https://github.com/3kh0/eaglercraft-1.8.git}"
SRC_REF="${EAGLER_SRC_REF:-4cb71c5033b9e42245963464976aaa9a799703b4}"
MCP918_ZIP="${MCP918_ZIP:-$INPUTS/mcp918.zip}"
MINECRAFT_JAR="${MINECRAFT_JAR:-$INPUTS/1.8.8.jar}"
ASSETS_INDEX="${ASSETS_INDEX:-$INPUTS/1.8.json}"
MAVEN_URL="${EAGLER_MAVEN_URL:-https://repo1.maven.org/maven2/}"

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nBUILD STOPPED: %s\n' "$*" >&2; exit 1; }

# ---- 1. Tools --------------------------------------------------------------
step "Checking tools"
for t in java git curl node ffmpeg; do command -v "$t" >/dev/null || fail "'$t' is not installed."; done
JAVA_MAJOR="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
[ "${JAVA_MAJOR:-0}" -ge 11 ] || fail "Java 11 or newer is required (found: ${JAVA_MAJOR:-none})."
echo "java $JAVA_MAJOR, $(git --version), node $(node -v), $(ffmpeg -version | head -1 | cut -d' ' -f1-3)"

# ---- 2. EaglercraftX source (patches + build tool; no Minecraft code) --------
step "EaglercraftX 1.8 source: $SRC_REPO @ $SRC_REF"
SRC="$WORK/source"
if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$WORK"
  git clone --filter=blob:none --no-checkout "$SRC_REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet --depth 1 origin "$SRC_REF" 2>/dev/null || git -C "$SRC" fetch --quiet origin
git -C "$SRC" checkout --quiet --force "$SRC_REF"
[ -f "$SRC/buildtools/BuildTools.jar" ] || fail "buildtools/BuildTools.jar missing from the source checkout."
echo "client version: $(cat "$SRC/client_version" 2>/dev/null || echo unknown)"

# ---- 3. Inputs ---------------------------------------------------------------
step "Inputs"
mkdir -p "$INPUTS"
if [ ! -s "$MINECRAFT_JAR" ] || [ ! -s "$ASSETS_INDEX" ]; then
  echo "Downloading Minecraft 1.8.8 client jar and 1.8 asset index from Mojang's official manifest..."
  node - "$MINECRAFT_JAR" "$ASSETS_INDEX" <<'NODE' || fail "Could not download from Mojang (piston-meta.mojang.com / piston-data.mojang.com). Check your network, or place 1.8.8.jar and 1.8.json in build/eaglercraft-inputs/ yourself."
const fs = require('fs'), crypto = require('crypto');
const [jarPath, indexPath] = process.argv.slice(2);
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' -> HTTP ' + r.status); return Buffer.from(await r.arrayBuffer()); };
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
(async () => {
  const manifest = JSON.parse(await get('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'));
  const v = manifest.versions.find((x) => x.id === '1.8.8');
  const ver = JSON.parse(await get(v.url));
  for (const [path, d] of [[jarPath, ver.downloads.client], [indexPath, ver.assetIndex]]) {
    if (fs.existsSync(path) && fs.statSync(path).size) continue;
    const b = await get(d.url);
    if (sha1(b) !== d.sha1) throw new Error('checksum mismatch for ' + d.url);
    fs.writeFileSync(path, b);
    console.log('  saved ' + path + ' (' + b.length + ' bytes, sha1 ok)');
  }
})().catch((e) => { console.error('  ' + e.message); process.exit(1); });
NODE
fi
[ -s "$MINECRAFT_JAR" ] || fail "Missing $MINECRAFT_JAR"
[ -s "$ASSETS_INDEX" ] || fail "Missing $ASSETS_INDEX"
[ -s "$MCP918_ZIP" ] || fail "Missing Mod Coder Pack 9.18: put mcp918.zip at $MCP918_ZIP (or set MCP918_ZIP).
The build decompiles the Minecraft jar with it and maps the names the patches use. It is not on any official download host any more."
echo "1.8.8.jar, 1.8.json and mcp918.zip present."

# ---- 4. Run the official headless compiler ------------------------------------
step "Compiling (this takes a while: decompile, patch, javac, TeaVM, EPK, sounds)"
rm -rf "$OUT"
mkdir -p "$OUT" "$WORK/tmp" "$WORK/maven"
CONFIG="$WORK/compile-config.json"
node -e '
const [src, mcp, jar, idx, out, tmp, maven, mavenUrl] = process.argv.slice(1);
require("fs").writeFileSync(process.argv[9], JSON.stringify({
  repositoryFolder: src, modCoderPack: mcp, minecraftJar: jar, assetsIndex: idx,
  outputDirectory: out, temporaryDirectory: tmp, ffmpeg: "ffmpeg",
  mavenURL: mavenUrl, mavenLocal: maven,
  productionIndex: src + "/buildtools/production-index.html",
  productionFavicon: src + "/buildtools/production-favicon.png",
  generateOfflineDownload: false, keepTemporaryFiles: false,
  writeSourceMap: true, minifying: true
}, null, 2));
' "$SRC" "$MCP918_ZIP" "$MINECRAFT_JAR" "$ASSETS_INDEX" "$OUT" "$WORK/tmp" "$WORK/maven" "$MAVEN_URL" "$CONFIG"
( cd "$SRC" && java -Xmx4G -Deaglercraft.isJava11=true -cp buildtools/BuildTools.jar \
    net.lax1dude.eaglercraft.v1_8.buildtools.gui.headless.CompileLatestClientHeadless -y "$CONFIG" )

# ---- 5. Check the output -------------------------------------------------------
step "Output: $OUT"
for f in classes.js assets.epk; do [ -s "$OUT/$f" ] || fail "The compiler finished but $f is missing or empty."; done
ls -la "$OUT"
echo
echo "Done. Next:"
echo "  1. Check it:   EAGLER_CLIENT_DIR=\"$OUT\" node tests/browser/real-client.mjs"
echo "  2. Upload the folder (as is) to a private HTTPS static host."
echo "  3. Set EAGLER_CLIENT=https://<host>/eaglercraft-client/ on the donnajbe Worker."
