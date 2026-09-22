# Tailcat Box — stronger Liquid Glass

**Date:** 2026-09-22  
**Status:** Visual pass on the existing Chat / Tunnel / Settings shell.

## References

Two approved mockups (not committed):

- **Settings.** Deep indigo window, frosted sidebar with the pixel-cat mark stacked above “Tailcat Box”, purple glow on the active nav item, Appearance as a glass section (language and theme on the right), two info cards, and a Keys & DERP glass section.
- **Chat.** The transcript is the focus. A room/peer header, incoming messages on darker frost with the cat mark, outgoing messages on cooler translucent blue, and a floating composer with the icon cluster, burn control, and Send at the far right.

The chat mockup also shows a second Chat nav item and a macOS title strip. Those are artifacts. Navigation stays Chat, Tunnel, and Settings pinned at the bottom. The window title stays the English string “Tailcat Box”.

## Decisions

- Push the existing tokens in `frontend/src/styles/glass.css`: heavier blur and saturation, purple/blue ambient radials, specular top edges, and a single rounded window instead of two flat panes.
- Light, dark, and system themes share that treatment. Light uses the same blur, specular edge, and purple active states over a brighter lavender/blue wash.
- Fonts stay on the system stack, with PingFang SC, Microsoft YaHei, and Noto Sans SC as CJK fallbacks. No webfont bundle.
- Type is tighter on titles, 15px for body, and quieter 12px meta. Spacing follows an 8px rhythm.
- Settings still shows the data the app already has (appearance, about, system info, keys, DERP, diagnostics). Mockup-only rows such as memory, CPU, architecture, and a homepage link are not added.
- Chat, tunnel port serve, local forward, burn, multi-select delete, and the voice/media controls keep their behavior. The composer still places Burn immediately before Send.

## Out of scope

Feature changes, new settings fields, a duplicate Chat destination, and bundling the mockup images.
