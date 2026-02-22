#!/bin/bash
# Uninstall Gemini Daemon — removes daemon, menubar app, and LaunchAgent
set -euo pipefail

# Root-owned files (/usr/local/bin, /Applications) require sudo
if [ "$(id -u)" -ne 0 ]; then
    echo "Root privileges required to remove installed files."
    echo "Re-running with sudo..."
    exec sudo "$0" "$@"
fi

# Determine the real user (not root) for LaunchAgent operations
REAL_USER="${SUDO_USER:-$USER}"

echo "Uninstalling Gemini Daemon..."

# Stop daemon (in user's launchctl domain, not root's)
if sudo -u "$REAL_USER" launchctl list | grep -q "com.gemini-daemon" 2>/dev/null; then
    REAL_HOME=$(dscl . -read "/Users/$REAL_USER" NFSHomeDirectory | awk '{print $2}')
    sudo -u "$REAL_USER" launchctl unload "$REAL_HOME/Library/LaunchAgents/com.gemini-daemon.plist" 2>/dev/null || true
    echo "  Stopped daemon"
fi

# Stop menubar app
killall "GeminiDaemonMenuBar" 2>/dev/null || true

# Remove LaunchAgent plist
REAL_HOME=$(dscl . -read "/Users/$REAL_USER" NFSHomeDirectory | awk '{print $2}')
rm -f "$REAL_HOME/Library/LaunchAgents/com.gemini-daemon.plist"

# Remove installed files
rm -f /usr/local/bin/gemini-daemon
rm -rf "/Applications/Gemini Daemon.app"

echo ""
echo "Gemini Daemon uninstalled."
echo "Auth credentials left at $REAL_HOME/.gemini/ (remove manually if desired)"
echo "Log files left at $REAL_HOME/Library/Logs/gemini-daemon.*.log (remove manually if desired)"

# Remove self last
rm -f /usr/local/bin/gemini-daemon-uninstall
