# Tailcat Desktop Client — Plan 1: Foundation Vertical Slice

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a runnable Wails desktop app on macOS/Windows that can start an ephemeral Tailcat serve (pipe mode), show a copyable address, dial that address from a second session (or second machine), and transfer a short text payload end-to-end using the embedded `github.com/tailscale/tailcat` library.

**Architecture:** Wails single-process app. React+TypeScript UI talks only to a Go app service layer. The service owns `Session` lifecycle and events. A `TailcatAdapter` interface isolates `github.com/tailscale/tailcat`. Plan 1 wires a real adapter for serve(pipe) + client dial/pipe only; other CLI modes stay stubbed behind the same interface for later plans.

**Tech Stack:** Go 1.22+, Wails v2, React 18, TypeScript 5, Vite, `github.com/tailscale/tailcat` (pin a concrete module version at scaffold time), Go `testing` + frontend Vitest for unit tests.

## Global Constraints

- Platforms for Plan 1: macOS and Windows desktop only (Android deferred).
- **Do not** shell out to the `tailcat` CLI for the primary path; embed the Go library.
- UI never imports Tailcat types; only the adapter package may import `github.com/tailscale/tailcat`.
- Follow design spec: `docs/superpowers/specs/2026-09-21-tailcat-desktop-client-design.md`.
- Apple-inspired / Liquid Glass **style** via CSS (blur/translucency); do not require system Liquid Glass APIs.
- Dangerous modes (`no-auth-ssh`, etc.) are **out of Plan 1** — do not expose them in the UI yet.
- Prefer small focused files; TDD for Go service/adapter; frequent commits.
- Repo: `https://github.com/mushroom11s/tailcat-box` (default branch `main`).

## Scope note (later plans)

- **Plan 2 (not this file):** port serve/forward/browse, keys store, diagnostics ping.
- **Plan 3:** files (`recv`/`cp`/`ls`/`serve files`).
- **Plan 4:** SSH, SOCKS, exit-node, exec, DERP customization, tray polish.

---

## File map (Plan 1)

| Path | Responsibility |
|------|----------------|
| `README.md` | How to run/build Plan 1 slice |
| `docs/superpowers/plans/2026-09-21-tailcat-desktop-client-plan-1.md` | This plan |
| `go.mod` / `go.sum` | Go module + pinned tailcat |
| `main.go` | Wails entry |
| `app.go` | Wails `App` struct; binds service methods to JS |
| `wails.json` | Wails project config |
| `frontend/` | Vite + React + TS UI |
| `frontend/src/styles/glass.css` | Liquid Glass tokens |
| `frontend/src/App.tsx` | Shell + nav + Plan 1 pages |
| `frontend/src/pages/ServicesPage.tsx` | Start/stop ephemeral pipe serve |
| `frontend/src/pages/ConnectPage.tsx` | Dial/pipe to address + send text |
| `frontend/src/components/SessionCard.tsx` | Session status card |
| `frontend/src/lib/wails.ts` | Typed wrappers around Wails bindings |
| `internal/session/session.go` | Session types + state machine |
| `internal/session/session_test.go` | Session tests |
| `internal/service/service.go` | App service (StartPipeServe, DialPipe, Stop, List, Subscribe) |
| `internal/service/service_test.go` | Service tests with fake adapter |
| `internal/adapter/adapter.go` | `TailcatAdapter` interface + event types |
| `internal/adapter/fake.go` | In-memory fake for unit tests |
| `internal/adapter/real.go` | Real Tailcat library implementation (Plan 1 modes only) |
| `internal/adapter/real_test.go` | Optional loopback integration (build tag `integration`) |

---

### Task 1: Wails project scaffold with React+TS

**Files:**
- Create: `main.go`, `app.go`, `wails.json`, `go.mod`, `frontend/**` (Wails default React-TS template is fine as starting point)
- Modify: `README.md`
- Test: manual `wails build` / `wails dev` smoke (no automated test yet)

**Interfaces:**
- Consumes: none
- Produces: runnable empty Wails app; Go module path `github.com/mushroom11s/tailcat-box`

- [ ] **Step 1: Scaffold**

From repo root (with Go and Wails CLI installed):

```bash
# If the repo only has docs/README, scaffold into a temp dir then move files up,
# OR initialize in place following current Wails v2 React+TS template layout.
wails init -n tailcat-desktop-client -t react-ts
# Align module path:
# go.mod module = github.com/mushroom11s/tailcat-box
```

Ensure layout matches the file map above (`main.go` / `app.go` at repo root is the Wails default).

- [ ] **Step 2: Smoke run**

```bash
wails build
```

Expected: build succeeds for the current OS; binary launches an empty window.

- [ ] **Step 3: Update README**

