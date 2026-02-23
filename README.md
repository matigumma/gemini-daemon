# Gemini Daemon

[![CI](https://github.com/matigumma/gemini-daemon/actions/workflows/ci.yml/badge.svg)](https://github.com/matigumma/gemini-daemon/actions/workflows/ci.yml)

Local HTTP proxy that exposes Google's Gemini API through an **OpenAI-compatible** interface. Use Gemini models with any tool that speaks the OpenAI chat completions protocol — Claude Code, Cursor, Continue, aider, and more.

Runs on `localhost:7965` as a macOS LaunchAgent with a native menubar app for status monitoring, quota tracking, and quick-prompt chat.

---

Proxy HTTP local que expone la API de Google Gemini a traves de una interfaz **compatible con OpenAI**. Usa modelos Gemini con cualquier herramienta que hable el protocolo de chat completions de OpenAI — Claude Code, Cursor, Continue, aider, y mas.

Corre en `localhost:7965` como un LaunchAgent de macOS con una app nativa en la barra de menu para monitorear el estado, seguimiento de cuota y chat rapido.

## Quick Install

1. Download [`GeminiDaemon-0.1.0-arm64.dmg`](https://github.com/matigumma/gemini-daemon/releases/latest/download/GeminiDaemon-0.1.0-arm64.dmg) from [Releases](https://github.com/matigumma/gemini-daemon/releases)
2. Open the DMG and double-click **Install Gemini Daemon.pkg**
3. Follow the installer prompts (the package is unsigned — right-click and select Open if blocked)
4. The daemon starts automatically and the menubar frog icon appears

## Authentication

Authenticate with Google using the [Gemini CLI](https://github.com/google-gemini/gemini-cli):

```bash
npx @google/gemini-cli
```

Select **Login with Google** when prompted. This stores OAuth credentials at `~/.gemini/oauth_creds.json` — the daemon picks them up automatically.

## Supported Models

| Model | Aliases |
|-------|---------|
| `gemini-2.5-pro` | `pro` |
| `gemini-2.5-flash` (default) | `flash` |
| `gemini-2.0-flash` | |
| `gemini-2.0-flash-lite` | |

Any model name not listed is passed through as-is, so new models work without updating the daemon.

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

**Claude Code:**

```bash
claude --provider openai --endpoint http://localhost:7965/v1 --model gemini-2.5-flash
```

**[OpenClaw](https://github.com/nichochar/open-claw):**

The menubar app includes a one-click "Register on OpenClaw..." option that automatically configures gemini-daemon as a model provider in `~/.openclaw/openclaw.json`. Just click it from the menubar menu — no manual config needed.

La app de la barra de menu incluye la opcion "Register on OpenClaw..." que configura automaticamente gemini-daemon como proveedor de modelos en `~/.openclaw/openclaw.json`. Solo hace falta un click desde el menu — no requiere configuracion manual.

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
| `daemon/` | TypeScript HTTP server (Hono). Translates OpenAI chat completions to Gemini API calls with SSE streaming, retry logic, and quota tracking. |
| `menubar/` | Native Swift menubar app. Monitors daemon health, displays per-model quota/stats, and provides a quick-prompt chat window. |

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
cd daemon && pnpm test          # unit + integration (77 tests)
cd daemon && pnpm test:smoke    # end-to-end smoke test against running daemon
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

## Contributing / Contribuir

1. Fork the repo and create a branch from `main` / Hacete un fork y crea una rama desde `main`
2. Keep changes focused — one feature or fix per PR / Mantene los cambios enfocados — una feature o fix por PR
3. Run tests before submitting / Correr los tests antes de enviar:
   ```bash
   cd daemon && pnpm test
   cd menubar && swift build
   ```
4. Write a clear PR description explaining *what* and *why* / Escribi una descripcion clara en el PR explicando *que* y *por que*
5. Be respectful in reviews and discussions / Se respetuoso en las reviews y discusiones

See [CONTRIBUTING.md](CONTRIBUTING.md) for full setup and development details.

Consulta [CONTRIBUTING.md](CONTRIBUTING.md) para detalles completos de setup y desarrollo.

## License

[MIT](LICENSE)
