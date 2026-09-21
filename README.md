# Tailcat Desktop Client

Full-featured desktop GUI for [Tailscale Tailcat](https://github.com/tailscale/tailcat) on **macOS** and **Windows**.

**Plan 1 status: complete.** The app can start an ephemeral pipe serve, copy the Tailcat address, dial that address, and transfer a short text payload using the embedded `github.com/tailscale/tailcat` library (pinned at **v0.7.0**).

- Shell: [Wails](https://wails.io) v2 (Go + React + TypeScript)
- Engine: embedded `github.com/tailscale/tailcat` (UI never imports Tailcat types)
- UI: Apple-inspired / Liquid Glass style (CSS blur/translucency; light/dark)
- Android: planned later (not v1)

Plans 2–4 (ports, files, SSH, SOCKS, exit-node, tray) are not implemented.

## Docs

- [Design spec](docs/superpowers/specs/2026-09-21-tailcat-desktop-client-design.md)
- [Plan 1: Foundation vertical slice](docs/superpowers/plans/2026-09-21-tailcat-desktop-client-plan-1.md)
- [Plans index](docs/superpowers/plans/README.md)

## Prerequisites

Install these on the machine you will build or run from (macOS or Windows for Plan 1):

| Tool | Notes |
| --- | --- |
| **Go 1.27.1+** | Required by `github.com/tailscale/tailcat` v0.7.0. Wails v2.16 needs Go 1.25+. Older local Go can still bootstrap via `GOTOOLCHAIN=auto`. |
| **Node.js 18+** and npm | Frontend is Vite + React + TypeScript under `frontend/`. |
| **Wails CLI v2** | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0` |
| **Platform webview toolchain** | macOS: Xcode Command Line Tools. Windows: WebView2 (usually already present). |

Confirm the CLI:

```bash
wails doctor
```

## Fake vs real adapter

The default backend is the real Tailcat library (`adapter.NewReal()`). It uses public DERP relays by default (see upstream stability notes).

For offline UI demos and automated tests:

```bash
TAILCAT_ADAPTER=fake wails dev
```

| Mode | How | Behavior |
| --- | --- | --- |
| **Real** (default) | `wails dev` / `wails build` | Serve prints a `tc…` address; Connect dials TCP port **1** (same port as bare `tailcat <addr>`). Serve echoes the payload so the Connect page can show `EventData`. |
| **Fake** | `TAILCAT_ADAPTER=fake` | Address is `tc:fake-<sessionID>`; dial replies with `echo:<payload>`. No network. |

`vite` / `npm run dev` without Wails has no Go bindings. The UI then uses an in-browser fake that matches the Go fake, and shows an “In-browser fake adapter” chip.

## Develop

From the repository root:

```bash
wails dev
```

Offline (no DERP):

```bash
TAILCAT_ADAPTER=fake wails dev
```

On Linux Cloud Agent VMs / Ubuntu 24.04 (WebKitGTK 4.1 only):

```bash
TAILCAT_ADAPTER=fake wails dev -tags webkit2_41
```

## Build

From the repository root, on the OS you want a binary for:

```bash
wails build
```

The native binary is written to `build/bin/`. Plan 1 product targets are **macOS and Windows** only.

Linux is not a Plan 1 product target. On Ubuntu 24.04, `wails doctor` may still report `libwebkit` missing even when WebKitGTK 4.1 is installed:

```bash
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev
wails build -tags webkit2_41
```

Frontend-only (no desktop window):

```bash
cd frontend
npm install
npm run build
```

## Tests

Unit tests (must pass; does **not** include the real-adapter integration test):

```bash
go test ./...
cd frontend && npm run build
```

Optional integration test (real adapter, public DERP, build tag `integration`):

```bash
go test -tags=integration ./internal/adapter/ -v -count=1
```

This starts an in-process pipe serve, dials it, and asserts the echoed payload. It needs outbound HTTPS/UDP to Tailcat DERP (`https://tailcat.dev/derpmap.json` and the selected relay). Skip or expect failure on locked-down networks.

## Plan 1 acceptance

Automated (this repo / CI-friendly):

- [x] `go test ./...` without the `integration` tag
- [x] Fake adapter env override (`TAILCAT_ADAPTER=fake`)
- [x] Real adapter compiles; default is `NewReal()`
- [x] Frontend `npm run build`
- [x] Isolation: only `internal/adapter` imports `github.com/tailscale/tailcat`

Manual on **macOS or Windows** (cannot be fully exercised as a native Wails window on a headless Linux agent):

- [ ] Cold start the desktop app
- [ ] Services → Start ephemeral pipe serve → address visible → Copy
- [ ] Connect → paste address, payload `hello`, Send → result panel shows payload (`echo:hello` on fake; raw `hello` on real, which echoes)
- [ ] Stop sessions cleanly
- [ ] Repeat the serve+dial path with the real adapter (default) on a normal network
- [ ] Optional: interop with the official `tailcat` CLI using port 1 / bare dial

## Layout

- `main.go` / `app.go` — Wails entry and JS bindings
- `internal/session` — session state machine
- `internal/service` — StartPipeServe / DialPipe / Stop / List / Events
- `internal/adapter` — `TailcatAdapter` plus fake and real implementations
- `frontend/` — glass shell, Connect + Services pages
