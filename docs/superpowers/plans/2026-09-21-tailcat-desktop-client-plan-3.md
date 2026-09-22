# Tailcat Desktop Client — Plan 3: Files (send / recv / serve / ls / cp)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock the **Files** navigation and implement Tailcat file transfer / directory serve modes so users can send files, run a receive inbox, serve a folder, list remote paths, and copy to/from a peer — matching CLI `recv`, `cp`, `serve files`, and `ls` as closely as practical with the pinned `github.com/tailscale/tailcat` module.

**Architecture:** Same layered design as Plan 1–2: UI → `internal/service` → `internal/adapter` → `github.com/tailscale/tailcat`. Extend Session kinds and adapter methods; keep fake adapter first for offline UI/TDD; then wire real library. Reuse existing Session lifecycle, Wails events (`tailcat:event`), and glass UI patterns.

**Tech Stack:** Same as Plan 2 (Wails v2, Go from go.mod, React/TS, pinned Tailcat).

## Global Constraints

- Repo: `https://github.com/mushroom11s/tailcat-box`
- Design: `docs/superpowers/specs/2026-09-21-tailcat-desktop-client-design.md`
- Only `internal/adapter` may import `github.com/tailscale/tailcat`
- UI never imports Tailcat types
- Do **not** implement Plan 4 (SSH, SOCKS, exit-node, exec, custom DERP fleet UI, tray) beyond leaving stubs
- Keep `TAILCAT_ADAPTER=fake` working
- Windows-safe npm scripts (no Unix `touch` in package.json)
- TDD for Go changes; frequent commits
- Branch from latest `main`; open one PR when Plan 3 is done

## Scope (CLI parity for Plan 3)

| Capability | CLI | UI home |
|------------|-----|---------|
| Receive inbox / drop box | `tailcat recv` | Files + optional Services entry |
| Copy / send files | `tailcat cp` | Files |
| Serve directory | `tailcat serve files` | Files + Services |
| List remote | `tailcat ls` | Files |
| Progress / completion events | Session EventData / status | Files session cards |

Out of scope: SSH, SOCKS, exit-node, exec, tray-only mode (Plan 4).

Also in this plan (bugfix, small):

| Bug | Symptom | Likely area |
|-----|---------|-------------|
| Services session list “jitters” / keeps moving when multiple rows | User report on Windows Services page | `frontend/src/App.tsx` polls `listSessions` every **400ms** and always `setSessions`; also refresh on every event. Unstable order or missing stable React `key` can make the list jump. |

UI polish follow-ups (landed on `main` after the Files PR; not Plan 4):

| Item | Requirement | Where |
|------|-------------|-------|
| Glass scrollbar | Thin, low-contrast, rounded thumbs on the main/right pane (and log/result overflow); light/dark aware; CSS only (`scrollbar-*` + webkit); do not break scrolling | `frontend/src/styles/glass.css` (`.main`, `.log`, `.result`) |
| i18n | English + 简体中文 (`zh-CN`); switcher near theme toggle (Settings or sidebar as in current UI); persist last choice; default OS/browser locale else English; chrome only (nav, titles, buttons, labels, empty states, theme). Do not translate session IDs, addresses, or raw EventData | `frontend/src/i18n/*`, language/theme controls in Settings or sidebar |

---

## File map (expected; adjust to match tree)

| Path | Responsibility |
|------|----------------|
| `internal/session/session.go` | Kinds: e.g. `KindRecv`, `KindSend`/`KindCopy`, `KindFilesServe`, `KindList` (names to match existing style) |
| `internal/adapter/*` | StartRecv, StartSend/Cp, StartFilesServe, ListRemote (or StartLs) |
| `internal/service/*` | Service wrappers + progress mapping |
| `app.go` + generated bindings | Wails APIs |
| `frontend/src/App.tsx` | Enable Files nav; **fix poll/list stability** |
| `frontend/src/pages/FilesPage.tsx` | New Files UI |
| `frontend/src/pages/ServicesPage.tsx` | Optional files-serve shortcut if design fits |
| `frontend/src/styles/glass.css` | Liquid Glass tokens + thin main/log/result scrollbars |
| `frontend/src/i18n/*` | English + zh-CN catalogs, locale detect/persist, `useI18n` |
| `docs/superpowers/plans/2026-09-21-tailcat-desktop-client-plan-3.md` | This plan |
| `docs/superpowers/plans/README.md` | List Plan 3 |

