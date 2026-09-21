# Tailcat Desktop Client — Design Spec

**Date:** 2026-09-21  
**Status:** Plans 1–4 implemented this toolbox. The product goal and primary navigation are superseded by [Tailcat Box (猫砂盆)](2026-09-22-tailcat-box-chat-design.md). This document stays as the record of the shipped Connect / Services / Files / Keys / Diagnostics design.  
**Product working name:** Tailcat Desktop Client (Mac & Windows)

## 1. Goal

Build a full-featured desktop GUI client for [Tailscale Tailcat](https://github.com/tailscale/tailcat) that:

- Covers the official CLI’s existing capabilities as fully as practical in v1
- Runs on **macOS and Windows**
- Uses an **Apple-inspired / Liquid Glass** visual language (web approximation; not system-level Liquid Glass APIs)
- Embeds the official Go library `github.com/tailscale/tailcat` (does not shell out to the CLI as the primary path)
- Uses **Wails** (Go backend + web frontend) as the desktop shell
- Defers **Android** to a later phase (service-layer interfaces should remain desktop-agnostic where practical)

Tailcat provides WireGuard-encrypted, NAT-traversing point-to-point connections using Tailscale’s data plane (magicsock + DERP) **without** Tailscale’s control plane or account. Connection metadata is exchanged out of band via a tailcat address.

## 2. Constraints and risks

- Upstream Tailcat offers **no API/CLI/wire stability guarantees**. Public DERP relays are best-effort and rate-limited.
- The product must isolate upstream types behind an **adapter layer** so UI and app services do not depend directly on unstable upstream structs.
- Coexistence with the official CLI: no global singleton lock; warn if the same saved server key appears to be served by both tools.
- Security UX must match official warnings: a tailcat address is often a **bearer capability**; `no-auth-ssh` and public DNS publishing are especially dangerous.

## 3. Product structure (Approach A)

Capability-partitioned desktop app with a stable Go service layer over an embedded Tailcat adapter.

### Navigation

1. **Connect** — dial / pipe / SOCKS / forward / browse against a peer address  
2. **Services** — listen / serve modes (pipe, ports, exit-node, exec, ssh, files, recv)  
3. **Files** — send, receive inbox, list remote directories  
4. **Keys & Addresses** — genkey, import/export, parse, resolve, DERP settings  
5. **Diagnostics** — ping, logs, active sessions, upstream version, “not yet wired” flags  

Shared: address input/validation, share sheet, danger confirmations, tray menu, theme (light/dark), Liquid Glass-style panels.

## 4. Architecture

Single-process **Wails** application:

```
┌─────────────────────────────────────────┐
│  UI (Web: React + TypeScript)           │
│  Partitioned navigation + Session cards │
└─────────────────┬───────────────────────┘
                  │ Wails bindings / events
┌─────────────────▼───────────────────────┐
│  App service layer (Go)                 │
│  StartServe, StartForward, Transfer…    │
│  Session lifecycle, logs, error map     │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  Tailcat adapter                        │
│  Isolates github.com/tailscale/tailcat  │
│  + small OS helpers (open browser, etc.)│
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  Embedded Tailcat engine                │
│  WireGuard / magicsock / DERP / netstack│
└─────────────────────────────────────────┘

Local state: keys/config on disk; running Sessions in memory;
optional address history (JSON or small local DB).
```

### Layers

1. **UI** — React + TypeScript; focus on layout and glass aesthetic; no hard lock to a specific component library in v1.  
2. **App services** — stable methods for the UI; owns Session IDs and event streams.  
3. **Adapter** — only place that imports Tailcat types / versions; maps CLI-equivalent behaviors.  
4. **Engine** — upstream library.  
5. **Local state** — app config dir by default; optional compatibility with `~/.config/tailcat` for import/scan.

## 5. Feature map (CLI parity)

| Area | CLI / behavior | UI home |
|------|----------------|---------|
| Pipe stdin/stdout | bare `tailcat` / dial | Connect + Services |
| Serve ports / mappings | `serve`, port maps, LAN proxy maps | Services |
| Forward local ports | `forward`, `--bind`, `--open-browser` | Connect |
| Browse | `browse` | Connect |
| SSH (keyed / no-auth) | `serve ssh`, `no-auth-ssh`, `tailcat ssh` | Services / Connect |
| Exec per connection | `serve exec` | Services |
| Files drop box | `recv`, `cp` | Files / Services |
| Files directory | `serve files`, `ls`, `cp` | Files / Services |
| SOCKS | `socks` | Connect |
| Exit node | `serve exit-node` | Services |
| Ping | `ping`, `--until-direct` | Diagnostics |
| Keys | `genkey`, list/delete, default vs ephemeral | Keys & Addresses |
| Allowlist | `serve --allow` | Services |
| Addr tools | `parse`, `resolve`, `--full-address` | Keys & Addresses |
| Custom DERP | `--region`, `--derpmap-url` | Keys & Addresses |
| DNS names | TXT `tailcat=…` | Connect (as address) |

v1 goal: every major mode above is completable in the UI. Rare flags live under **Advanced** (collapsed). Unwired flags appear under Diagnostics → “Not yet wired”.

## 6. Data flow and Session model

### Session

Every in-flight capability is a **Session**: type, status (`starting` | `running` | `derp` | `direct` | `error` | `stopped`), timestamps, peer address, log stream, stop action, optional progress.

### Start path

1. UI submits validated form  
2. Service creates Session, returns `sessionId` immediately  
3. Adapter invokes library (or OS helper)  
4. Adapter events → service → Wails events → UI  

### Concurrency

Multiple Sessions allowed (e.g. files serve + ping). Same saved server key listening: prefer one active serve; starting a second requires explicit UI confirmation.

### File transfers

Send: local paths → target address/path → progress events.  
Receive: `recv` Session watches inbox; notify on completion/failure.

### Keys and history

- Read/write app key store; optional scan/import of official CLI key dir  
- Address history: recent, notes, last path quality if known  

## 7. Error handling and security

- User-readable error + expandable technical detail (`sessionId`, raw error)  
- Failed start: red card, preserve form for retry  
- Runtime drop: classify peer closed / timeout / path failure  
- Toasts for brief confirms; durable issues stay on Session / Diagnostics  

### Safety UX (align with upstream)

- Strong confirmations for `no-auth-ssh`, disabling PSK, sharing addresses broadly  
- Prefer guiding `--allow` / SSH authorized keys when the service is reachable by others  
- Share sheet: short vs full self-contained address; “share only with trusted peers”  

### Upstream instability

- Surface compiled Tailcat module version in Diagnostics  
- Adapter failures → actionable Diagnostics message, not a blank UI  
- No promise of forever tracking every future CLI flag  

### Permissions

- Explicit toggles for binding non-localhost and sensitive file locations  
- OS permission failures named clearly (network / files)

## 8. UI / visual

- Apple-inspired density, typography, and spacing  
- Liquid Glass **style**: translucency, blur, soft borders, light/dark  
- Not required: true macOS system Liquid Glass APIs on either platform  
- Windows should feel consistent with the same design language (approximation)

## 9. Testing and acceptance

### Automated

- Go: validation, Session state machine, key I/O unit tests  
- Adapter: mocks + limited local loopback integration (serve → dial/ping); skip WAN DERP in CI when needed  
- Frontend: component tests for critical Session cards / forms (not pixel-perfect glass)

### Manual checklist (Mac + Windows)

Pipe, serve/forward ports, browse, file send/receive, SSH (including reject unauthorized), SOCKS, exit-node, genkey/parse/resolve, ping until direct; interop with official CLI; danger confirmations; offline / peer kill / bind failure / file permission failure.

### Success criteria

- Major README modes completable in UI (advanced flags folded or listed as unwired)  
- ≥2 concurrent Sessions without deadlock  
- Cold start → serve + peer connect succeeds on common networks, or fails with a readable reason  

### Non-goals (v1)

- Android  
- Perfect system Liquid Glass  
- Guaranteed tracking of all future upstream breaking changes  

## 10. Suggested repo layout (implementation later)

```
/
  docs/superpowers/specs/2026-09-21-tailcat-desktop-client-design.md
  cmd/app/                 # Wails entry
  internal/service/        # Session + app services
  internal/adapter/        # Tailcat isolation
  internal/store/          # keys, history, settings
  frontend/                # React + TypeScript
```

Exact scaffolding is deferred to the implementation plan.

## 11. Open follow-ups (non-blocking for this spec)

- Exact React styling approach (CSS modules vs Tailwind vs other) — choose at plan time  
- Whether tray-only / background mode is required on day one — default: yes for running Sessions  
- App display name / branding / license (recommend OSS compatible with Tailcat’s BSD-3-Clause; confirm with user before publish)

## 12. Approval

Sections confirmed in conversation (2026-09-21): architecture, feature partitions, data flow/Session model, error/security, testing/acceptance. Awaiting user review of this written spec before implementation planning.
