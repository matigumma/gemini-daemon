#!/bin/bash
set -euo pipefail

DAEMON_DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST_NAME="com.gemini-daemon.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_DIR="$HOME/Library/Logs"
NODE_PATH="$(which node)"

echo "[install] Setting up gemini-daemon launchd service..."

# Ensure the daemon is built
if [ ! -f "$DAEMON_DIR/dist/index.js" ]; then
  echo "[install] Building gemini-daemon..."
  cd "$DAEMON_DIR" && pnpm build
fi

# Create log directory
mkdir -p "$LOG_DIR"

# Unload existing service if present
if launchctl list | grep -q "com.gemini-daemon" 2>/dev/null; then
  echo "[install] Unloading existing service..."
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Generate plist
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gemini-daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_PATH}</string>
        <string>${DAEMON_DIR}/dist/index.js</string>
        <string>--verbose</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${DAEMON_DIR}</string>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/gemini-daemon.out.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/gemini-daemon.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
EOF

echo "[install] Created $PLIST_PATH"

# Load the service
launchctl load "$PLIST_PATH"
echo "[install] Service loaded. gemini-daemon is now running."
echo ""
echo "Commands:"
echo "  launchctl unload $PLIST_PATH   # stop service"
echo "  launchctl load $PLIST_PATH     # start service"
echo "  tail -f $LOG_DIR/gemini-daemon.out.log  # view logs"
echo ""
echo "Test: curl http://127.0.0.1:7965/health"
