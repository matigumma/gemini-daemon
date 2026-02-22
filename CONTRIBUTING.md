# Contributing

## Project Structure

```
daemon/    Node.js/TypeScript proxy server
menubar/   Swift macOS menubar app
```

The two components are independent — they share no code. The daemon is a standalone HTTP server; the menubar app communicates with it over `localhost:7965`.

## Prerequisites

- **macOS 14+** (Sonoma or later)
- **Node.js 22+**
- **pnpm** (package manager)
- **Swift 5.10+** (included with Xcode 15.3+)
- **Bun** (only needed for `make dmg`)

## Setup

The daemon uses the Gemini CLI's public OAuth client credentials. These are not secret — they're embedded in [Google's open-source gemini-cli](https://github.com/google-gemini/gemini-cli) — but are excluded from this repo to satisfy GitHub's push protection.

Create `daemon/oauth-client.json` using the template:

```bash
cp daemon/oauth-client.example.json daemon/oauth-client.json
# Fill in clientId and clientSecret from the gemini-cli source
```

Alternatively, set environment variables `GEMINI_CLI_CLIENT_ID` and `GEMINI_CLI_CLIENT_SECRET`.

## Development

### Daemon

```bash
cd daemon
pnpm install
pnpm dev        # run with hot reload (tsx)
pnpm build      # compile to dist/
pnpm test       # run tests
pnpm test:watch # run tests in watch mode
```

The daemon starts on `http://127.0.0.1:7965` by default.

### Menubar App

```bash
cd menubar
swift build              # debug build
swift build -c release   # release build
bash bundle.sh           # create .app bundle in build/
```

The app bundle is created at `menubar/build/Gemini Daemon.app`.

### Full Build

```bash
make          # builds both daemon and menubar
make install  # builds, installs service, copies app to ~/Applications
make clean    # removes build artifacts
```

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure `cd daemon && pnpm test` passes
4. Ensure `cd menubar && swift build` succeeds
5. Open a PR with a clear description of the change

## Architecture Notes

- The daemon uses [Hono](https://hono.dev) as its HTTP framework
- Authentication reuses Gemini CLI's OAuth credentials (`~/.gemini/oauth_creds.json`)
- The menubar app polls `/health` every 5 seconds to track daemon status
- The DMG installer bundles a Bun-compiled standalone binary (not Node.js)
