# Gemini Daemon

Local HTTP proxy that exposes Google's Gemini API through an **OpenAI-compatible** interface. Use Gemini models with any tool that speaks the OpenAI chat completions protocol — Claude Code, Cursor, Continue, aider, and more.

Runs on `localhost:7965` as a macOS LaunchAgent with a menubar app for status monitoring.

<!-- ![Screenshot](screenshot.png) -->

## Quick Install

1. Download `GeminiDaemon-x.x.x-arm64.dmg` from [Releases](../../releases)
2. Open the DMG and double-click **Install Gemini Daemon.pkg**
3. Follow the installer prompts (the package is unsigned — right-click and select Open if blocked)
4. The daemon starts automatically and the menubar frog icon appears

## Authentication

Authenticate with Google using the [Gemini CLI](https://github.com/google-gemini/gemini-cli):

```bash
npx @google/gemini-cli
```

Select **Login with Google** when prompted. This stores OAuth credentials at `~/.gemini/oauth_creds.json` — the daemon picks them up automatically.

## Usage

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check with uptime, version, auth status |
| POST | `/v1/chat/completions` | OpenAI-compatible chat completions (streaming supported) |
| GET | `/v1/models` | List available Gemini models |
| GET | `/quota` | Per-model quota usage |
| GET | `/stats` | Request counts by model |

### Examples

```bash
# Health check
curl http://localhost:7965/health

# Chat completion
curl http://localhost:7965/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# Streaming
curl http://localhost:7965/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.5-flash",
    "stream": true,
    "messages": [{"role": "user", "content": "Hello"}]
  }'

# List models
curl http://localhost:7965/v1/models
```

### Client Configuration

Point any OpenAI-compatible client at `http://localhost:7965/v1`:

```bash
# Environment variables (works with most clients)
export OPENAI_API_BASE=http://localhost:7965/v1
export OPENAI_API_KEY=unused  # required by some clients, value doesn't matter
```

### Logs

```bash
tail -f ~/Library/Logs/gemini-daemon.out.log
tail -f ~/Library/Logs/gemini-daemon.err.log
```

### Managing the Service

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.gemini-daemon.plist

# Start
launchctl load ~/Library/LaunchAgents/com.gemini-daemon.plist
```

Or use the menubar app's Start/Stop/Restart controls.

## What's Inside

| Directory | Description |
|-----------|-------------|
| `daemon/` | Node.js/TypeScript HTTP proxy server. Translates OpenAI chat completions requests to Gemini API calls and streams responses back. |
| `menubar/` | Native Swift macOS menubar app. Monitors daemon health, displays quota/stats, and provides quick-prompt chat. |

## Build from Source

**Prerequisites:** Node.js 22+, pnpm, Swift 5.10+, macOS 14+, [Bun](https://bun.sh) (for DMG builds only)

```bash
# Build both components
make

# Build individually
make daemon   # pnpm install + pnpm build
make menubar  # swift build + app bundle

# Install locally (builds + starts service + copies app)
make install

# Build the DMG installer
make dmg

# Run tests
cd daemon && pnpm test
```

## Uninstall

If installed via DMG:

```bash
gemini-daemon-uninstall
```

If installed from source:

```bash
make uninstall
```

This removes the daemon binary, menubar app, and LaunchAgent. Auth credentials at `~/.gemini/` are left in place.

## License

[MIT](LICENSE)
