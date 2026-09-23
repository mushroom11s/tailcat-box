# Tailcat Box (猫砂盆) — Multi-room chat

**Date:** 2026-09-23  
**Status:** Ready for review. Design only. This document does not implement multi-room chat.  
**Product name:** Tailcat Box (English UI) / 猫砂盆 (简体中文 UI)  
**Extends:** [2026-09-22-tailcat-box-chat-design.md](2026-09-22-tailcat-box-chat-design.md). Local multi-select delete and the usage FAQ stay in force inside each room.  
**Repo:** [mushroom11s/tailcat-box](https://github.com/mushroom11s/tailcat-box), `main` as of the FAQ commit (`docs/faq.md`).

## 中文摘要

现在整次进程只有一个 `internal/chat.Service`：冷启动就监听一个房间，侧栏「聊天」下面没有房间列表。本设计改成同一进程里多个房间同时监听、同时收消息。每个房间仍是今天这一套：一把密钥、一个 `tc…` 地址、一个当前对端、一份内存记录。一个房间里面仍然不是群聊；[使用说明](../../faq.md)里「多人连同一个地址」的行为保持不变。

侧栏 **Chat / 聊天** 下第一项是虚线按钮 **+ New room / + 新房间**，每个房间是它下面的子项。子项标题优先用设置里的**本机昵称**（只在本机，不上协议）；没设昵称就用短地址缩写。永久密钥的密钥名只作次要说明。

**对方地址在新建大厅里是可选的。** 不填对方也可以新建临时房间或永久房间。只有用户提交了对方地址时，才自动新建一个临时房间并 Connect。已有房间时，默认打开这些房间（上次选中的那一间），而不是每次都进空白新建页。新建页只在还没有任何房间时出现，以及用户点了 **+ 新房间** 时出现。房间和记录仍只活在本次进程里，退出后清空，和今天的记录一样。

## 1. Problem / goals / non-goals

### Problem

The shipped app is one chat room. `App` holds one `*chat.Service`. Launch calls `StartChatRoom`, and every chat binding (`ConnectChatPeer`, `SendChatText`, and the rest) talks to that service. The sidebar entry **Chat / 聊天** is a single destination, not a list of rooms. A second `Start` on the same service returns the running room. On the real adapter, `Real.StartRoom` also keeps one `*realRoom` and closes the previous listener before storing the new one.

People need more than one open room in the same process: different addresses at the same time, each able to receive while another room is on screen.

### Goals

- Several rooms listen at once. A room that is not on screen still receives.
- The sidebar lists those rooms under **Chat / 聊天**, with **+ New room / + 新房间** as the first child.
- Creating a room adds that child and opens the same room UI `ChatPage` already is.
- A new room can be ephemeral, or (Phase B) bound to a saved genkey. The peer address is optional for both.
- Submitting a peer address from the lobby creates an ephemeral room and Connects to that peer.
- When this process already has rooms, Chat shows the last selected room, not the create lobby.
- Each room keeps today’s one-peer transcript, files, voice, and live-call behavior.
- English and 简体中文 cover every new string.

### Locked decisions

| Topic | Decision |
| --- | --- |
| Concurrency | Every open room keeps its Tailcat listener running. Rooms receive at the same time. This is not a single-active listener. |
| Sidebar label | Prefer the local-only peer remark for that room’s current peer address when the remark is non-empty. Otherwise a short address abbreviation. The remark is never on the wire. Do not use the Settings nickname as the room label; that nickname stays on outgoing bubbles only. A permanent key’s name may be shown as secondary text. |
| Lobby actions | Create an ephemeral room, or a permanent room on a saved genkey, or submit a peer address. Peer is optional. Submit of a peer address is the only lobby path that auto-creates an ephemeral room and Connects. |
| Default view | If the process already has rooms, Chat opens on those rooms (the last selected room). The lobby is not the landing page on every visit. |
| Nav | Under **Chat / 聊天**, the first child is a dashed **+ New room / + 新房间** control. Each room is a child under Chat. |
| Evolution | A room manager owns N `chat.Service` values (one session each). Do not keep a single process-wide service. |
| Remark source | Room labels read the local peer-remark map for the room’s current peer address. The Settings nickname is not a room label. |

### Proposals

These are recommendations, not product-owner locks. The rest of this spec treats them as the defaults to build.

| Topic | Proposal |
| --- | --- |
| Unread | A per-room count of inbound messages that arrived while that room was not focused. Opening the room clears it. No dock badge and no tray badge. |
| Close | **Close** stops that room’s listener, drops its transcript, and removes the sidebar child. If the transcript has any inbound or outbound message, confirm first. An empty or system-only transcript closes immediately. |
| Soft cap | At most 8 open rooms. The 9th create fails with a clear error and does not start a listener. |

### Non-goals

- Multi-party chat inside one room. One room still has one current peer. The [usage FAQ](../../faq.md) behavior stays: several people can send into one address, incoming bubbles are Peer / 对方 unless a local remark is set for the current peer, and replies go only to the peer that completed hello most recently. The remark is not sent and does not identify which address sent the line.
- Putting the Settings nickname, or any display name, into hello, TCH1 envelopes, session addresses, or diagnostics as a peer identity.
- Persisting rooms, transcripts, unread counts, or the last-selected room across quit. v1 rooms die with the process, same as today’s transcript.
- `#invite=` links, a room directory, or discovering peers without a pasted `tc…` address.
- Per-room tray menu items, OS notifications, or a badge on the tray icon.
- Changing Tunnel, the protocol ports, burn-after-read, resume, voice notes, or WebRTC signaling.
- Editing `docs/faq.md` in the design-only change. FAQ copy is a shipping task (section 10).

## 2. Architecture

Box stays React + Wails + `internal/chat` + `internal/adapter`. The protocol does not change. What changes is how many rooms the process owns, and the one place the real adapter still assumes a single chat listener.

```
┌──────────────────────────────────────────────────────┐
│  UI                                                   │
│  Chat group: + New room, room children                │
│  Main: lobby  or  one ChatPage (the focused room)    │
└──────────────────────────┬───────────────────────────┘
                           │ Wails methods take room id
                           │ tailcat:event (SessionID = room id)
┌──────────────────────────▼───────────────────────────┐
│  Room manager                                         │
│  N × chat.Service, order, focus, cap                  │
└──────────────────────────┬───────────────────────────┘
                           │ one Service = one listener,
                           │ one peer, one transcript
┌──────────────────────────▼───────────────────────────┐
│  ChatAdapter                                          │
│  Real: one tailcat.Server per room (do not replace)   │
│  Fake: already a map of rooms by address              │
└──────────────────────────────────────────────────────┘
```

### Why N services

`chat.Service` is already the one-room state machine: one `adapter.Room`, one peer, one transcript, one outbound file queue, one session of kind `chat`. A second `Start` while that session is starting or running returns the same session. Splitting that struct into N rooms would rework every lock and every send path.

The manager creates a new `chat.Service` per room and leaves those invariants alone. `App` holds the manager instead of one `*chat.Service`. Bindings take a room id and forward to that service. `DecodeChatVoice` stays a pure function and does not take a room id.

Rejected shape: one shared service with a map of rooms inside it. That throws away the working one-peer machine. Rejected shape: a single active listener that swaps when the sidebar selection changes. That contradicts concurrent receive.

### Adapter change the manager is not enough to fix

`(*Real).StartRoom` stores one `chat *realRoom`. A later `StartRoom` closes that room before it keeps the new server. N services on one `Real` would still kill the previous listener.

Required behavior:

- Each `StartRoom` starts its own `tailcat.Server` and returns that room, and does not close any other chat room.
- `realRoom.Close` removes only that room from the adapter’s set.
- The fake adapter already keeps `chatRooms` by address. Keep that. Two ephemeral rooms already get distinct `tc:fake-room-<sessionID>` addresses.

`SendEnvelope` already dials with a client for that room’s peer. It does not need a process-wide chat slot.

### Room id

The room id is the `session.Session` id that `chat.Service` already creates (`session.New(session.KindChat)`). There is no second identifier. Event `SessionID`, sidebar keys, and Wails arguments all use that string.

### Bindings

Every chat method that today hits the single service takes the room id as its first argument, except `StartChatRoom`, which creates a room, and `DecodeChatVoice`, which stays global.

| Binding | Change |
| --- | --- |
| `StartChatRoom(keyName) (session, error)` | Empty `keyName` is ephemeral. A non-empty name loads that saved key, same as today’s `chatOpts`. Refuses at the cap and when that key is already listening. |
| `ConnectChatPeer(roomID, addr)` | Connect on that room only. |
| `SendChatText`, `SendChatFile`, `SendChatVoice`, `SendChatSignal`, `DiscardChatMessage`, `ResendChatFile`, `SaveChatFile` | Same behavior as today, scoped to `roomID`. |
| `RestartChatRoom(roomID, keyName)` | Restarts that room only: new listener, new address, peer cleared, that transcript kept, “Room restarted…” appended. Other rooms stay up. |
| `StopChatRoom(roomID)` | Stops that listener and drops that service. |
| `ListSessions` | Includes every open chat session, not one. |

Unknown `roomID` returns a clear error and does not touch another room.

The in-browser fake (`frontend/src/lib/wails.ts` and `chatBrowser.ts`) grows the same room id arguments. `chatBrowser.ts` already tracks rooms by address; the UI fake must stop assuming one global room.

### Launch

Remove the effect that calls `StartChatRoom` on startup. Cold launch starts no chat listener. Tunnel and toolbox sessions are unchanged.

## 3. Information architecture

Two main-pane modes exist under Chat: the **lobby** and a **room**. Tunnel and Settings stay where they are.

### What “historical rooms” means

History is the set of rooms opened in this process. It is not a database and it is not restored after quit. Hiding the window is not quit: today’s tray hide keeps sessions, and these rooms stay too.

“Default to historical rooms” means: if that set is non-empty, navigating to Chat opens the last selected room. It does not mean replaying a transcript from disk, and it does not mean showing the lobby on launch or every time Chat is opened. The lobby stays on screen only while the user is in that create flow.

### When the lobby shows

The lobby shows only when:

- The process has zero rooms (cold launch, or the last room was closed), or
- The user activates **+ New room / + 新房间**.

The lobby does not show merely because the user opened the window, clicked **Chat**, or returned from Tunnel or Settings.

### When a room shows

- After a successful create, the new room is selected and its `ChatPage` opens.
- If any room exists, navigating to Chat shows the last selected room: the Chat parent, the tray **Chat** item, and a return from Tunnel or Settings all do this. They do not create a room and they do not reopen the lobby. If the last selected room was closed, show the newest remaining room. If none remain, show the lobby.
- **+ New room** is the only control that opens the lobby while rooms exist. Clicking a room child leaves the lobby and shows that room. Other listeners keep running. Clicking the Chat parent while the lobby is up does the same when a room exists: it shows the last selected room.
- Text already typed in the lobby (peer field, and in Phase B the key choice) is kept in memory until a create consumes it or the process quits. Leaving the lobby does not clear that draft. Opening **+ New room** again shows it.

Activating **+ New room** while rooms exist does not stop those rooms and does not remove their children. The dashed control is the selected row, and the main pane is the lobby.

There is no third empty screen. Zero rooms is the lobby.

### Last selected room

The manager remembers the last room id the user opened or created, in memory only. Quit clears it. Creating a room sets it to the new id. Closing the focused room moves it to the newest remaining room, or clears it when none remain.

## 4. Sidebar

```
┌────────────────────┬────────────────────────────────────┐
│ Tailcat Box        │                                    │
│                    │   lobby, or one room’s ChatPage    │
│ Chat               │                                    │
│  ┌ ─ ─ ─ ─ ─ ─ ┐   │                                    │
│  : + New room   :   │                                    │
│  └ ─ ─ ─ ─ ─ ─ ┘   │                                    │
│    Alice · tc…9f3a │                                    │
│    tc…12ab         │                                    │
│ Tunnel             │                                    │
│                    │                                    │
│ Settings           │                                    │
└────────────────────┴────────────────────────────────────┘
```

- **Chat / 聊天** is the parent. **Tunnel / 穿透** stays a sibling below the group. **Settings / 设置** stays in the footer.
- Children are always visible. v1 does not collapse them.
- Order under the dashed control: newest room first.
- The selected child uses the same active treatment as today’s selected nav item. While the lobby is open, **+ New room** is the selected child. While a room is open, that room is the selected child.
- The Chat parent is active whenever the main pane is the lobby or a room (`page === chat`), same as today’s Chat destination.
- Opening Tunnel or Settings does not unload listeners and does not forget the last room.

### Labels

Primary label, in order:

1. If the peer remark for this room’s current peer address trims to a non-empty string, that remark is the primary label.
2. Otherwise the short address abbreviation of the room’s own address.

Abbreviation: once `room-ready` has an address, `tc…` plus the last 4 characters of the address (`tc:abcdef1234` displays `tc…1234`). An address of 8 characters or fewer is shown in full. Before the address exists, the label is **Starting…** / **正在开始…**.

Disambiguation: if two or more open rooms would show the same remark, each of those rooms shows `remark · abbrev` (for example `Alice · tc…9f3a`). A single room shows the remark alone. The Settings nickname is not a room label. It stays on outgoing bubbles only.

Secondary text, not the primary label: when the room was started from a saved key, show that key’s name in quieter type under the label (or in the tooltip if the row is too narrow). Ephemeral rooms have no key name. The key name is never sent.

The tooltip is the full local address, and the key name when there is one.

The remark map is read when the sidebar renders. Changing a remark updates that peer’s room label. It is not copied into the room as a wire field. If the current peer has no remark, use the abbreviation. `roomPrimaryLabel` in `frontend/src/lib/roomLabel.ts` is that rule.

### Unread (proposal)

Each room stores an integer unread count.

- Increment by one for each inbound transcript message (`direction === "in"`: text, file, voice) delivered while that room is not the focused room on the Chat page.
- Do not increment for system lines, transfer progress, signals, or the room’s own outbound messages.
- A message that arrives while the room is focused does not increment.
- Focusing the room sets the count to 0.
- The row shows the count. Above 9, show `9+`.
- Hide the badge at 0.
- Switching to Tunnel or Settings means no room is focused, so inbound messages increment unread until the user opens that room again.

Phase A omits the badge. Phase B adds it. Counts are in memory and die on quit.

## 5. Lobby and create flows

The lobby is a small form, not a transcript. It does not start a listener until the user submits one of the actions below. Copy in both locales states that the peer can be left empty.

```
New room / 新房间

[ Create temporary room / 新建临时房间 ]

Permanent key (Phase B)
[ saved key ▾ ]  [ Create / 新建 ]
[ New key name …… ] [ Save key / 保存密钥 ]

Peer address (optional) / 对方地址（可选）
[ tc…........................ ]
[ Connect / 连接 ]
```

Helpers:

- EN: “Leave the peer empty to open a room and share your address later.”
- ZH: “对方地址可以留空，先开房间，稍后再把地址发给对方。”
- EN, under Connect: “Connecting starts a new temporary room.”
- ZH: “连接会新建一个临时房间。”

Typing or pasting into the peer field does not create a room. Only submitting that field does.

### Ephemeral, no peer

**Create temporary room** (Phase A):

1. Check the cap. On failure, stay on the lobby and show the cap error. No listener.
2. `StartChatRoom("")`.
3. Add the child, select it, open `ChatPage`.
4. The room peer stays empty until the user Connects inside the room, or an inbound hello sets the peer (today’s rules).

If the peer field has text when the user presses **Create temporary room**, do not Connect and do not switch the room to a permanent key. Create the ephemeral room and place that text into the room’s peer field, unsent, so the paste is not thrown away. The user Connects from the room if they want to.

### Permanent key (Phase B)

**Create** next to the key picker:

1. A key must be selected. Otherwise stay on the lobby with an inline error. No listener.
2. Check the cap, then check that no open room is already listening with that key. If one is, stay on the lobby with “That key is already listening in another room.” / “这把密钥已在另一个房间监听。” Do not stop the existing room.
3. `StartChatRoom(keyName)` loads the saved material the way `RestartChatRoom` does today (app keys and CLI keys already listed by `ListKeys`).
4. Open that room’s `ChatPage`. The sidebar secondary text is the key name. The address is the key’s stable address, per the FAQ.
5. Do not Connect, even if the peer field has text. Same as the ephemeral button: copy any typed peer into the room’s peer field, unsent.

**Save key** uses the existing `CreateKey` path. Saving a key does not start a room. A create-key error stays on the lobby. After a successful save, that key is selected so the user can press **Create**.

Phase A does not show the permanent controls. It does not show a disabled placeholder.

### Peer submit

**Connect** on the lobby, and Enter in the peer field, are the only actions that auto-create and connect:

1. Trim the field. Empty or not starting with `tc` uses today’s inline error (“Paste a Tailcat address that starts with tc.” / the existing `chatAddrError` string). No room is created.
2. Check the cap. On failure, stay on the lobby. No listener.
3. `StartChatRoom("")` — always ephemeral, even if a permanent key is selected in the Phase B picker.
4. Open that room.
5. `ConnectChatPeer(roomID, addr)` after the room is listening (today’s Connect already requires a local address). On dial failure, keep the room, show today’s unreachable error on that room, and leave the listener up. Do not delete the room to undo a failed Connect.

A failed validation or a cap refusal happens before `StartChatRoom`, so a rejected submit leaves the room list unchanged.

### Inside an open room

`ChatPage` is unchanged in role: local address and Copy, peer field and Connect, transcript, composer, files, voice, live call. Connect inside a room sets that room’s peer only. It does not create another room. Peer change, `they're hear meow`, and “Peer changed” stay as they are today, in that room’s transcript only.

Settings **Restart room** applies to the focused room only. With the lobby open and no focused room, the restart control is disabled and says there is no room to restart. Restart does not restart other rooms. Network region and DERP map URL still apply on the next start or restart of a room, same as today; they do not bounce rooms that are already listening.

## 6. Close room (proposal, Phase B)

Each open room has **Close / 关闭** on its sidebar row (and the same action in the room header).

- Transcript has at least one inbound or outbound message: confirm first. EN: “Close this room? It stops listening and this device’s transcript is discarded. Your peer is not notified.” ZH: “关闭这个房间？将停止监听并丢弃本机记录。对方不会收到通知。” Confirm closes. Cancel leaves the room as it was.
- Empty transcript, or only system lines: close immediately, no dialog.
- Close calls `StopChatRoom(roomID)`: that listener stops, that service is dropped, partial files for that room are swept, the child disappears, the transcript is gone.
- A saved key is not deleted. The user can open that key again later as a new room with an empty transcript. An ephemeral address for the closed room is retired when its listener stops. Other rooms stay up, including other ephemeral rooms.
- If the closed room was focused, focus the newest remaining room. If none remain, show the lobby.
- Phase A has no Close control. Rooms started in Phase A live until quit. The cap error tells the user to quit to free a slot until Phase B.

Diagnostics does not grow a separate stop path. A later Stop button on a chat session card uses this same Close action, including the confirm.

## 7. Soft cap (proposal)

The cap is 8 open rooms (starting, running, or error). Stopped rooms are removed, so they do not count.

The check and the insert are one critical section so two submits cannot both pass as the 8th room.

On refusal, do not call `StartRoom`. The error is inline on the lobby.

Phase A ships the cap before Close exists, so the only way under the cap is to quit. Phase A copy:

- EN: “You can keep 8 rooms open. Quit the app to close rooms.”
- ZH: “最多同时打开 8 个房间。请退出应用以关闭房间。”

Phase B, once Close exists:

- EN: “You can keep 8 rooms open. Close one to start another.”
- ZH: “最多同时打开 8 个房间。请先关闭一个再新建。”

## 8. Data model and persistence

### Manager

| Field | Meaning |
| --- | --- |
| `rooms` | Map of room id → `*chat.Service` |
| `order` | Room ids, newest first, for the sidebar |
| `focus` | Last selected room id, or empty when none |
| `lobby` | True only while the create lobby is the Chat view. **+ New room** sets it when a room already exists. Opening a room, or navigating to Chat while a room exists, clears it. |
| `cap` | 8 |

Each service already stores the session, local address, peer, caps, transcript, transfers, and file jobs. The manager does not merge those.

The manager also stores, beside the service and not inside the envelope codec:

| Field | Meaning |
| --- | --- |
| `keyName` | Empty for ephemeral. The saved key name for a permanent room. Local only. |
| `unread` | Proposal. In-memory count. |

UI state that must survive switching rooms (composer draft, unsent peer-field text, burn toggle) lives in the frontend room slice, keyed by room id, not only inside `ChatPage`. Switching rooms remounts `ChatPage` for the newly focused room. Multi-select selection does not need to survive the switch; it clears when the room loses focus.

### Transcript isolation

An event, send, discard, restart, or stop for room A never appends, deletes, or rewrites room B’s messages. Message ids stay random per service. Discard still addresses one service.

Local multi-select delete applies only to the open room’s transcript.

### Files on disk

Today one chat data directory is swept when the single service sets it, and partials are swept on Stop. With N rooms:

- On process start, sweep the chat data directory (legacy `chat-inbox/` and `chat-partials/`, plus any room subdirectories left by a crash).
- Each new service gets its own subdirectory of that root, named by room id, via `SetDataDir`. Sweeping one room’s directory does not sweep another room.
- Completed inbound files and resume partials stay isolated by that path.
- Next launch sweeps again. Nothing in the room list is reloaded from those files.

### Persistence (v1)

Explicitly in memory for this process only:

- The room list, listeners, transcripts, drafts, unread counts, focus, and lobby flag.

Quit stops every listener and drops all of the above. The next launch is the lobby and zero chat sessions.

What still persists, because it already does:

- Saved keys and DERP settings.
- The Settings nickname. It is the outgoing-bubble label, not a room label, and not a room record.
- Peer remarks in localStorage, keyed by Tailcat address. They survive quit. They are not a room record and are not sent.

Hide window does not quit and does not drop rooms. Showing the window restores the same view, including the lobby if that was what was open. Hide is not a navigation back to the last room.

### Live calls

Go listeners are independent of which pane is mounted. WebRTC still lives in the webview, and only the focused room’s `ChatPage` is mounted.

- Leaving a room (switch room, open the lobby, open Tunnel or Settings) hangs up that room’s live call if the link is up, and sends `rtc-hangup` when today’s rules say a hangup is sent. Text and file receive on that room continue.
- `rtc-offer` / `rtc-answer` / `rtc-hangup` are delivered to the webview only while that room is mounted. A signal that arrives while the room is in the background is ignored, not queued.
- One live call per focused room. Background rooms do not keep hidden peer connections.

## 9. Events

Keep the single Wails event name `tailcat:event`. Chat payloads keep today’s kinds (`room-ready`, `peer`, `message`, `transfer`, `signal`, `discard`, `error`, and diagnostic `data`).

Every chat event already carries `SessionID`. That value is the room id. The UI must apply the event only to the room slice with that id.

Today `App.tsx` handles `room-ready`, `peer`, `message`, `transfer`, `signal`, and `discard` into one set of React states and ignores `SessionID`. That becomes a map update. An event whose `SessionID` is not an open room is ignored.

Delivery while unfocused:

- `message`, `peer`, `transfer`, `discard`, and `room-ready` update that room’s slice immediately, so the transcript is current when the user opens it, and so unread can count inbound messages.
- `signal` follows section 8 (dropped when that room is not mounted).

Forwarding: one goroutine per room reads that service’s `Events()` channel and emits `tailcat:event`, same drop-on-full behavior the service already uses. Stopping a room stops that goroutine and does not stop the others. Toolbox events stay on their existing forwarder. Tray refresh still runs on emit, so the session count tracks rooms coming and going.

`ListSessions` appends each open chat service’s session (the way it appends the one chat session today) and sorts as it does now. Closed rooms are gone from the manager, so they disappear from the list. A room in `error` stays listed until the user closes it or quits.

## 10. Tray and diagnostics

### Tray

`activeSessionCount` already counts every non-stopped session from `ListSessions`. After the manager lists N chat sessions, N listening rooms count as N active sessions, plus tunnels and pings. No new tray API.

The menu stays Open, Hide, Chat, Tunnel, Settings, Quit, plus the session-count label. No per-room items. **Chat** navigates with the rule in section 3. Quit still quits the process and therefore every room. Hide still leaves listeners running.

### Diagnostics

Settings → Diagnostics already filters `Kind === "chat"` and maps session cards. It will show one card per open chat room instead of one. Heading copy becomes plural: **Chat sessions / 聊天会话**. Each card keeps today’s fields: kind, status, local address, copy. The card does not become a second transcript.

The ping address defaults to the focused room’s peer when the ping field is not dirty, replacing today’s single global peer. On the lobby, or when the focused room has no peer, leave the field unchanged rather than inventing an address. Ping itself stays a toolbox session, not a chat room.

## 11. Settings nickname and peer remarks

The Settings nickname is the user’s label for themselves on this device. It replaces You on outgoing bubbles. It is not a per-peer name, it is not the sidebar label, and it is not received from the network.

Peer remarks are a separate local map from Tailcat address to a display name. The chat room edits the remark for the current peer, or for a pasted `tc…` address before connect. Incoming bubbles use the remark for that peer’s address. The sidebar primary label uses the same remark for the room’s current peer, otherwise the address abbreviation (section 4).

Do not write the nickname or a remark into `StartOpts`, hello, message JSON, or `session.Address`. Do not add a second remark editor in the multi-room work; each room’s `ChatPage` already edits the shared map. Do not fall back to the Settings nickname when a room has no remark.

## 12. FAQ updates required when shipping

Not part of the design-only review. When the feature ships, update `docs/faq.md`, `docs/faq.zh-CN.md`, and the FAQ blurbs in `README.md` and `README.zh-CN.md`.

Keep the current answers, and add multi-room around them:

- You can open several rooms. Each room has its own address, its own listener, its own current peer, and its own transcript. Messages do not cross rooms.
- Inside one room, the existing “several people, one address” answer stays word for word in meaning: not a group chat, one current peer, latest hello wins, replies go only to that peer, incoming bubbles do not name which address sent them.
- Ephemeral versus saved genkey stays. Add: closing one room retires that room’s ephemeral address only; other rooms keep listening; quit retires every ephemeral room; a saved key can be started again as a new empty room; deleting the key still destroys that address.
- The nickname, when present, is local and is not sent to the peer. A peer remark is also local, is not sent, and is not the nickname: the remark names the other person on this screen only.

## 13. Milestones

### Phase A — Lobby, sidebar, concurrent start

- Room manager, N services, real-adapter set of rooms (no close-on-next-start).
- No launch-time `StartChatRoom`.
- Lobby when there are zero rooms, and when **+ New room** is used.
- Last selected room when rooms already exist.
- Ephemeral create with no peer. Peer-field submit creates an ephemeral room and Connects.
- Sidebar children, labels (peer remark or abbreviation, never the Settings nickname), selection.
- Event routing by room id. Transcripts isolated. Both listeners receive.
- Cap of 8.
- Diagnostics lists every chat session. Tray count includes them.
- No unread badge, no Close control, no permanent-key picker.

### Phase B — Polish

- Unread badges (section 4).
- Close with confirm when the transcript is non-empty (section 6). Cap error then tells the user to close a room.
- Permanent key picker on the lobby: pick or create a saved key, start that room, refuse a key that is already listening.

## 14. Acceptance criteria

### Phase A

- [ ] Cold launch shows the lobby and starts no chat listener.
- [ ] **Create temporary room** with the peer field empty adds a sidebar child, opens `ChatPage`, and listens. The peer stays empty until Connect or an inbound hello.
- [ ] **Create temporary room** while the peer field has text does not call Connect. The text is waiting in that room’s peer field.
- [ ] Submitting a valid peer address from the lobby creates an ephemeral room, Connects, and does not require a saved key.
- [ ] Submitting an empty or non-`tc` peer address creates no room.
- [ ] With two rooms open, both listeners stay up. A message for room A is not in room B’s transcript. The on-screen room is the one last created or last clicked.
- [ ] Clicking **Chat**, or returning from Settings or Tunnel, shows the last selected room, not the lobby, when at least one room exists.
- [ ] **+ New room** shows the lobby and does not stop existing rooms.
- [ ] With zero rooms, **+ New room** and the Chat parent both show the lobby.
- [ ] Sidebar label is the peer remark for that room’s current peer address when set, otherwise the short address. It is not the Settings nickname. Two rooms that share a remark show `remark · abbrev`.
- [ ] The nickname and any peer remark do not appear in hello or in any chat envelope.
- [ ] The 9th room is refused with the cap error and does not start a listener.
- [ ] Diagnostics shows one chat session card per open room. The tray session count includes each non-stopped chat room.
- [ ] Quit drops every room. The next launch is an empty lobby.
- [ ] Hiding the window keeps the rooms. Showing it returns to the last room or the lobby, whichever was open.
- [ ] English and 简体中文 strings exist for the new chrome.
- [ ] `TAILCAT_ADAPTER=fake` covers two concurrent rooms with no network.

### Phase B

- [ ] An inbound message while a room is not focused increments that room’s badge. Focusing the room clears it. The focused room’s own inbound messages do not increment.
- [ ] Close on an empty room removes it without a dialog and leaves other rooms listening.
- [ ] Close on a room with an inbound or outbound message asks first, then stops the listener and discards only that transcript. Cancel changes nothing.
- [ ] Closing the last room shows the lobby and leaves no chat listener.
- [ ] Permanent create with no peer starts a room on the chosen saved key and does not Connect.
- [ ] Creating a key from the lobby saves it and does not by itself start a room.
- [ ] Starting a second room with a key that is already listening fails with the key-in-use error and leaves the first room up.
- [ ] Peer submit still creates an ephemeral room even when a permanent key is selected.

## 15. Testing strategy

### Go

- Manager: two `Start` calls yield two sessions and two addresses. Stopping one leaves the other running and listed.
- Fake adapter, in default `go test`: two `StartRoom` calls stay in the room map together, and closing one leaves the other. Do not add a default-CI test that dials DERP. A second real listener is covered by the manual check and, if someone extends it, the existing integration-tagged adapter test.
- Cap: the 9th start returns the cap error and the session count stays 8.
- Same saved key twice: second start errors, first session still running.
- Envelope for room A is not stored on service B. Existing one-room service tests stay valid against a single service.

### Frontend

- Launch renders the lobby and does not call `StartChatRoom`.
- Create with an empty peer renders one room and no Connect call.
- Lobby Connect to a fake peer creates one room and connects.
- Two room slices: an event with room B’s `SessionID` does not change room A’s transcript while A is on screen, and it is present when B is opened.
- With rooms present, setting the page to Chat does not show the lobby.
- `npm run build` passes. `go test ./...` passes.

### Manual

- Two Boxes, two rooms on one of them: both peers can deliver text while the user is looking at the other room.
- One room, two remote peers: FAQ behavior unchanged (latest hello wins, one reply path).
- Quit and relaunch: lobby, previous ephemeral addresses dead, saved key usable again as a new empty room (Phase B).

## 16. Open questions

None. Section 1 separates locks from proposals. The proposals (unread, close confirm, cap of 8) are the defaults to implement in the milestone that names them.
