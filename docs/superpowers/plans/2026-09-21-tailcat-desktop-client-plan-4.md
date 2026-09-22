# Tailcat Desktop Client — Plan 4: SSH, SOCKS, Exit-node, Exec, DERP, Tray

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete v1 CLI parity for remaining modes: SSH (serve + client, including no-auth with strong confirmations), SOCKS, exit-node serve, per-connection exec serve, custom DERP / region settings in Keys UI, and a basic system tray for running Sessions. Polish only as needed; Files (Plan 3) and ports/keys/ping (Plan 2) are already on main.

**Architecture:** Same layers: UI → `internal/service` → `internal/adapter` → pinned `github.com/tailscale/tailcat`. Fake adapter first; real wiring from module APIs. Reuse Session lifecycle and Wails events. Honor existing i18n (en/zh-CN) and glass scrollbar if already present on main — do not regress them.

**Tech Stack:** Same as Plan 1–3.

## Global Constraints

- Repo: `https://github.com/mushroom11s/tailcat-box`
- Design: `docs/superpowers/specs/2026-09-21-tailcat-desktop-client-design.md`
- Only `internal/adapter` imports Tailcat
- Strong confirmations for `no-auth-ssh` and other dangerous modes (design §7)
- Keep `TAILCAT_ADAPTER=fake`
- Windows-safe npm scripts; do not reintroduce Unix `touch`
- Do not rewrite Plans 1–3; extend them
- Branch from latest `main`; one PR when Plan 4 done

## Scope

| Capability | CLI | UI home |
|------------|-----|---------|
| Serve SSH (keyed / no-auth) | `serve ssh`, `no-auth-ssh` | Services |
| SSH client | `tailcat ssh` | Connect |
| SOCKS | `socks` | Connect |
| Exit node | `serve exit-node` | Services |
| Exec per connection | `serve exec` | Services |
| Custom DERP / region | `--region`, `--derpmap-url` | Keys & Addresses |
| Tray / background Sessions | tray menu | OS tray |

Out of scope: Android; perfect system Liquid Glass APIs; tracking every future upstream flag.

---

## File map (adjust to tree)

| Path | Responsibility |
|------|----------------|
| `internal/session` | Kinds: SSH serve/client, SOCKS, exit-node, exec |
| `internal/adapter` | Matching Start* methods + fake/real |
| `internal/service` | Lifecycle + danger gates |
| `app.go` + bindings | Wails |
| Services / Connect / Keys pages | Forms + confirmations |
| Tray integration (Wails systray or equivalent) | Minimal: show running count, quit, open window |
| Plan 4 doc + plans README | Docs |

---

### Task 1: Session + adapter stubs (TDD)

- Kinds and fake StartSSHServe / StartSSHClient / StartSOCKS / StartExitNode / StartExec
- Fake addresses deterministic; danger flags surfaced in Session metadata or options
- [x] Commit `feat: session and adapter stubs for Plan 4 modes`

### Task 2: Service + danger confirmations (TDD)

- Service methods; refuse no-auth-ssh without explicit `confirmDangerous: true` (or equivalent)
- [x] Commit `feat: service methods and danger gates for SSH SOCKS exit exec`

### Task 3: Wails bindings

- Expose new APIs; regenerate bindings
- [x] Commit `feat: Wails bindings for Plan 4`

### Task 4: UI — Services (SSH serve, exit-node, exec) + Connect (SSH client, SOCKS)

- Glass forms; i18n keys for all new strings (en + zh-CN)
- Danger modal for no-auth-ssh
- [x] Commit `feat: UI for SSH SOCKS exit-node exec`

### Task 5: Keys — DERP / region settings

- Persist app settings for region / derpmap URL; pass into adapter starts where library supports
- [x] Commit `feat: DERP region settings in Keys`

### Task 6: System tray

- Tray icon when app running; menu: Open, list/count active sessions if cheap, Quit
- Document macOS/Windows notes; Linux best-effort
- [x] Commit `feat: system tray for running sessions`

### Task 7: Real adapter + docs

- Wire pinned Tailcat APIs; `go test ./...` + frontend build green
- Update plans README; Diagnostics “not yet wired” cleared for these modes
- [x] Open PR `Plan 4: SSH SOCKS exit-node exec DERP tray`

## Acceptance

- Fake path covers all Plan 4 modes in UI with confirmations
- Real path compiles; network tests optional/integration-tagged
- i18n/scrollbar not regressed
- Manual checklist items from design §9 for these modes marked done or explicitly deferred with Diagnostics note

## Self-review

Exact Tailcat API names deferred to implementer reading pinned module. Tray may be thinner on first cut if Wails constraints bite — still ship Open + Quit minimum.
