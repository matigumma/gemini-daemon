#!/bin/bash
set -euo pipefail

VERSION="0.1.0"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MENUBAR_DIR="$SCRIPT_DIR/menubar"
DIST_DIR="$SCRIPT_DIR/daemon/dist"
PKG_ROOT="$(mktemp -d)"
DMG_STAGING="$(mktemp -d)"

echo "=== Building Gemini Daemon $VERSION ==="

# -- Load OAuth credentials for Bun compile --
# Credentials can come from env vars (CI) or oauth-client.json (local dev)
if [ -z "${GEMINI_CLI_CLIENT_ID:-}" ] || [ -z "${GEMINI_CLI_CLIENT_SECRET:-}" ]; then
  OAUTH_CONFIG="$SCRIPT_DIR/daemon/oauth-client.json"
  if [ -f "$OAUTH_CONFIG" ]; then
    GEMINI_CLI_CLIENT_ID=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$OAUTH_CONFIG','utf8')).clientId)")
    GEMINI_CLI_CLIENT_SECRET=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$OAUTH_CONFIG','utf8')).clientSecret)")
  else
    echo "ERROR: OAuth credentials not found."
    echo "  Set GEMINI_CLI_CLIENT_ID and GEMINI_CLI_CLIENT_SECRET env vars,"
    echo "  or create daemon/oauth-client.json (see oauth-client.example.json)"
    exit 1
  fi
fi

# -- Step 1: Compile daemon to standalone binary with Bun --
echo ""
echo "[1/5] Compiling daemon binary..."
cd "$SCRIPT_DIR/daemon"
pnpm install --frozen-lockfile
bun build src/index.ts --compile --outfile "$DIST_DIR/gemini-daemon-bin" --minify \
  --define "process.env.GEMINI_CLI_CLIENT_ID=\"$GEMINI_CLI_CLIENT_ID\"" \
  --define "process.env.GEMINI_CLI_CLIENT_SECRET=\"$GEMINI_CLI_CLIENT_SECRET\""
echo "  -> $DIST_DIR/gemini-daemon-bin ($(du -h "$DIST_DIR/gemini-daemon-bin" | cut -f1))"

# -- Step 2: Build menubar .app bundle --
echo ""
echo "[2/5] Building menubar app..."
cd "$MENUBAR_DIR"
swift build -c release
bash bundle.sh
if [ ! -d "$MENUBAR_DIR/build/Gemini Daemon.app" ]; then
  echo "ERROR: bundle.sh did not produce build/Gemini Daemon.app"
  exit 1
fi
echo "  -> Gemini Daemon.app built"

# -- Step 3: Assemble pkg payload --
echo ""
echo "[3/5] Assembling package payload..."
mkdir -p "$PKG_ROOT/usr/local/bin"
mkdir -p "$PKG_ROOT/Applications"

cp "$DIST_DIR/gemini-daemon-bin" "$PKG_ROOT/usr/local/bin/gemini-daemon"
chmod +x "$PKG_ROOT/usr/local/bin/gemini-daemon"

cp -R "$MENUBAR_DIR/build/Gemini Daemon.app" "$PKG_ROOT/Applications/Gemini Daemon.app"

cp "$SCRIPT_DIR/daemon/pkg/uninstall.sh" "$PKG_ROOT/usr/local/bin/gemini-daemon-uninstall"
chmod +x "$PKG_ROOT/usr/local/bin/gemini-daemon-uninstall"

echo "  -> Payload assembled in $PKG_ROOT"

# -- Step 4: Build the .pkg --
echo ""
echo "[4/5] Building installer package..."
mkdir -p "$DIST_DIR"

pkgbuild \
  --root "$PKG_ROOT" \
  --scripts "$SCRIPT_DIR/daemon/pkg/scripts" \
  --identifier com.gemini-daemon \
  --version "$VERSION" \
  --install-location / \
  "$DIST_DIR/GeminiDaemon.pkg"

echo "  -> $DIST_DIR/GeminiDaemon.pkg"

# -- Step 5: Create the .dmg --
echo ""
echo "[5/5] Creating disk image..."
mkdir -p "$DMG_STAGING"
cp "$DIST_DIR/GeminiDaemon.pkg" "$DMG_STAGING/Install Gemini Daemon.pkg"
cp "$SCRIPT_DIR/README.md" "$DMG_STAGING/"

DMG_PATH="$DIST_DIR/GeminiDaemon-${VERSION}-arm64.dmg"
rm -f "$DMG_PATH"

hdiutil create \
  -volname "Gemini Daemon" \
  -srcfolder "$DMG_STAGING" \
  -ov -format UDZO \
  "$DMG_PATH"

echo "  -> $DMG_PATH"

# -- Cleanup --
rm -rf "$PKG_ROOT" "$DMG_STAGING"

echo ""
echo "=== Done! ==="
echo "Output: $DMG_PATH ($(du -h "$DMG_PATH" | cut -f1))"
