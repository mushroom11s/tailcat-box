# Implementation plans

- [Plan 1: Foundation vertical slice](2026-09-21-tailcat-desktop-client-plan-1.md) — **done.** Wails scaffold, Session core, adapter isolation, glass UI, ephemeral pipe serve + dial (fake + real `github.com/tailscale/tailcat` v0.7.0)
- [Plan 2: Ports, keys, ping](2026-09-21-tailcat-desktop-client-plan-2.md) — **done.** Port serve/forward/browse, key store, parse/resolve, diagnostics ping (fake + real adapter)
- [Plan 3: Files](2026-09-21-tailcat-desktop-client-plan-3.md) — **done.** Recv inbox, send/cp, serve directory, list remote (fake + real SFTP), session-list jitter fix
- Plan 4: SSH, SOCKS, exit-node, exec, DERP, tray
