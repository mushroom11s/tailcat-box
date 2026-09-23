# Tailcat Box

[中文说明](README.zh-CN.md)

Desktop GUI for [Tailscale Tailcat](https://github.com/tailscale/tailcat) on macOS and Windows, built with [Wails](https://wails.io) v2 (Go + React + TypeScript).

[![CI](https://github.com/mushroom11s/tailcat-box/actions/workflows/ci.yml/badge.svg)](https://github.com/mushroom11s/tailcat-box/actions/workflows/ci.yml)

<p align="center">
  <img src="docs/assets/icon.png" alt="Tailcat Box" width="256" />
</p>

**Tailcat Box** (Simplified Chinese: **猫砂盆**). GitHub: [mushroom11s/tailcat-box](https://github.com/mushroom11s/tailcat-box).

## Features

- **Chat** — open a room, exchange a Tailcat address, and send text, files, voice notes, or a live voice, video, or screen share
- **Tunnel** — serve TCP ports, forward them to this machine, or browse the peer’s web port
- **Settings** — system / light / dark theme, English and 简体中文, keys and DERP, diagnostics, client and system info, launch at login
- **Tray** — Open, Hide, Chat, Tunnel, Settings, and Quit on macOS and Windows. Left-click the icon to show the window. The macOS app menu has the same actions. The tray icon is the same pixel-art cat as the app icon. Closing the window hides it so sessions keep running
- **macOS window** — The standard title bar stays visible and shows Tailcat Box. The green button, and View → Enter Full Screen / Exit Full Screen (⌃⌘F), use native fullscreen. Windows and Linux are unchanged

The UI talks to a Go service layer. Only `internal/adapter` imports `github.com/tailscale/tailcat` (pinned at **v0.7.0**).

## Requirements

| Tool | Notes |
| --- | --- |
| **Go 1.27.1+** | Required by `github.com/tailscale/tailcat` v0.7.0. Wails v2.16 needs Go 1.25+. Older local Go can still bootstrap with `GOTOOLCHAIN=auto`. |
| **Node.js 18+** and npm | Frontend is Vite + React + TypeScript in `frontend/`. |
| **Wails CLI v2** | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0` |
| **Platform webview** | macOS: Xcode Command Line Tools. Windows: WebView2 (usually already installed). |

```bash
wails doctor
```

## Develop

```bash
git clone https://github.com/mushroom11s/tailcat-box.git
cd tailcat-box
```

From the repository root:

```bash
wails dev
```

Offline, with no DERP traffic:

```bash
TAILCAT_ADAPTER=fake wails dev
```

On Linux (including Ubuntu 24.04, where only WebKitGTK 4.1 is available):

```bash
TAILCAT_ADAPTER=fake wails dev -tags webkit2_41
```

`npm run dev` inside `frontend/` has no Go bindings. The UI falls back to an in-browser fake and shows an “In-browser fake adapter” chip.

## Build

On the OS you want a binary for:

```bash
wails build
```

The binary is `build/bin/tailcat-box` (`.app` on macOS, `.exe` on Windows). macOS and Windows are the product targets.

Linux is not a shipped target. On Ubuntu 24.04 you can still build with `wails build -tags webkit2_41` after installing `libgtk-3-dev` and `libwebkit2gtk-4.1-dev`.

Frontend only:

```bash
cd frontend
npm install
npm run build
```

## Test

```bash
go test ./...
cd frontend && npm run build
```

Pull requests and pushes to `main` run these checks in [CI](https://github.com/mushroom11s/tailcat-box/actions/workflows/ci.yml).

`go test ./...` does not include the real-adapter integration test. That one needs outbound HTTPS/UDP to Tailcat DERP and is optional:

```bash
go test -tags=integration ./internal/adapter/ -v -count=1
```

## Fake vs real adapter

The default backend is the embedded Tailcat library. It uses public DERP relays.

| | Real (default) | Fake (`TAILCAT_ADAPTER=fake`) |
| --- | --- | --- |
| How | `wails dev` / `wails build` | `TAILCAT_ADAPTER=fake wails dev` |
| Network | Public DERP | None |
| Pipe | Prints a `tc…` address. Connect dials TCP port **1** (same as bare `tailcat <addr>`). | Address `tc:fake-<id>`. Dial replies `echo:<payload>`. |
| Ports | Port serve proxies the mappings. Forward and browse listen on localhost. | Address `tc:fake-port-<id>`. |
| Files | Recv and serve use SFTP on TCP port **22**. | Recv, serve, copy, and ls return stub addresses and listings. |
| SSH, SOCKS, exit node, exec | SSH uses port **22**. SOCKS dials through the peer. Exit node and exec use the library handlers. | Deterministic `tc:fake-…` addresses and a local SOCKS URL. |
| Keys and DERP | Parse and resolve call the library. Saved region / map URL apply to later sessions. | Parse returns stub JSON. Resolve returns `tc:fake-resolved`. |
| Ping | Disco pings (DERP, then direct when possible). | Emits DERP, then direct, `EventData` lines. |

## Configuration

New installs store keys and settings under `<user-config>/tailcat-box` (keys are `*.private.json` in `keys/`).

| OS | Typical path |
| --- | --- |
| macOS | `~/Library/Application Support/tailcat-box` |
| Windows | `%AppData%\tailcat-box` |
| Linux | `~/.config/tailcat-box` |

If `<user-config>/tailcat-desktop-client` already exists and `tailcat-box` does not, the app keeps using the old directory for keys and settings. Move or rename that folder to `tailcat-box` when you want the new path. Override those directories with `TAILCAT_KEYS_DIR` and `TAILCAT_SETTINGS_DIR`. Chat files are stored in `<user-config>/tailcat-box/chat` (override with `TAILCAT_CHAT_DIR`).

The Keys page also lists the Tailcat CLI key directory (`~/.config/tailcat/keys`, or the OS equivalent) so you can import those keys.

## Releases

Pushing a `v*` tag builds unsigned macOS (Apple Silicon and Intel) and Windows (amd64 and ARM64) zips and attaches them to a GitHub Release. Names look like `tailcat-box-macos-arm64-…`, `tailcat-box-macos-amd64-…`, `tailcat-box-windows-amd64-…`, and `tailcat-box-windows-arm64-…`. Notes for that tag live under `docs/releases/`. The binaries are unsigned, so Gatekeeper and SmartScreen warnings are expected.

Tagging, dry-run builds, and which runners are used are described in [docs/releases/README.md](docs/releases/README.md).

## Layout

- `main.go` / `app.go` — Wails entry and JS bindings
- `internal/adapter` — Tailcat adapter, fake and real
- `internal/chat` — room, files, voice notes, and live media
- `internal/service` — session commands (pipe, ports, files, SSH, SOCKS, exit node, exec, ping)
- `internal/session` — session state
- `internal/store` — named keys and network settings
- `internal/tray` — Open, Hide, Chat, Tunnel, Settings, session count, Quit
- `frontend/` — Chat, Tunnel, and Settings

The Go module path in `go.mod` is `github.com/mushroom11s/tailcat-box`.

## Credits

Tailcat Box is a desktop client for [Tailscale Tailcat](https://github.com/tailscale/tailcat).