---

### Task 0: Fix Services / session list jitter (do first)

**Files:** `frontend/src/App.tsx`, Session list components (`ServicesPage`, `ConnectPage`, `DiagnosticsPage`)

**Produces:**
- Session lists do not visually reorder or flicker when poll returns equivalent data
- Investigate and fix (non-binding hypotheses — verify yourself):
  - Unconditional `setSessions` / `setKeys` every 400ms even when JSON-equal
  - Poll interval too aggressive; prefer events + slower poll or only update on change
  - `ListSessions` order not stable (sort by `StartedAt` or `ID`)
  - React list keys not using stable `session.ID`
- Keep live status updates working (status/address still refresh when they change)

- [ ] Reproduce with fake adapter + ≥2 sessions
- [ ] Fix + verify list stays visually still when data unchanged
- [ ] Commit `fix: stop session list jitter on poll refresh`

---

### Task 1: Session kinds + adapter interface (TDD)

**Produces** (method names may match local style):
- `StartRecv(ctx, sessionID, inboxDir string) (<-chan Event, error)`
- `StartSend` / `StartCopy(ctx, sessionID, peerAddr, localPaths []string, remotePath string) (<-chan Event, error)` — progress via EventData / status
- `StartFilesServe(ctx, sessionID, rootDir string, opts…) (<-chan Event, error)` — returns share address like other serves
- `ListRemote(ctx, peerAddr, path string) (entries []FileEntry, error)` or a short-lived Session that emits listing then closes
- `FileEntry`: Name, IsDir, Size, Mode/ModTime as available from library
- Fake: deterministic addresses; send completes with progress events; recv notifies on “drop”; list returns stub entries

- [ ] Failing tests → implement → PASS
- [ ] Commit `feat: extend session and adapter for files`

---

### Task 2: Service layer (TDD)

- StartRecv / StartSend / StartFilesServe / ListRemote with same Session lifecycle as Plan 1–2
- Validation: empty paths, missing dirs → readable errors
- [ ] Commit `feat: service methods for files recv send serve ls`

---

### Task 3: Wails bindings + path helpers

- Expose new methods; regenerate bindings
- Prefer OS file pickers via Wails runtime if already used; otherwise path text fields with clear Windows/Unix examples
- [ ] Commit `feat: expose Plan 3 file APIs via Wails`

---

### Task 4: Files UI page

- Enable Files in nav (remove Plan 3+ disabled)
- Panels: Recv inbox, Send/cp, Serve directory, List remote
- Session cards with progress and stop
- Glass styling consistent with Plan 1–2
- [ ] Commit `feat: Files page for recv send serve ls`

---

### Task 5: Real adapter + docs

- Wire pinned Tailcat APIs for files modes (read module; adapt names)
- README + plans README acceptance notes
- `go test ./...` and `cd frontend && npm run build` green
- [ ] Commit `feat: real Tailcat adapter for files`
- [ ] Commit `docs: Plan 3 acceptance notes`
- [ ] Open PR `Plan 3: files recv send serve ls` (include Task 0 fix if not already merged)

## Acceptance

- Fake: recv/send/serve/list work in UI; progress visible; ≥2 file-related sessions stable list (no jitter)
- Real: compiles; manual/integration where possible
- No Plan 4 creep
- Windows `npm run build` remains Node-based `.keep` write
- Main/right content scrollbar matches Liquid Glass (thin, rounded, light/dark)
- UI chrome is English or 简体中文 via sidebar switcher; choice persists; technical identifiers stay untranslated

## Self-review

Plan 3 is file-focused. Exact Tailcat API names deferred to implementer reading pinned module. Task 0 is required user-reported UX bug, not optional polish. Scrollbar + i18n are UI polish on the same Files-era client, not Plan 4.
