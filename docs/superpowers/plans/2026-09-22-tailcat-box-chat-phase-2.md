# Tailcat Box Phase 2 — Files, resume, burn-after-read

**Goal:** Send and receive files on the Tailcatchat port 102 path, resume a contiguous prefix between two Boxes, and collapse burn-after-read items until the receiver opens them.

**Architecture:** `internal/chat` owns hashing, offsets, `chat-inbox/`, `chat-partials/`, capability checks, and burn metadata. The adapter still only moves packed TCH1 frames. Phase 2 hello objects add `caps: ["burn", "resume"]`. Official peers (no `resume` cap) get one `type: "file"` envelope. A failed chunk is retried up to three times; each retry sends `file-begin` again so a peer that stored the prefix answers with that offset.

**Out of scope:** Voice notes, WebRTC, toolbox navigation, resume across process restarts.

## Acceptance

- `SendChatFile(path, burn, ttlSec)` and `DiscardChatMessage(id)` are Wails bindings. `ResendChatFile(id)` and `SaveChatFile(id)` support the transfer row and Download / Save.
- Attach, the native file picker, and drag-and-drop send one outbound file. A second file waits; a third replaces the queued item and the composer reports “Replaced the queued file.”
- Images render inline. Other files show name, size, and Download.
- `tc:fake-official` receives a single `type: "file"` payload and the row says “Full transfer — this peer cannot resume.”
- `tc:fake-resume` drops the first chunk once. The next chunk starts at the stored prefix and the row shows resume progress.
- `tc:fake-box` answers hello with `caps: ["burn", "resume"]`.
- Inbound burn text and files stay collapsed until Reveal or Preview, then `DiscardChatMessage` removes the transcript row and any inbox or partial file. `ttlSec` 0 discards on close. `ttlSec` 5 or 30 counts down.
- The sender badge follows the current peer caps.
- `SetDataDir` sweeps `chat-inbox/` and `chat-partials/`. `Stop` deletes partials. The next launch sweeps both.
- English and 简体中文 strings cover the new chrome.
- `go test ./...` and `cd frontend && npm run build` pass.