Replace README body with short Plan 1 instructions: prerequisites (Go, Node, Wails), `wails dev`, `wails build`, link to design + this plan.

- [ ] **Step 4: Commit**

```bash
git add main.go app.go wails.json go.mod go.sum frontend README.md
git commit -m "chore: scaffold Wails React-TS app for Tailcat client"
```

---

### Task 2: Session model (TDD)

**Files:**
- Create: `internal/session/session.go`, `internal/session/session_test.go`

**Interfaces:**
- Consumes: none
- Produces:
  - `type Kind string` with `KindPipeServe`, `KindPipeDial`
  - `type Status string` with `StatusStarting`, `StatusRunning`, `StatusError`, `StatusStopped`
  - `type Session struct { ID string; Kind Kind; Status Status; Address string; CreatedAt time.Time; Err string }`
  - `func New(kind Kind) *Session` — ID is a new UUID string, Status=`StatusStarting`, CreatedAt=now
  - `func (s *Session) Transition(next Status) error` — legal edges only; illegal returns error

Legal transitions:
- `starting → running | error | stopped`
- `running → error | stopped`
- `error → stopped`
- `stopped` is terminal

- [ ] **Step 1: Write the failing test**

```go
package session_test

import (
	"testing"

	"github.com/mushroom11s/tailcat-box/internal/session"
)

func TestNewSessionStartsInStarting(t *testing.T) {
	s := session.New(session.KindPipeServe)
	if s.ID == "" {
		t.Fatal("expected non-empty ID")
	}
	if s.Status != session.StatusStarting {
		t.Fatalf("status=%s", s.Status)
	}
}

func TestTransitionStartingToRunning(t *testing.T) {
	s := session.New(session.KindPipeServe)
	if err := s.Transition(session.StatusRunning); err != nil {
		t.Fatal(err)
	}
	if s.Status != session.StatusRunning {
		t.Fatalf("status=%s", s.Status)
	}
}

func TestTransitionRejectsStoppedToRunning(t *testing.T) {
	s := session.New(session.KindPipeServe)
	_ = s.Transition(session.StatusStopped)
	if err := s.Transition(session.StatusRunning); err == nil {
		t.Fatal("expected error")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
go test ./internal/session/ -v
```

Expected: FAIL (package or symbols undefined).

- [ ] **Step 3: Write minimal implementation**

Implement `session.go` with the types and `Transition` rules above. Use `github.com/google/uuid` or `crypto/rand` hex for IDs.

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./internal/session/ -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add internal/session/
git commit -m "feat: add Session state machine"
```

---

### Task 3: Adapter interface + fake

**Files:**
- Create: `internal/adapter/adapter.go`, `internal/adapter/fake.go`, `internal/adapter/fake_test.go`

**Interfaces:**
- Consumes: none
- Produces:

```go
package adapter

import "context"

type EventKind string

const (
	EventReady  EventKind = "ready"  // Address set for serve
	EventData   EventKind = "data"   // payload bytes as string for Plan 1 text pipe
	EventError  EventKind = "error"
	EventClosed EventKind = "closed"
)

type Event struct {
	SessionID string
	Kind      EventKind
	Address   string // for EventReady
	Data      string // for EventData
	Err       string // for EventError
}

type TailcatAdapter interface {
	// StartPipeServe begins an ephemeral server; emits EventReady with Address, then EventData/Closed/Error.
	StartPipeServe(ctx context.Context, sessionID string) (<-chan Event, error)
	// DialPipe connects to addr and writes payload; emits EventData for any reply optional; then EventClosed.
	DialPipe(ctx context.Context, sessionID string, addr string, payload string) (<-chan Event, error)
	Stop(sessionID string) error
}
```

Fake behavior:
- `StartPipeServe`: after a short async tick, emit `EventReady` with Address=`tc:fake-<sessionID>`, keep channel open until `Stop` or cancel → `EventClosed`.
- `DialPipe`: if addr has prefix `tc:fake-`, emit `EventData` with Data=`echo:`+payload then `EventClosed`; else emit `EventError`.

- [ ] **Step 1: Write failing fake test**

```go
package adapter_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/mushroom11s/tailcat-box/internal/adapter"
)

