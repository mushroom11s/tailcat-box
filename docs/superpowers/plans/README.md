# Implementation plans

- [Phase 1: Nav, room, text](2026-09-22-tailcat-box-chat-phase-1.md) — **planned.** Chat + Settings shell, one in-memory room, paste raw `tc…`, hello, text both ways, Keys & DERP and Diagnostics inside Settings. Design: [Tailcat Box chat spec](../specs/2026-09-22-tailcat-box-chat-design.md). Phases 2–4 each get their own plan; they are not part of this one.
- [Plan 1: Foundation vertical slice](2026-09-21-tailcat-desktop-client-plan-1.md) — **done.** Wails scaffold, Session core, adapter isolation, glass UI, ephemeral pipe serve + dial (fake + real `github.com/tailscale/tailcat` v0.7.0)
- [Plan 2: Ports, keys, ping](2026-09-21-tailcat-desktop-client-plan-2.md) — **done.** Port serve/forward/browse, key store, parse/resolve, diagnostics ping (fake + real adapter)
- [Plan 3: Files](2026-09-21-tailcat-desktop-client-plan-3.md) — **done.** Recv inbox, send/cp, serve directory, list remote (fake + real SFTP), session-list jitter fix, glass scrollbar, English / 简体中文 (`zh-CN`) i18n
- [Plan 4: SSH, SOCKS, exit-node, exec, DERP, tray](2026-09-21-tailcat-desktop-client-plan-4.md) — **done.** SSH serve/client (no-auth confirmations), SOCKS, exit-node, exec, Keys DERP/region, system tray Open+Quit
