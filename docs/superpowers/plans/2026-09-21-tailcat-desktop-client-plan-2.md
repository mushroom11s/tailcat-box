# Tailcat Desktop Client — Plan 2: Ports, Keys, Diagnostics Ping

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Plan 1 Wails client so users can serve/forward TCP ports, browse a served HTTP port, manage genkey-style keys and address parse/resolve, and run ping (including until-direct) from the Diagnostics UI.

**Architecture:** Keep the layered design from Plan 1: UI → `internal/service` → `internal/adapter` → `github.com/tailscale/tailcat`. Extend `TailcatAdapter` and `Service` with new Session kinds; unlock Keys & Diagnostics nav; expand Services/Connect forms for port mappings. Prefer extending fake adapter first so UI/TDD works offline, then wire real library calls.

**Tech Stack:** Same as Plan 1 (Wails v2, Go 1.27+, React/TS, embedded `github.com/tailscale/tailcat` pinned version already in go.mod).

## Global Constraints

- Repo: `https://github.com/mushroom11s/tailcat-box`
- Follow design: `docs/superpowers/specs/2026-09-21-tailcat-desktop-client-design.md`
- Only `internal/adapter` may import `github.com/tailscale/tailcat`
- UI never imports Tailcat types
- macOS/Windows are product targets; Linux may need `wails build -tags webkit2_41`
- Do **not** implement Plan 3 (files) or Plan 4 (SSH/SOCKS/exit-node/exec/DERP fleet UI) beyond minimal stubs
- Keep `TAILCAT_ADAPTER=fake` working for offline UI
- TDD for Go service/adapter changes; frequent commits
- Branch from latest `main`; open one PR when Plan 2 is done (or per-task PRs if preferred — one PR for the whole plan is OK)

## Scope (CLI parity for Plan 2)

| Capability | CLI | UI home |
|------------|-----|---------|
| Serve ports / mappings | `tailcat serve 8080,8443` / `5555:host:port` | Services |
| Forward local ports | `tailcat forward <addr> …` | Connect |
| Browse | `tailcat browse <addr>` | Connect |
| Keys gen/list/delete/default | `tailcat genkey` / key files | Keys & Addresses |
| Parse / resolve address | `tailcat parse` / `resolve` | Keys & Addresses |
| Ping / until-direct | `tailcat ping` | Diagnostics |

Out of scope: files, SSH, SOCKS, exit-node, exec, custom DERP map UI (Plan 3–4).

---

## File map

| Path | Responsibility |
|------|----------------|
| `internal/session/session.go` | Add kinds: `KindPortServe`, `KindForward`, `KindBrowse`, `KindPing` (and keep existing) |
| `internal/adapter/adapter.go` | Extend interface |
| `internal/adapter/fake.go` | Fake implementations |
| `internal/adapter/real.go` | Real Tailcat wiring |
| `internal/service/service.go` | New Start* methods |
| `internal/store/keys.go` | Key list/create/delete compatible with CLI key dir concepts |
| `app.go` | New Wails bindings |
| `frontend/src/pages/ServicesPage.tsx` | Port serve form |
| `frontend/src/pages/ConnectPage.tsx` | Forward + browse |
| `frontend/src/pages/KeysPage.tsx` | Enable Keys UI |
| `frontend/src/pages/DiagnosticsPage.tsx` | Enable ping UI |
| `docs/superpowers/plans/2026-09-21-tailcat-desktop-client-plan-2.md` | This plan |
| `docs/superpowers/plans/README.md` | Mark Plan 2 |

---

### Task 1: Extend Session kinds + adapter interface (TDD)

**Files:**
- Modify: `internal/session/session.go`, `internal/session/session_test.go`
- Modify: `internal/adapter/adapter.go`
- Create/Modify: `internal/adapter/fake.go`, tests

**Produces:**
- Session kinds for port serve, forward, browse, ping
- Adapter methods (names may be adjusted to match code style, but behavior must match):
  - `StartPortServe(ctx, sessionID, mappings []PortMapping) (<-chan Event, error)`
  - `StartForward(ctx, sessionID, serverAddr string, mappings []PortMapping) (<-chan Event, error)`
  - `StartBrowse(ctx, sessionID, serverAddr string) (<-chan Event, error)` — opens/local-forwards then signals ready with local URL in Event.Data or Address
  - `StartPing(ctx, sessionID, addr string, untilDirect bool, timeout time.Duration) (<-chan Event, error)` — emit EventData lines for pongs; EventClosed when done
