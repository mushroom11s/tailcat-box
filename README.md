# Tailcat Box

[中文说明](README.zh-CN.md)

Desktop GUI for [Tailscale Tailcat](https://github.com/tailscale/tailcat) on macOS and Windows, built with [Wails](https://wails.io) v2 (Go + React + TypeScript).

[![CI](https://github.com/mushroom11s/tailcat-desktop-client/actions/workflows/ci.yml/badge.svg)](https://github.com/mushroom11s/tailcat-desktop-client/actions/workflows/ci.yml)

<p align="center">
  <img src="docs/assets/icon.png" alt="Tailcat Box" width="256" />
</p>

The app is **Tailcat Box**. In 简体中文 the product name is **猫砂盆**. The GitHub repository stays `tailcat-desktop-client`.

## Features

- **Connect** — dial a pipe, forward local TCP ports, browse HTTP, run an SSH command, or start a SOCKS proxy
- **Services** — ephemeral pipe, TCP port mappings, directory serve, keyed SSH, no-auth SSH (typed `CONFIRM` gate), exit node, and per-connection exec
- **Files** — receive into an inbox, send to a peer, serve a directory, list remote paths
- **Keys & Addresses** — named keys, parse and resolve addresses, DERP region and map URL
- **Diagnostics** — ping, including until a direct path comes up
- **Settings** — system / light / dark theme, English and 简体中文, client and system info, launch at login
- **Tray** — Open and Quit on macOS and Windows (the app menu is the Linux fallback). The tray icon is the same pixel-art cat as the app icon. Closing the window hides it so sessions keep running

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

If `<user-config>/tailcat-desktop-client` already exists and `tailcat-box` does not, the app keeps using the old directory. Move or rename that folder to `tailcat-box` when you want the new path. Override the directories with `TAILCAT_KEYS_DIR` and `TAILCAT_SETTINGS_DIR`.

The Keys page also lists the Tailcat CLI key directory (`~/.config/tailcat/keys`, or the OS equivalent) so you can import those keys.

## Releases

Public GitHub-hosted runners (`ubuntu-latest`, `macos-latest`, `windows-latest`) are enough. This project does not use larger runners.

| Workflow | When | What |
| --- | --- | --- |
| [CI](.github/workflows/ci.yml) | Pull requests and pushes to `main` | `go test ./...` and `frontend` `npm ci` + `npm run build` on ubuntu-latest |
| [Release](.github/workflows/release.yml) | `v*` tags, or **Run workflow** | `wails build` on macOS and Windows, zip `build/bin`, and on a real tag publish a GitHub Release |

To cut a release:

1. Add notes at `docs/releases/vX.Y.Z.md` (see [template](docs/releases/README.md)) and merge that commit to `main`.
2. Tag the merged commit and push only that tag:

```bash
git checkout main
git pull origin main
git tag v0.1.0
git push origin v0.1.0
```

3. The workflow builds unsigned macOS (`.app`) and Windows (`.exe`) zips named `tailcat-box-macos-…` and `tailcat-box-windows-…`, then attaches them to the GitHub Release. The body is `docs/releases/<tag>.md` when that file exists.

**Actions → Release → Run workflow** with **dry_run** checked (the default) builds artifacts without publishing. Uncheck dry_run only when you mean to publish, and supply a `v*` tag.

`macos-latest` is Apple Silicon today. Intel Mac and Windows ARM64 are not built. Binaries are unsigned (no Apple notarization, no Authenticode), so Gatekeeper and SmartScreen warnings are expected.

## Layout

- `main.go` / `app.go` — Wails entry and JS bindings
- `internal/adapter` — Tailcat adapter, fake and real
- `internal/service` — session commands (pipe, ports, files, SSH, SOCKS, exit node, exec, ping)
- `internal/session` — session state
- `internal/store` — named keys and network settings
- `internal/tray` — Open, session count, Quit
- `frontend/` — Connect, Services, Files, Keys, Diagnostics, Settings

The Go module path is still `github.com/mushroom11s/tailcat-desktop-client`.

## Credits

Tailcat Box is a desktop client for [Tailscale Tailcat](https://github.com/tailscale/tailcat).
