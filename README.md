# Tailcat Desktop Client

Full-featured desktop GUI for [Tailscale Tailcat](https://github.com/tailscale/tailcat) on **macOS** and **Windows**.

- Shell: [Wails](https://wails.io) v2 (Go + React + TypeScript)
- Engine: embedded `github.com/tailscale/tailcat` (not wired yet — later Plan 1 tasks)
- UI goal: Apple-inspired / Liquid Glass style
- Android: planned later (not v1)

This repo currently contains a **Plan 1 Task 1** empty Wails scaffold. Session lifecycle, Tailcat adapter, and product UI are not implemented yet.

## Docs

- [Design spec](docs/superpowers/specs/2026-09-21-tailcat-desktop-client-design.md)
- [Plan 1: Foundation vertical slice](docs/superpowers/plans/2026-09-21-tailcat-desktop-client-plan-1.md)

## Prerequisites

Install these on the machine you will build or run from (macOS or Windows for Plan 1):

| Tool | Notes |
| --- | --- |
| **Go 1.25+** | Required by Wails v2.16. Go 1.22+ can still bootstrap via `GOTOOLCHAIN` if it can download a newer toolchain. |
| **Node.js 18+** and npm | Frontend is Vite + React + TypeScript under `frontend/`. |
| **Wails CLI v2** | `go install github.com/wailsapp/wails/v2/cmd/wails@latest` |
| **Platform webview toolchain** | macOS: Xcode Command Line Tools. Windows: WebView2 (usually already present). |

Confirm the CLI:

```bash
wails doctor
```

## Develop

From the repository root:

```bash
wails dev
```

This starts the Vite frontend watcher and a live desktop window. Go methods bound on `App` (currently the template `Greet`) are available to the UI.

## Build

From the repository root:

```bash
wails build
```

The native binary is written to `build/bin/`. Plan 1 targets macOS and Windows only; run this command on the OS you want a binary for.

Linux is not a Plan 1 product target. On Ubuntu 24.04 and other distros that only ship WebKitGTK 4.1, `wails doctor` may still report `libwebkit` missing, and you need:

```bash
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev
wails build -tags webkit2_41
wails dev -tags webkit2_41
```

Frontend-only (no desktop window):

```bash
cd frontend
npm install
npm run build
```

Go modules:

```bash
go mod tidy
```

## Layout

Wails default React-TS layout at the repo root, alongside `docs/`:

- `main.go` — Wails entry
- `app.go` — bound `App` struct
- `wails.json` — project config
- `go.mod` — module `github.com/mushroom11s/tailcat-desktop-client`
- `frontend/` — Vite + React + TypeScript