- `PortMapping` struct: `LocalPort`, `RemoteHost`, `RemotePort` (document zero-value = same port / localhost as CLI)
- Fake: deterministic addresses `tc:fake-port-<id>`, forward/browse succeed against fake serves; ping emits two EventData lines (DERP then direct) then Closed

- [ ] **Step 1:** Write failing tests for new kinds/transitions and fake port/ping
- [ ] **Step 2:** `go test ./internal/session/ ./internal/adapter/ -v` FAIL
- [ ] **Step 3:** Implement
- [ ] **Step 4:** PASS
- [ ] **Step 5:** Commit `feat: extend session and adapter for ports and ping`

---

### Task 2: Service layer for ports / forward / browse / ping (TDD)

**Files:**
- Modify: `internal/service/service.go`, `internal/service/service_test.go`

**Produces:**
- `StartPortServe(mappings []adapter.PortMapping) (session.Session, error)`
- `StartForward(addr string, mappings []adapter.PortMapping) (session.Session, error)`
- `StartBrowse(addr string) (session.Session, error)`
- `StartPing(addr string, untilDirect bool) (session.Session, error)`
- Same Session lifecycle rules as Plan 1 (Ready→running, errors, Stop)

- [ ] Tests with fake adapter covering serve→forward happy path and ping untilDirect
- [ ] Commit `feat: add service methods for ports forward browse ping`

---

### Task 3: Key store (TDD)

**Files:**
- Create: `internal/store/keys.go`, `internal/store/keys_test.go`

**Produces:**
- Store rooted at app config dir (and optionally read CLI `~/.config/tailcat/keys` for import/list)
- `List() ([]KeyInfo, error)`, `Create(name string, opts CreateOpts) (addr string, error)`, `Delete(name string) error`
- `CreateOpts`: client vs server, region hint optional; for Plan 2 a minimal ephemeral-or-named key file JSON is enough if full CLI format is complex — prefer compatibility with upstream key file format when documented in the pinned module/CLI
- Unit tests with temp dir

- [ ] Commit `feat: add key store for genkey-compatible keys`

---

### Task 4: Parse / resolve helpers

**Files:**
- Modify: `internal/adapter` + `service` or small `internal/addrutil`
- Wails: `ParseAddr(raw string) (string /*JSON*/, error)`, `ResolveAddr(raw string) (string, error)`

Use library/CLI-equivalent behavior from pinned Tailcat. Fake: return stable JSON stub.

- [ ] Tests for fake parse/resolve
- [ ] Commit `feat: add address parse and resolve`

---

### Task 5: Wails bindings

**Files:**
- Modify: `app.go`, regenerate bindings

Expose new service/store methods to frontend. Keep `tailcat:event`.

- [ ] Commit `feat: expose Plan 2 APIs via Wails`

---

### Task 6: UI — Services ports + Connect forward/browse

**Files:**
- Modify Services/Connect pages + SessionCard as needed

Services: form for port list / mappings; start/stop; show address.
Connect: tabs or sections for pipe (existing), forward mappings, browse button.
Keep glass styling.

- [ ] Manual or component-level check with fake adapter
- [ ] Commit `feat: UI for port serve forward and browse`

---

### Task 7: UI — Keys & Diagnostics

**Files:**
- Enable `KeysPage`, `DiagnosticsPage` (remove Plan 2+ disabled state)

Keys: list, create named key, delete, copy address, parse/resolve panels.
Diagnostics: ping form (addr, until-direct toggle), live EventData log, active sessions list.

- [ ] Commit `feat: enable Keys and Diagnostics pages`

---

### Task 8: Real adapter wiring + docs

**Files:**
- Modify: `internal/adapter/real.go`
- Modify: README + plans README

Wire real serve-ports / forward / browse / ping / parse / resolve using pinned Tailcat API (read module docs; adapt names). Integration tests optional with `//go:build integration`. Document Go version and fake env.

- [ ] `go test ./...` green
- [ ] Commit `feat: real Tailcat adapter for Plan 2 capabilities`
- [ ] Commit `docs: Plan 2 acceptance notes`
- [ ] Open PR titled `Plan 2: ports, keys, ping`

## Acceptance

- Fake path: port serve → forward → local connection concept works in UI; ping shows progress lines; keys CRUD in temp/app dir; parse/resolve return JSON
- Real path: compiles; integration where network allows
- No Plan 3/4 feature creep

## Self-review notes for author

Plan 2 deliberately excludes files/SSH/SOCKS. Real API details deferred to implementer reading pinned module — called out explicitly, not TBD placeholders for behavior.
