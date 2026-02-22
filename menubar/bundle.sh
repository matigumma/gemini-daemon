#!/bin/bash
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Gemini Daemon"
BUNDLE_NAME="Gemini Daemon.app"
EXECUTABLE="GeminiDaemonMenuBar"
INSTALL_DIR="$HOME/Applications"

echo "==> Building release..."
cd "$PROJ_DIR"
swift build -c release

echo "==> Creating app bundle..."
BUNDLE_DIR="$PROJ_DIR/build/$BUNDLE_NAME"
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR/Contents/MacOS"
mkdir -p "$BUNDLE_DIR/Contents/Resources"

# Copy executable
cp ".build/release/$EXECUTABLE" "$BUNDLE_DIR/Contents/MacOS/$EXECUTABLE"

# Copy Info.plist
cp "$PROJ_DIR/Info.plist" "$BUNDLE_DIR/Contents/Resources/"
cp "$PROJ_DIR/Info.plist" "$BUNDLE_DIR/Contents/"

# Generate icns from emoji if no icon exists
ICON_PATH="$PROJ_DIR/AppIcon.icns"
if [ ! -f "$ICON_PATH" ]; then
    echo "==> Generating app icon..."
    ICONSET_DIR=$(mktemp -d)/AppIcon.iconset
    mkdir -p "$ICONSET_DIR"
    for SIZE in 16 32 64 128 256 512; do
        SIZE2X=$((SIZE * 2))
        # Render emoji to PNG using sips-compatible approach
        python3 -c "
import subprocess, tempfile, os
size = $SIZE
svg = f'''<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{size}\" height=\"{size}\">
  <rect width=\"{size}\" height=\"{size}\" rx=\"{size//5}\" fill=\"#1a1a2e\"/>
  <text x=\"50%\" y=\"58%\" text-anchor=\"middle\" dominant-baseline=\"central\"
        font-size=\"{int(size*0.65)}\" font-family=\"Apple Color Emoji\">&#x1F438;</text>
</svg>'''
tf = tempfile.NamedTemporaryFile(suffix='.svg', delete=False, mode='w')
tf.write(svg)
tf.close()
# Use qlmanage to render
subprocess.run(['qlmanage', '-t', '-s', str(size), '-o', '$ICONSET_DIR', tf.name],
               capture_output=True)
rendered = os.path.join('$ICONSET_DIR', os.path.basename(tf.name) + '.png')
target = os.path.join('$ICONSET_DIR', f'icon_{size}x{size}.png')
if os.path.exists(rendered):
    os.rename(rendered, target)
os.unlink(tf.name)
" 2>/dev/null || true
        # Also create @2x version
        if [ $SIZE -le 512 ]; then
            python3 -c "
import subprocess, tempfile, os
size = $SIZE2X
svg = f'''<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{size}\" height=\"{size}\">
  <rect width=\"{size}\" height=\"{size}\" rx=\"{size//5}\" fill=\"#1a1a2e\"/>
  <text x=\"50%\" y=\"58%\" text-anchor=\"middle\" dominant-baseline=\"central\"
        font-size=\"{int(size*0.65)}\" font-family=\"Apple Color Emoji\">&#x1F438;</text>
</svg>'''
tf = tempfile.NamedTemporaryFile(suffix='.svg', delete=False, mode='w')
tf.write(svg)
tf.close()
subprocess.run(['qlmanage', '-t', '-s', str(size), '-o', '$ICONSET_DIR', tf.name],
               capture_output=True)
rendered = os.path.join('$ICONSET_DIR', os.path.basename(tf.name) + '.png')
target = os.path.join('$ICONSET_DIR', f'icon_{$SIZE}x{$SIZE}@2x.png')
if os.path.exists(rendered):
    os.rename(rendered, target)
os.unlink(tf.name)
" 2>/dev/null || true
        fi
    done
    # Try iconutil, fall back to just copying what we have
    iconutil -c icns "$ICONSET_DIR" -o "$ICON_PATH" 2>/dev/null || true
    rm -rf "$(dirname "$ICONSET_DIR")"
fi

if [ -f "$ICON_PATH" ]; then
    cp "$ICON_PATH" "$BUNDLE_DIR/Contents/Resources/AppIcon.icns"
fi

echo "==> Installing to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/$BUNDLE_NAME"
cp -R "$BUNDLE_DIR" "$INSTALL_DIR/$BUNDLE_NAME"

echo ""
echo "Done! Installed to: $INSTALL_DIR/$BUNDLE_NAME"
echo "You can now open it from Finder or run:"
echo "  open \"$INSTALL_DIR/$BUNDLE_NAME\""
