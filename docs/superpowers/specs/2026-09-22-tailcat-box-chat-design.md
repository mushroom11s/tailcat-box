# Tailcat Box (猫砂盆) — Chat-centric redesign with Tailcatchat interoperability

**Date:** 2026-09-22  
**Status:** Ready for review. Design only. This document does not implement chat.  
**Product name:** Tailcat Box (English UI) / 猫砂盆 (简体中文 UI)  
**Repo and module:** stay `tailcat-desktop-client` / `github.com/mushroom11s/tailcat-desktop-client`. This spec does not rename the repository, Go module, or binary.  
**Supersedes:** the product goal and primary navigation in [2026-09-21-tailcat-desktop-client-design.md](2026-09-21-tailcat-desktop-client-design.md). Plans 1–4 remain the record of the toolbox that already shipped in code.  
**Interop target:** [tailscale/tailcatchat](https://github.com/tailscale/tailcatchat) as of the protocol described in section 4 (TCH1 envelopes, ports 100–103).

## 中文摘要

Tailcat Box（猫砂盆）把现有桌面客户端从 Tailcat 命令行工具箱改成以聊天为中心的应用：发送文字、文件，并逐步对齐官方 Tailcatchat 的语音条和 WebRTC 音视频 / 屏幕共享。做法是原生 React/Wails 聊天壳加上 Go 适配器里的兼容协议，不内嵌官方网页。主侧栏只保留「聊天」和「设置」；密钥 / DERP 与诊断放进设置的子区。第一版通过粘贴 `tc…` 地址发现对端，不使用 `#invite=` 链接。阅后即焚和断点续传是 Box 与 Box 之间的信封扩展；对方若是官方网页，则整文件重传、对方可能保留副本，并在界面说明。交付顺序：导航与文字互通 → 文件、续传、阅后即焚 → 语音条 → 音视频与屏幕共享。

## 1. Problem / goals / non-goals

### Problem

The shipped app is a Tailcat CLI toolbox: Connect, Services, Files, Keys & Addresses, Diagnostics, and Settings. The product to build now is a chat application. People should open a room, exchange a Tailcat address, and send messages and files. A toolbox layout teaches the wrong task.

Official Tailcatchat already defines an encrypted chat over Tailcat (text, files, voice notes, and WebRTC calls). Box must talk to that client. Box must not become a wrapped copy of the Tailcatchat web app.

### Goals

- Chat is the product: text and files first, then voice notes, then live voice, video, and screen share.
- Wire compatibility with current Tailcatchat for every feature that client implements: ports, TCH1 envelopes, hello, and WebRTC signaling.
- Approach A: a native desktop shell (existing Wails + React + TypeScript) and a Tailcatchat-compatible protocol implemented in the Go adapter.
- Primary navigation is **Chat** and **Settings** only.
- Keys, DERP region, and DERP map URL live under Settings. Diagnostics (session list, event log, ping) live under Settings.
- Peer discovery in these milestones exchanges raw `tc…` addresses. The user copies the local address and pastes the peer address.
- Burn-after-read (阅后即焚) is optional on each outgoing item.
- File transfer between two Boxes resumes a contiguous byte prefix after a dropped chunk. A peer that does not resume gets one full TCH1 file envelope, and the transfer row says so.
- English and 简体中文 (`zh-CN`) cover every new user-visible string, using the existing locale switcher and `tailcat-locale` storage.
- Visual language stays the current Apple-inspired / Liquid Glass style, including light, dark, and system theme.

### Locked decisions

| Topic | Decision |
| --- | --- |
| Shell | Native React/Wails chat UI. Do not load or iframe the official Tailcatchat page. |
| Protocol owner | Go adapter dials and listens. The webview does not speak Tailcat itself. |
| WebRTC owner | The webview owns `RTCPeerConnection`, `getUserMedia`, and `getDisplayMedia`. Go only carries the signaling envelopes. Do not add a Go WebRTC stack. |
| Nav | Chat + Settings. No Advanced disclosure and no second nav that brings back Connect, Services, or Files. |
| Discovery | Paste `tc…` only. Hello on port 100 still runs, because that is how Tailcatchat learns the return address. `#invite=` links are out of these milestones. |
| Room key | Ephemeral by default. Settings can select a saved key before the room starts. |
| History | Transcript is in memory for this process. Restart shows an empty transcript. |
| Resume scope | Resume inside the running app after a dropped chunk. Quit deletes partial files. |
| Caps | A hello advertises only capabilities that build implements. Phase 1 omits `caps`. |
| Legacy Go API | Pipe, ports, SSH, SOCKS, exit-node, exec, and SFTP file methods may stay compiled. No product screen calls them. |

### Non-goals

- Implementing chat in the same change as this spec.
- Embedding Tailcatchat’s HTML, CSS, or `app.js`.
- `#invite=` / URL-fragment invites, multi-party rooms, delivery queues, and message history.
- Resume across app restarts, sparse (non-prefix) resume, and more than one outbound file at a time.
- A TURN server. Live media can fail on restrictive networks while chat keeps working.
- Port 1 netcat / CLI pipe as a chat feature. Inbound port 1 streams are discarded.
- Showing Connect, Services, Files, or a standalone Keys or Diagnostics page, including inside a collapsed Advanced group.
- Deleting the legacy Go toolbox API, the key store, or plans 1–4 docs in these milestones.
- Android, a repository rename, and a new visual system.

## 2. Architecture

Box keeps the current process shape: React UI, Wails bindings, a Go service that does not import Tailcat types, and an adapter that is the only Tailcat importer. Chat is a new vertical slice beside the existing toolbox service. It does not replace `internal/adapter.TailcatAdapter` in these milestones.

```
┌──────────────────────────────────────────────┐
│  UI: Chat page + Settings page               │
│  WebRTC and voice capture live in the webview│
└────────────────────┬─────────────────────────┘
                     │ Wails methods + tailcat:event
┌────────────────────▼─────────────────────────┐
│  internal/chat                               │
│  Room, peer, transcript, transfers, caps     │
│  Envelope codec (no Tailcat import)          │
└────────────────────┬─────────────────────────┘
                     │ ChatAdapter
┌────────────────────▼─────────────────────────┐
│  internal/adapter  chat_real.go / chat_fake.go│
│  Listen + dial TCP ports 100–103             │
└────────────────────┬─────────────────────────┘
                     │
┌────────────────────▼─────────────────────────┐
│  Embedded github.com/tailscale/tailcat       │
│  DERP, then direct when the library can      │
└──────────────────────────────────────────────┘
```

### Frontend

- `frontend/src/App.tsx` navigates `chat | settings` and opens Chat on launch.
- `frontend/src/pages/ChatPage.tsx` is the room: status, addresses, transcript, composer, and (phase 4) the media dock.
- `frontend/src/pages/SettingsPage.tsx` keeps Appearance, client info, and system info, and gains two subsections: **Keys & DERP** and **Diagnostics**.
- Remove Connect, Services, Files, Keys, and Diagnostics from the nav array and from App’s page union. Do not mount those pages. Their React files may remain on disk until a later cleanup; nothing in the shell may import them.
- New chrome is added to `frontend/src/i18n/en.ts` and `frontend/src/i18n/zh-CN.ts`.
- `frontend/src/lib/wails.ts` gains chat methods and an in-browser fake. After `StartChatRoom` exists, `hasWailsBindings()` treats that method as the signal that the Go app is present.

### Chat service (`internal/chat`)

The service owns the single room, the current peer, the in-memory transcript, and outbound file state. UI code and this package never import `github.com/tailscale/tailcat`.

Responsibilities:

- Start and stop one room. A second start returns the running room.
- Validate peer addresses (`tc` prefix) and send hello.
- Track peer capabilities from the peer’s hello.
- Assign message ids. Keep bodies in memory until `DiscardChatMessage` or until the process exits.
- Run one outbound file transfer at a time. Text and voice use their own streams and may proceed during a file transfer.
- Map adapter failures to the user-facing errors in section 5.

The room is one `session` of kind `chat` so Settings → Diagnostics can list it. Individual messages are not sessions.

### Adapter port

`ChatAdapter` lives in `internal/adapter` and is implemented twice: real and fake. Phase 1 adds the stream methods to both implementations together. The interface must not contain methods whose body panics.

Phase 1 surface, implemented by both the real and fake adapters in that phase:

- `StartRoom(ctx, RoomOpts) (Room, error)` — listen; the first event carries the local `tc…` address.
- `Room.SetPeer(addr)` — remember the dial target.
- `Room.SendEnvelope(ctx, port, meta, payload)` — one TCP stream, then close.
- `Room.Close()`.
- Inbound events for an accepted connection on port 100, 101, 102, or 103, plus dial errors.

Later phases call `SendEnvelope` again. The adapter does not grow file, voice, or WebRTC methods. Hashing, offset accounting, temp files, and capability decisions belong in `internal/chat`.

Wails bindings the UI calls:

| Binding | Phase |
| --- | --- |
| `StartChatRoom`, `ConnectChatPeer`, `SendChatText`, `RestartChatRoom`, `StopChatRoom` | 1 |
| `SendChatFile(path, burn, ttlSec)`, `DiscardChatMessage(id)` | 2 |
| `SendChatVoice(mime, durationSec, audio)` | 3 |
| `SendChatSignal(metaJSON)` | 4 |

`DiscardChatMessage` ships in phase 2 with burn-after-read. Phase 1 has nothing to discard.

`RoomOpts` carries the optional saved private-key JSON, DERP region, and DERP map URL, using the same network options the toolbox adapter already stores. An empty key means a new ephemeral key. Changing key, region, or DERP map URL applies on the next room start.

Real adapter behavior:

- One Tailcat server accepts the room.
- Each outbound item dials the peer address on the chosen port, writes in 64 KiB slices, half-closes, drains the read side, and closes. That matches Tailcatchat `sendStream`.
- Use the library’s normal path selection. Chat must work when the peer is DERP-only, which is true of Tailcatchat in the browser. Direct upgrade is a bonus, not a requirement.
- Inbound port 1: read to EOF, discard, emit a diagnostic event, and do not create a message.

Fake adapter (`TAILCAT_ADAPTER=fake`, and the in-browser fake):

- `StartRoom` returns `tc:fake-room-<sessionID>` and does not touch the network.
- Two fake rooms in one process deliver envelopes to each other by address.
- Peer `tc:fake-echo` answers a text envelope with the fixed text `echo`.
- Peer `tc:fake-official` accepts standard text and file envelopes, ignores `burn` / `ttlSec` / `caps`, and never answers `file-begin`.
- Peer `tc:fake-resume` answers `file-begin` with `file-offset` and can fail the next `file-chunk` once when the test asks it to.
- Peer `tc:fake-box` sends hello with `caps: ["burn", "resume"]`.

### Events

Reuse the existing Wails event `tailcat:event`. Chat event kinds:

| Kind | `Data` JSON |
| --- | --- |
| `room-ready` | local address |
| `peer` | address, caps |
| `message` | id, direction, type, and type-specific fields |
| `transfer` | id, offset, size, mode `resume` or `full` |
| `signal` | raw control meta for WebRTC (`rtc-offer`, `rtc-answer`, `rtc-hangup`) |
| `error` | user-facing message |

`Data` is a JSON string. Existing toolbox events keep their current kinds.

### Local files

| Path under the app config dir | Lifetime |
| --- | --- |
| Existing key store | Unchanged |
| `chat-inbox/` | Completed received files for this process. Swept on the next launch. |
| `chat-partials/<id>` | Resume prefix for this process. Deleted on success, on verification failure, on user cancel, and on the next launch. |

A burn item’s inbox file is deleted when the message is discarded. Save / Reveal copies bytes to a user-chosen path; that copy is outside Box and is not deleted.

## 3. UI

### Shell

Sidebar entries, top to bottom: **Chat**, **Settings**. Chat is selected on launch. The window and sidebar title use “Tailcat Box” in English and “猫砂盆” in 简体中文.

```
┌──────────┬──────────────────────────────────────────┐
│ Chat     │  Listening · tc…abcd            [Copy]  │
│ Settings │  Peer [ tc…........................ ]    │
│          │                            [Connect]    │
│          │  ────────────────────────────────────── │
│          │  transcript                              │
│          │  ────────────────────────────────────── │
│          │  composer                         [Send] │
└──────────┴──────────────────────────────────────────┘
```

Phase 1 shows the text composer only. Attach, burn, microphone, and call controls appear in the phase that implements them. They are absent before that, not disabled placeholders.

### Chat page

- Entering Chat starts the room. Failure shows the section 5 message and a **Retry** button. Visiting Settings does not stop the room.
- **Copy** writes the raw `tc…` address to the clipboard. It does not write a URL. Helper under the address: “Anyone with this address can send to this room while it is open.”
- Peer row: one text field and **Connect**. Helper: “Paste the other person’s Tailcat address.”
- Connect checks the `tc` prefix, sets the peer, and sends hello (section 4). An empty or invalid address focuses the field and shows the inline error. The composer text is kept.
- The system line `they're hear meow` stays that English phrase in both locales so manual interop matches Tailcatchat. The status text “Peer connected” is localized.
- Empty transcript lede: “Messages stay on this device until you quit.”
- Bubbles show You or Peer, plus the local time. A peer change inserts a system line “Peer changed” and keeps earlier bubbles.
- Enter sends. Shift+Enter inserts a newline. An empty Enter does nothing until phase 3.
- Send with no peer focuses the peer field.

### Settings subsections

Order on the page:

1. **Appearance** — existing language and theme controls.
2. **Client** and **System** — existing cards (version, update check, launch at login, network).
3. **Keys & DERP** — create, list, and delete named keys; DERP region; DERP map URL; room-key choice.
4. **Diagnostics** — the chat session, the event log, and ping. The ping address defaults to the current peer when one is set.

Room-key choice:

- **New room key** (default): ephemeral.
- A named key from the existing store.

The subsection states “Restart room to apply” when the selection differs from the running room. **Restart room** stops the listener, starts it again, clears the peer, and appends “Room restarted. Send the new address.” The transcript stays.

Diagnostics ping uses the existing ping behavior. It is the only Connect-style session action that stays on screen, and it stays inside this subsection.

### Burn-after-read UX (phase 2)

The composer control is a single choice:

- Off (default)
- Burn, until closed (`ttlSec` 0)
- Burn, 5 seconds
- Burn, 30 seconds

The sender’s own bubble stays for the rest of the session and shows a badge. The sender removes it only by deleting that bubble or by quitting. There is no remote delete receipt.

The badge is derived from the current peer caps whenever the transcript renders:

- Caps include `burn`: “Removed on their side after they open it.”
- Caps omit `burn`, including when no hello has arrived: “They may keep a copy.”

The receiver does not put burned body text into the transcript. The bubble is collapsed:

| Type | Collapsed label | Action |
| --- | --- | --- |
| Text | Burn after reading | Reveal |
| Image | Burn after reading | Preview |
| Other file | Burn after reading | Preview or Save |
| Voice (phase 3) | Burn after reading | Play |

Reveal, Preview, and Play open a transient viewer. `ttlSec` 0 closes and deletes when the user closes the viewer (Esc or Close). A positive `ttlSec` shows a countdown and closes when it reaches zero or when the user closes it sooner. Closing always discards.

Play starts audio. `ttlSec` 0 discards when playback ends or the user closes the viewer. A positive countdown discards at zero even if audio is still playing, and playback stops.

Save on a burned file still discards the in-app copy. The viewer says “Saving a copy keeps the file on disk.”

Discard calls `DiscardChatMessage` and deletes any inbox or partial file for that id.

### Later chat controls

- **Phase 2:** attach button, file picker, and drag-and-drop onto the window. Image MIME types render an inline preview. Other files show name, size, and Download. One outbound file runs at a time. A second file waits in a one-deep queue. A further file replaces that queued item, and the composer reports “Replaced the queued file.”
- **Phase 3:** microphone button. Holding it records; release sends. In an empty composer, holding Enter for 100 ms starts the same recording and releasing Enter sends. A short empty Enter tap does nothing. Shift+Enter still inserts a newline. Capture uses `MediaRecorder` when `audio/webm;codecs=opus` is supported. Otherwise the webview captures PCM and Go encodes a WebM/Opus payload before send. Incoming voice autoplays; if the webview blocks autoplay, the bubble stays and status reads “Voice received — tap play”.
- **Phase 4:** voice, video, and screen buttons, plus a dock beside the transcript with local preview, remote media, hang up, and expand/collapse. The composer stays usable during a call.

## 4. Protocol

This section is the contract with Tailcatchat `web/app.js`. Box sends what that client parses, and accepts what that client sends.

### Ports

Each item is its own Tailcat TCP stream.

| Port | Name | Official use | Box use |
| --- | --- | --- | --- |
| 100 | Control | hello, rtc-offer, rtc-answer, rtc-hangup | Those, plus Box resume messages |
| 101 | Chat | text | text |
| 102 | Files | one whole file | one whole file, or Box chunks when both sides resume |
| 103 | Voice | voice notes | voice notes |
| 1 | Legacy | raw bytes | accept, discard, do not show |

### TCH1 envelope

Layout, matching Tailcatchat `packEnvelope` / `unpackEnvelope`:

| Offset | Length | Contents |
| --- | --- | --- |
| 0 | 4 | Magic `TCH1` (`54 43 48 31`) |
| 4 | 4 | JSON byte length, **big-endian** uint32 |
| 8 | N | JSON object, UTF-8. The packer sets `v` to `1`. |
| 8+N | rest | Payload bytes |

A frame that fails the magic check or whose length overruns the buffer is an error on that stream only. Unknown JSON fields are preserved and ignored by handlers that do not understand them. Unknown `type` values are ignored, which is what the official client does.

Official meta objects Box must send and accept:

| Port | Meta | Payload |
| --- | --- | --- |
| 100 | `{v:1, type:"hello", replyTo:"<tc…>"}` | empty |
| 100 | `{v:1, type:"rtc-offer", mode:"voice"\|"video"\|"screen", description:{type,sdp}}` | empty |
| 100 | `{v:1, type:"rtc-answer", description:{type,sdp}}` | empty |
| 100 | `{v:1, type:"rtc-hangup"}` | empty |
| 101 | `{v:1, type:"text"}` | UTF-8 text |
| 102 | `{v:1, type:"file", name, mime}` | entire file |
| 103 | `{v:1, type:"voice", mime, duration}` | audio bytes; `duration` is an integer number of seconds, at least 1 |

`mime` defaults to `application/octet-stream` when a file sender omits it. `name` is a single path segment: drop any directory, and reject empty names. This stops inbox path traversal.

Writes inside a stream use 64 KiB slices, then `closeWrite`, then read until EOF, then close.

### Hello and addresses

1. The room listener is already up before Connect.
2. Connect sends hello on port 100 to the pasted address: `{v:1, type:"hello", replyTo:"<local tc…>"}`. From phase 2 on, the same object includes `caps: ["burn", "resume"]`.
3. Phase 1 omits `caps`. A build advertises a capability only when that behavior exists in the same build.
4. An inbound hello with a `replyTo` that starts with `tc` sets the peer and appends the system line `they're hear meow`. Box does not send hello back in response. A hello whose `replyTo` is already the current peer does not duplicate the system line.
5. A missing or empty `caps` array means the peer is treated as official Tailcatchat for burn and resume.
6. Copy and Connect never build an `#invite=` URL.

### Burn-after-read extension

On text, file, voice, `file-begin`, and `file-chunk` meta, Box may add:

```json
{ "burn": true, "ttlSec": 0 }
```

`ttlSec` is `0`, `5`, or `30` when Box sends it. On receive, a missing or negative `ttlSec` with `burn: true` means 0. Values above 30 clamp to 30. `burn` false or absent means a normal item; `ttlSec` is then ignored.

Official Tailcatchat stores the payload and ignores these fields. Box still sends them, and the sender badge uses the disclosure in section 3 whenever `burn` is not in the peer caps.

### Resume extension

A received `type: "file"` envelope is a complete file. Box writes that payload straight to `chat-inbox/` and then shows it. Box does not treat that payload as a suffix.

Outbound choice:

- Peer caps omit `resume`, or no hello has advertised caps: send one port 102 envelope, `type: "file"`, payload the whole file from byte 0. Do not send `file-begin`. Transfer mode is `full`, and the row reads “Full transfer — this peer cannot resume.”
- Peer caps include `resume`: use the prefix handshake below.

The handshake:

1. The sender streams a SHA-256 of the file (lowercase hex) and the size. The hash must not require a second full copy of the file in memory.
2. The sender writes `{v:1, type:"file-begin", id, name, mime, size, sha256, replyTo, burn, ttlSec}` on port 100. `id` is a UUID. `replyTo` is the sender’s current room address. Payload is empty.
3. The receiver dials `replyTo` port 100 with `{v:1, type:"file-offset", id, offset}` where `offset` is the contiguous prefix already in `chat-partials/<id>` (0 if none).
4. If `file-offset` for that id does not arrive within 10 seconds, the sender abandons resume and performs the full `type: "file"` send. The row uses the same full-transfer line as above.
5. When `file-offset` arrives, the sender sends 256 KiB chunks (the last chunk may be shorter) as separate port 102 streams:

```json
{
  "v": 1,
  "type": "file-chunk",
  "id": "<uuid>",
  "name": "report.pdf",
  "mime": "application/pdf",
  "size": 10485760,
  "sha256": "<lowercase hex>",
  "offset": 0,
  "burn": false,
  "ttlSec": 0
}
```

The payload is the file bytes at `[offset, offset+len)`. Inner writes are still 64 KiB.

6. The receiver accepts a chunk only when `offset` is less than or equal to the bytes already stored and the chunk extends that prefix. A gap (`offset` greater than the stored prefix) is dropped. The next `file-begin` for the same id answers with the real prefix.
7. A failed chunk dial is retried up to 3 times. If it still fails, the transfer stops and the row offers **Resend**. **Resend** starts at step 2 with the same id, so a receiver that kept a prefix answers with that offset.
8. When the stored length equals `size`, the receiver hashes the temp file. A match moves it into the transcript and `chat-inbox/`. A mismatch deletes the temp file and surfaces “File failed verification.” The row offers **Resend**, which starts at step 2 with the same id. The receiver answers offset 0 because the partial is gone.

`file-chunk` is sent only after a `file-offset` response. Official clients ignore unknown control types, so a `file-begin` they receive does not create a file. Box does not send `file-begin` unless the peer advertised `resume`, so a normal official transfer never waits on the 10 second timer.

### WebRTC signaling (phase 4)

Signaling matches Tailcatchat. Media is WebRTC DTLS-SRTP in the webview, not a Tailcat stream.

- ICE servers: `stun:stun.l.google.com:19302` only.
- The caller creates an offer, waits until `iceGatheringState` is `complete` or 5 seconds have passed, then sends `rtc-offer` with the full local description. Candidates are not trickled.
- The answerer does the same with `rtc-answer`.
- `mode` is `voice`, `video`, or `screen`.
- Voice captures audio. Video captures audio and video. Screen capture uses `getDisplayMedia({video: true, audio: true})` on the caller. The screen answerer does not capture local media.
- Glare: if this client is already building an offer, it ignores an inbound `rtc-offer`.
- One live link. Starting another closes the current peer connection locally before the new offer, and does not send hangup for that replacement.
- Hangup sends `rtc-hangup` when a link was actually up.
- An ended display-capture track hangs up.

## 5. Error handling / degradation

Room and composer state survive these errors. A failed send does not clear the composer draft.

| Condition | User-facing result |
| --- | --- |
| Peer address does not start with `tc` | Inline “Paste a Tailcat address that starts with tc.” |
| Room listen fails, including DERP or key errors | Status shows the adapter message and **Retry**. The transcript stays. |
| Hello or text dial fails | “Could not reach peer. Check the address and that they are online.” |
| Bad TCH1 frame | System line “Could not read a message.” The room stays up. |
| Unknown envelope type | Ignore that stream. |
| Inbound port 1 | Diagnostic log `ignored port 1 stream`. No bubble. |
| File hash mismatch | “File failed verification.” Partial deleted. |
| Resume not available | Full retransfer, row text “Full transfer — this peer cannot resume.” |
| Burn sent to a peer without the `burn` cap | Message still sends with burn fields. Badge: “They may keep a copy.” |
| Chunk retries exhausted | Transfer row error and **Resend**. |
| Another file is chosen while one is sending | The new file waits as the single queued item. A third choice replaces the queued item and the composer reports “Replaced the queued file.” |
| Microphone, camera, or screen permission denied, or the webview has no screen-capture API | “Microphone access was denied.” / “Camera access was denied.” / “Screen sharing was denied.” / “Screen sharing is unavailable on this system.” Chat stays up. |
| WebRTC `failed` or `closed`, or no direct media path | End the link. “Live media failed. Restrictive networks have no relay for calls, so voice and video can fail while chat still works.” |
| Voice MIME the webview cannot play | Decode to WAV in Go and play that. If decode fails, keep the bytes and show “Cannot play this voice message.” |
| Voice MIME the webview cannot record as `audio/webm;codecs=opus` | Transcode to that MIME before send, so current Tailcatchat in Chrome can play it. |

Burn disclosure is a badge, not a blocking dialog. The send proceeds.

## 6. Milestones / acceptance criteria

Ship in order. A later phase does not put toolbox pages back into the nav. Implementation plans should be one plan per phase. This spec is the input to those plans.

### Phase 1 — Nav, room, text

- The sidebar contains Chat and Settings and nothing else.
- Cold launch lands on Chat. The room starts, or shows Retry.
- Copy places the raw `tc…` string on the clipboard.
- Connect sends hello. An inbound hello sets the peer and shows `they're hear meow` once.
- Box Connect to a listening Tailcatchat room makes that web client set its peer from `replyTo` and show `they're hear meow`. Text then flows both ways on port 101.
- Pasting Box’s address into Tailcatchat and pressing Set delivers that client’s text to Box. Box sends back after the user pastes the web room address and presses Connect.
- Two Boxes exchange text both ways after one Connect: the caller already has the callee’s address, and hello installs the caller’s address on the callee.
- Keys & DERP and Diagnostics are reachable inside Settings. Restart room applies a saved key and changes the address.
- Connect, Services, Files, and standalone Keys / Diagnostics screens are not mounted.
- English and 简体中文 strings exist for the new chrome.
- `TAILCAT_ADAPTER=fake` covers room start, hello, and text with no network.

### Phase 2 — Files, resume, burn-after-read

- A file sent from Box arrives in official Tailcatchat as a named file. An image renders inline there and in Box. A file sent from official Tailcatchat arrives intact in Box.
- Drag-and-drop and the file picker both send.
- Against `tc:fake-resume`, a failed chunk continues from the stored prefix, and the row shows resume progress.
- Against `tc:fake-official`, the same file is sent as one `type: "file"` envelope and the row says the peer cannot resume.
- A burned text and a burned file stay collapsed until Reveal or Preview, then disappear from the transcript and from disk after close or countdown.
- The sender badge says the peer may keep a copy when caps do not include `burn`.
- Quitting and relaunching leaves `chat-partials/` and `chat-inbox/` empty.

### Phase 3 — Voice notes

- The microphone button and the 100 ms empty-Enter hold send a port 103 voice envelope.
- A voice note recorded by current Tailcatchat in Chrome plays on macOS and on Windows.
- A voice note recorded by Box plays in that Chrome Tailcatchat client.
- Burn-after-read on a voice note follows the Play rules in section 3.
- Autoplay failure leaves a playable bubble.

### Phase 4 — Live voice, video, and screen share

- Voice, video, and screen share complete against official Tailcatchat using the signaling in section 4.
- The media dock can expand and hang up.
- A failed live link leaves the transcript and composer usable.
- An inbound offer while this client is already calling is ignored.
- Screen share from Box is viewable in Tailcatchat, and a Tailcatchat screen share is viewable in Box.

## 7. Testing strategy

### Unit

- Envelope golden vectors in `internal/chat`: magic, big-endian length, `v: 1`, text, file, voice, hello, and the three WebRTC control types. Include one vector with extra `burn` and `ttlSec` fields and show that a handler which only reads `type` still sees `text` or `file`.
- Reject a bad magic and an overrun length.
- Resume accounting: prefix growth, overlap that only writes the new tail, gap rejected, hash match, hash mismatch deletes the partial.
- Cap logic: omitted `caps` selects full transfer and the “may keep a copy” badge; `["burn","resume"]` selects resume and the burn badge.
- File names with directories store only the final segment.

### Fake adapter

- Go tests drive two fake rooms for hello and text.
- `tc:fake-official` file send asserts a single `type: "file"` payload and no `file-chunk`.
- `tc:fake-resume` drops the first chunk once and asserts the second attempt starts at the stored offset.
- Frontend in-browser fake: Chat renders, Connect to `tc:fake-echo` appends `echo`, and the nav has two items. `npm run build` must pass.

### Commands

The existing CI contract stays in force:

```bash
go test ./...
cd frontend && npm run build
```

Real DERP interop stays out of default CI, same as today’s integration-tagged adapter test.

### Manual interop with Tailcatchat web

Run official Tailcatchat locally (`./build.sh`, then a static server) or use its GitHub Pages deployment. Run Box with the real adapter.

1. Start a Tailcatchat room and copy its raw `tc…` address (the address field, not only the invite link). Connect to it from Box. Confirm the web UI shows `they're hear meow` and that text travels both ways.
2. Reverse the roles: copy Box’s address into Tailcatchat and press Set, or open the web invite once so the web client sends hello. Confirm Box shows the peer without any invite parser in Box.
3. Phase 2: exchange a small text file and a PNG in both directions. Then kill the Box network mid-transfer toward a second Box and confirm resume. Repeat toward the web client and confirm a full retransfer message.
4. Phase 2: send a burned line to the web client and confirm the web client still displays it, while Box shows “They may keep a copy.” Send a burned line to another Box and confirm it disappears after reveal.
5. Phase 3: exchange voice notes in both directions on macOS and Windows.
6. Phase 4: place a voice call, a video call, and a screen share in both directions. Disconnect the media path if possible and confirm chat messages still send.

## 8. Open questions

None. Section 1 non-goals are deferred on purpose, and the decisions in this document are enough to write one implementation plan per phase.
