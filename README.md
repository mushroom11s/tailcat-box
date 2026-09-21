# Tailcat Desktop Client

Full-featured desktop GUI for [Tailscale Tailcat](https://github.com/tailscale/tailcat) on **macOS** and **Windows**.

**Plan 1 status: complete.** The app can start an ephemeral pipe serve, copy the Tailcat address, dial that address, and transfer a short text payload using the embedded `github.com/tailscale/tailcat` library (pinned at **v0.7.0**).

**Plan 2 status: complete.** Services can serve TCP port mappings; Connect can forward local ports and browse a served HTTP port; Keys & Addresses can create/list/delete named keys and parse/resolve addresses; Diagnostics can ping (including until-direct).

**Plan 3 status: complete.** Files can recv into an inbox, send/copy to a peer, serve a directory over SFTP, and list remote paths (fake + real adapter). Session lists stay visually stable across poll refreshes.

**Plan 4 status: complete.** Services can serve keyed SSH, no-auth SSH (with a typed CONFIRM gate), exit-node, and per-connection exec. Connect can run an SSH command and start a SOCKS5 proxy. Keys can persist DERP region / map URL. A tray/menu offers Open + Quit (native tray on macOS/Windows; Linux uses the app menu).

- Shell: [Wails](https://wails.io) v2 (Go + React + TypeScript)
- Engine: embedded `github.com/tailscale/tailcat` (UI never imports Tailcat types)
- UI: Apple-inspired / Liquid Glass style (CSS blur/translucency; light/dark)
- Android: planned later (not v1)

## Docs

- [Design spec](docs/superpowers/specs/2026-09-21-tailcat-desktop-client-design.md)
- [Plan 1: Foundation vertical slice](docs/superpowers/plans/2026-09-21-tailcat-desktop-client-plan-1.md)
- [Plan 2: Ports, keys, ping](docs/superpowers/plans/2026-09-21-tailcat-desktop-client-plan-2.md)
- [Plan 3: Files](docs/superpowers/plans/2026-09-21-tailcat-desktop-client-plan-3.md)
- [Plan 4: SSH, SOCKS, exit-node, exec, DERP, tray](docs/superpowers/plans/2026-09-21-tailcat-desktop-client-plan-4.md)
- [Plans index](docs/superpowers/plans/README.md)
- [Release notes (draft v0.1.0)](docs/releases/v0.1.0.md)

## Prerequisites

Install these on the machine you will build or run from (macOS or Windows):

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
| **Real** (default) | `wails dev` / `wails build` | Serve prints a `tc…` address; Connect dials TCP port **1** (same port as bare `tailcat <addr>`). Port serve proxies mapped TCP ports; forward/browse listen on localhost; ping uses disco pings (DERP then direct when possible). Files recv/serve use SFTP on TCP port **22** (`SSHConnHandler` + `FileService`); copy/ls speak SFTP over that port. SSH serve uses port **22** (`SSHConnHandler`); SSH client runs a command over that port. SOCKS listens locally and dials via the peer (including exit-node IPs). Exit-node sets `OnTCPForward` / `OnUDPForward`. Exec uses `ExecConnHandler`. Parse/resolve call the library. Region / DERP map URL from Keys are applied to subsequent starts. |
| **Fake** | `TAILCAT_ADAPTER=fake` | Pipe address is `tc:fake-<sessionID>`; port serve is `tc:fake-port-<sessionID>`; dial replies with `echo:<payload>`; ping emits DERP then direct `EventData` lines. Recv is `tc:fake-recv-<sessionID>` and emits a drop notification; files serve is `tc:fake-files-<sessionID>`; copy emits progress then closes; ls returns stub `hello.txt` and `photos/`. SSH serve is `tc:fake-ssh-<id>` or `tc:fake-noauth-ssh-<id>`; SSH client echoes the command; SOCKS reports `socks5h://…`; exit-node is `tc:fake-exit-<id>`; exec is `tc:fake-exec-<id>`. Parse returns stub JSON; resolve returns `tc:fake-resolved`. No network. |

`vite` / `npm run dev` without Wails has no Go bindings. The UI then uses an in-browser fake that matches the Go fake, and shows an “In-browser fake adapter” chip.

Named keys are stored as `*.private.json` under the app config dir (`<user-config>/tailcat-desktop-client/keys`). Override with `TAILCAT_KEYS_DIR`. The Keys page also lists `~/.config/tailcat/keys` (or the OS equivalent) for CLI import.

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

The native binary is written to `build/bin/`. Product targets are **macOS and Windows**.

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

## GitHub Actions and releases

Public-repo Actions minutes on GitHub-hosted `ubuntu-latest`, `macos-latest`, and `windows-latest` runners are included with GitHub’s free plan for public repositories. This project does **not** use larger runners.

| Workflow | When | What |
| --- | --- | --- |
| [CI](.github/workflows/ci.yml) | Pull requests and pushes to `main` | `go test ./...` and `frontend` `npm ci` + `npm run build` on **ubuntu-latest** (no Wails window) |
| [Release](.github/workflows/release.yml) | `v*` tags, or manual **Run workflow** | `wails build` on **macOS** and **Windows**, zip `build/bin`, upload artifacts; on a real tag, create a GitHub Release |

### Cut a release

1. Put notes in `docs/releases/vX.Y.Z.md` (see [template](docs/releases/README.md)) and merge that commit to `main`.
2. Tag the merged commit and push **only that tag** (do not rewrite tags):

```bash
git checkout main
git pull origin main
git tag v0.1.0
git push origin v0.1.0
```

3. The Release workflow builds unsigned macOS (`.app`) and Windows (`.exe`) zips named `tailcat-desktop-client-macos-…` and `tailcat-desktop-client-windows-…`, then attaches them to a GitHub Release. Body text comes from `docs/releases/<tag>.md` when that file exists.

To verify the workflow **without** publishing, use **Actions → Release → Run workflow** with **dry_run** checked (the default). Uncheck dry_run only when you intend to publish, and supply a `v*` tag.

`macos-latest` is currently Apple Silicon; Intel Mac and Windows ARM64 are not built. Binaries are **unsigned** (no Apple notarization, no Authenticode). Gatekeeper and SmartScreen warnings are expected.

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

## Plan 2 acceptance

Automated (this repo / CI-friendly):

- [x] `go test ./...` without the `integration` tag
- [x] Fake adapter env override (`TAILCAT_ADAPTER=fake`)
- [x] Real adapter compiles; default is `NewReal()`
- [x] Frontend `npm run build`
- [x] Isolation: only `internal/adapter` imports `github.com/tailscale/tailcat`
- [x] Port serve → forward / browse / ping / keys / parse / resolve on the fake path

Manual on **macOS or Windows** (cannot be fully exercised as a native Wails window on a headless Linux agent):

- [ ] Services → Start port serve (`8080` or `5555:host:port`) → address visible → Copy
- [ ] Connect → Forward mappings against that address; Browse port 80
- [ ] Keys & Addresses → create named key, copy address, delete; parse/resolve JSON
- [ ] Diagnostics → ping with until-direct → EventData log shows progress lines
- [ ] Repeat port/forward/ping with the real adapter (default) on a normal network

## Plan 3 acceptance

Automated (this repo / CI-friendly):

- [x] `go test ./...` without the `integration` tag
- [x] Fake adapter env override (`TAILCAT_ADAPTER=fake`)
- [x] Real adapter compiles; default is `NewReal()`
- [x] Frontend `npm run build`
- [x] Isolation: only `internal/adapter` imports `github.com/tailscale/tailcat`
- [x] Recv / copy / files-serve / list-remote on the fake path
- [x] Session list order is stable across repeated `List()` polls
- [x] Windows-safe `npm run build` (Node writes `dist/.keep`; no `touch`)

Manual on **macOS or Windows** (cannot be fully exercised as a native Wails window on a headless Linux agent):

- [ ] Files → Start recv inbox → address visible; drop notification / progress on fake
- [ ] Files → Start files serve → Copy address → List remote shows entries; Send a local file
- [ ] Services → files-serve shortcut; multi-row session list stays still while polling
- [ ] Repeat recv/serve/copy with the real adapter (default) on a normal network

## Plan 4 acceptance

Automated (this repo / CI-friendly):

- [x] `go test ./...` without the `integration` tag
- [x] Fake adapter env override (`TAILCAT_ADAPTER=fake`)
- [x] Real adapter compiles; default is `NewReal()`
- [x] Frontend `npm run build`
- [x] Isolation: only `internal/adapter` imports `github.com/tailscale/tailcat`
- [x] SSH serve refuses no-auth without `confirmDangerous`
- [x] SOCKS / exit-node / exec / SSH client on the fake path
- [x] DERP region / map URL persist in the key store directory
- [x] Windows-safe `npm run build` (Node writes `dist/.keep`; no `touch`)

Manual on **macOS or Windows** (cannot be fully exercised as a native Wails window on a headless Linux agent):

- [ ] Services → SSH serve with authorized keys; no-auth SSH requires typing `CONFIRM`
- [ ] Connect → SSH command against that address; SOCKS listen URL appears
- [ ] Services → exit-node and exec; Diagnostics lists them as wired
- [ ] Keys → save region / DERP map URL
- [ ] Tray or app menu: Open shows the window; Quit exits. Closing the window hides it (`HideWindowOnClose`) so sessions can keep running.
- [ ] Linux: app menu Open/Quit is the tray fallback (no libayatana requirement in unit tests)

## Layout

- `main.go` / `app.go` — Wails entry and JS bindings
- `internal/session` — session state machine
- `internal/service` — StartPipeServe / DialPipe / StartPortServe / StartForward / StartBrowse / StartPing / StartRecv / StartCopy / StartFilesServe / ListRemote / StartSSHServe / StartSSHClient / StartSOCKS / StartExitNode / StartExec / ParseAddr / ResolveAddr / Stop / List / Events
- `internal/store` — named key files (`*.private.json`) and `settings.json` (region / DERP map URL)
- `internal/adapter` — `TailcatAdapter` plus fake and real implementations
- `internal/tray` — Open / session count / Quit (native systray on macOS/Windows; stub + app menu on Linux)
- `frontend/` — glass shell, Connect, Services, Files, Keys, Diagnostics