func TestFakeServeAndDial(t *testing.T) {
	f := adapter.NewFake()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	serveCh, err := f.StartPipeServe(ctx, "s1")
	if err != nil {
		t.Fatal(err)
	}
	var addr string
	select {
	case ev := <-serveCh:
		if ev.Kind != adapter.EventReady {
			t.Fatalf("%+v", ev)
		}
		addr = ev.Address
	case <-ctx.Done():
		t.Fatal("timeout")
	}

	dialCh, err := f.DialPipe(ctx, "s2", addr, "hello")
	if err != nil {
		t.Fatal(err)
	}
	gotData := false
	for {
		select {
		case ev, ok := <-dialCh:
			if !ok {
				if !gotData {
					t.Fatal("closed without data")
				}
				return
			}
			if ev.Kind == adapter.EventData {
				if !strings.HasPrefix(ev.Data, "echo:hello") {
					t.Fatalf("data=%q", ev.Data)
				}
				gotData = true
			}
		case <-ctx.Done():
			t.Fatal("timeout")
		}
	}
}
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
go test ./internal/adapter/ -v
```

- [ ] **Step 3: Implement interface + `NewFake()`**

- [ ] **Step 4: Run test — expect PASS**

```bash
go test ./internal/adapter/ -v
```

- [ ] **Step 5: Commit**

```bash
git add internal/adapter/
git commit -m "feat: add TailcatAdapter interface and fake"
```

---

### Task 4: App service with fake adapter (TDD)

**Files:**
- Create: `internal/service/service.go`, `internal/service/service_test.go`

**Interfaces:**
- Consumes: `session.Session`, `adapter.TailcatAdapter`
- Produces:

```go
type Service struct { /* unexported fields */ }

func New(ad adapter.TailcatAdapter) *Service

func (s *Service) StartPipeServe() (session.Session, error)
func (s *Service) DialPipe(addr string, payload string) (session.Session, error)
func (s *Service) Stop(sessionID string) error
func (s *Service) List() []session.Session
func (s *Service) Events() <-chan adapter.Event // fan-in of adapter events + status updates mirrored
```

Rules:
- `StartPipeServe` creates Session `KindPipeServe`, stores it, calls adapter, on `EventReady` sets `Address` and transitions to `running`.
- `DialPipe` creates `KindPipeDial`, on `EventError` → `error`, on `EventClosed` → `stopped`.
- `Stop` calls adapter.Stop and transitions to `stopped`.
- `List` returns a snapshot copy.

- [ ] **Step 1: Write failing service test**

```go
func TestStartPipeServeReady(t *testing.T) {
	svc := service.New(adapter.NewFake())
	sess, err := svc.StartPipeServe()
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(2 * time.Second)
	for {
		list := svc.List()
		for _, item := range list {
			if item.ID == sess.ID && item.Status == session.StatusRunning && item.Address != "" {
				return
			}
		}
		select {
		case <-deadline:
			t.Fatalf("never running: %+v", svc.List())
		case <-time.After(20 * time.Millisecond):
		}
	}
}
```

Also test `DialPipe` against the fake address from serve, and `Stop`.

- [ ] **Step 2: Run — expect FAIL**

```bash
go test ./internal/service/ -v
```

- [ ] **Step 3: Implement `Service`**

- [ ] **Step 4: Run — expect PASS**

```bash
go test ./internal/service/ -v
```

- [ ] **Step 5: Commit**

```bash
git add internal/service/
git commit -m "feat: add app service for pipe serve and dial"
```

---

### Task 5: Wire Wails bindings

**Files:**
- Modify: `app.go`, `main.go`
- Create: `frontend/src/lib/wails.ts` (or use Wails generated bindings under `frontend/wailsjs/`)

**Interfaces:**
- Consumes: `service.Service`
- Produces: JS-callable methods matching:

```go
// on App
func (a *App) StartPipeServe() (session.Session, error)
func (a *App) DialPipe(addr string, payload string) (session.Session, error)
func (a *App) StopSession(id string) error
func (a *App) ListSessions() []session.Session
```

On startup construct `service.New(adapter.NewFake())` temporarily if real adapter not ready; Task 7 switches default to real.

Also emit runtime events to frontend:

```go
runtime.EventsEmit(ctx, "tailcat:event", ev)
```

- [ ] **Step 1: Bind methods on `App` and construct `Service` in `OnStartup`**

- [ ] **Step 2: Generate bindings**

```bash
wails generate module
```

- [ ] **Step 3: From UI console / temporary button, call `StartPipeServe` and log result** (manual)

Expected: returns session JSON; later event updates address when using fake.

- [ ] **Step 4: Commit**

```bash
git add app.go main.go frontend/wailsjs frontend/src/lib
git commit -m "feat: expose pipe serve/dial via Wails bindings"
```

---

### Task 6: Glass shell + Services / Connect pages (fake-backed)

**Files:**
- Create: `frontend/src/styles/glass.css`, `frontend/src/components/SessionCard.tsx`, `frontend/src/pages/ServicesPage.tsx`, `frontend/src/pages/ConnectPage.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx`

**Interfaces:**
- Consumes: Wails bindings + `tailcat:event`
- Produces: UI navigation with two working pages for Plan 1

UI requirements:
- Sidebar: Connect, Services (other partitions visible but disabled with tooltip “Plan 2+”).
- Services: button “Start ephemeral pipe serve” → SessionCard shows status + address + Copy + Stop.
- Connect: address input, payload textarea (default `hello`), “Send” → SessionCard for dial; show echoed `EventData` in a result panel.
- Visual: translucent panels, backdrop-filter blur, light/dark via `prefers-color-scheme` or toggle.

- [ ] **Step 1: Add `glass.css` tokens** (`--glass-bg`, `--glass-border`, `--radius`, blur)

- [ ] **Step 2: Implement `SessionCard`** showing Kind, Status, Address, Err, Stop button

- [ ] **Step 3: Implement Services + Connect pages wired to bindings + event listener**

- [ ] **Step 4: Manual test with fake adapter**

`wails dev` → Start serve → copy address → Connect send → see `echo:hello`.

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: add glass UI for pipe serve and dial"
```

---

### Task 7: Real Tailcat adapter (serve pipe + dial pipe)

**Files:**
- Create: `internal/adapter/real.go`, `internal/adapter/real_integration_test.go`
- Modify: `app.go` (default to `adapter.NewReal()`), `go.mod` (require tailcat)

**Interfaces:**
- Consumes: `github.com/tailscale/tailcat` public API (`Server`, `Client` / `NewClient`, `Addr`)
- Produces: `func NewReal() TailcatAdapter` implementing Plan 1 methods only; other future methods remain absent until later plans.

Behavior:
- `StartPipeServe`: start `&tailcat.Server{}` (or documented equivalent) with handler that reads all bytes from conn into a buffer and/or writes nothing until client sends; for pipe-to-stdout semantics in GUI, treat first inbound TCP stream as pipe: read payload, emit `EventData`, keep serve until Stop. Print/obtain `TailcatAddr()` and emit `EventReady` with that address string.
- `DialPipe`: `tailcat.NewClient(tailcat.Addr(addr))`, dial an agreed port (document the port constant, e.g. `80` or library default used by CLI bare dial), write payload, close, emit `EventClosed`. If the serve side echoes or accepts stdin-style pipe, align with upstream CLI pipe behavior as closely as the library allows.
- Pin module version in `go.mod` and record it in a `Version() string` method for later Diagnostics.

Exact API calls must follow the module version you pin — read that version’s docs/README before coding; if API names differ slightly from this sketch, adapt inside `real.go` only.

- [ ] **Step 1: Add dependency**

```bash
go get github.com/tailscale/tailcat@latest
# then pin the resolved version explicitly in go.mod
```

- [ ] **Step 2: Write integration test with build tag**

```go
//go:build integration

func TestRealLoopbackPipe(t *testing.T) {
	// StartReal serve, DialPipe with payload, assert no error and serve received data
}
```

- [ ] **Step 3: Implement `NewReal` / `real.go`**

- [ ] **Step 4: Run unit tests (fake) still green; run integration if network/DERP available**

```bash
go test ./...
go test -tags=integration ./internal/adapter/ -v -count=1
```

Expected: unit PASS; integration PASS on a normal network (may use public DERP — document flakiness).

- [ ] **Step 5: Switch `app.go` default adapter to `NewReal()`; keep `TAILCAT_ADAPTER=fake` env override for UI demos offline**

- [ ] **Step 6: Manual E2E**

Two app windows or serve in app + `tailcat` CLI client (if installed) optional; minimum: in-app serve + in-app dial.

- [ ] **Step 7: Commit**

```bash
git add go.mod go.sum internal/adapter/ app.go
git commit -m "feat: embed Tailcat library for pipe serve and dial"
```

---

### Task 8: Plan 1 acceptance polish

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-21-tailcat-desktop-client-design.md` (status line only if needed)
- Create: `docs/superpowers/plans/README.md` listing Plan 1 done / Plan 2+ planned

- [ ] **Step 1: Checklist against Plan 1 goal**

- [ ] Cold start app on Mac or Windows
- [ ] Start ephemeral pipe serve → address visible → copy works
- [ ] Dial from Connect with payload → success path with real adapter
- [ ] Stop sessions cleanly
- [ ] `go test ./...` passes without integration tag
- [ ] Fake adapter env override still works

- [ ] **Step 2: README “Plan 1 status: complete” + how to run integration tests**

- [ ] **Step 3: Commit**

```bash
git add README.md docs/
git commit -m "docs: mark Plan 1 foundation slice acceptance"
```

---

## Self-review (author)

1. **Spec coverage (Plan 1 only):** Architecture layers, Session model, adapter isolation, serve+pipe dial vertical slice, glass UI shell — covered. Full CLI parity intentionally deferred to Plans 2–4.
2. **Placeholders:** None intentional; real adapter step requires reading pinned module API at implement time (called out explicitly).
3. **Type consistency:** `session.Session`, `adapter.Event`, `adapter.TailcatAdapter`, `service.Service` names reused across tasks.
