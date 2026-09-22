# Tailcat Box (猫砂盆) — Local transcript multi-select delete

**Date:** 2026-09-22  
**Status:** Ready for review. Design only. This document does not implement the feature.  
**Product name:** Tailcat Box (English UI) / 猫砂盆 (简体中文 UI)  
**Extends:** burn-after-read sender UX in [2026-09-22-tailcat-box-chat-design.md](2026-09-22-tailcat-box-chat-design.md) §3 (Burn-after-read UX).  
**Scope:** local transcript cleanup only. No peer recall / unsend.

## 中文摘要

去掉发件人阅后即焚气泡上的独立「删除」按钮，改成常见 IM 的本机会话多选删除：在聊天记录上拖出矩形进入多选，点气泡切换选中，顶栏显示选中数量并提供删除与关闭。删除前确认，文案明确「只删本机记录、对方不受影响」。系统提示行不出现选中态、不可点选；仅在确认删除时，作为副作用清掉最早与最晚选中气泡之间（含两端）的系统行。继续走现有 `DiscardChatMessage` / `onDiscard`，不新增协议。

## 1. Problem / goals / non-goals

### Problem

Outbound burn bubbles expose a standalone **Delete** control on `BurnBadge`. That control is easy to miss for ordinary cleanup, and it implies message-specific delete UX rather than the usual IM pattern of selecting several local rows and removing them from this device’s transcript. Users need a conventional way to clear local history without implying that the peer’s copy changes.

### Goals

- Remove the standalone burn-bubble **Delete** button.
- Add Approach A local-transcript multi-select delete: drag a rectangle on the chat log to enter selection mode, then click bubbles to toggle.
- Show a Telegram-style **top action bar** when the selection count is ≥ 1.
- Confirm before delete with copy that states this is **local transcript only** and does not affect the peer.
- Reuse the existing local discard path (`DiscardChatMessage` / `onDiscard`). No new wire protocol; no unsend to the peer.
- Keep the composer usable during multi-select.

### Locked decisions

| Topic | Decision |
| --- | --- |
| Burn Delete button | Remove the standalone **Delete** on outbound burn bubbles (`BurnBadge` delete). Keep burn status copy (`chatBurnRemoved` / `chatBurnKept`) when useful. |
| Selection entry | Approach A: drag a rectangle on the chat log to enter multi-select. |
| Top bar | When selection count ≥ 1, show a bar at the top of the chat area with selected count, **Delete**, and **Close** / ×. |
| Toggle | After drag enters multi-select, click bubbles to toggle selection. |
| Confirm | Confirm dialog before delete. EN example: “Delete N local messages? Your peer is not affected.” ZH: 「删除 N 条本机记录？对方不受影响。」 |
| System lines | `direction === "system"` never shows selection UI (no highlight / checkbox). Not click-toggle selectable. Purged only as a side-effect of bulk delete: when the user confirms delete of selected bubbles, also discard system lines that fall between the earliest and latest selected message inclusive in list order (or equivalent index range). No hover-× on system lines. |
| API | Delete uses existing local `DiscardChatMessage` / `onDiscard`. Batch may be N sequential calls unless a batch helper already exists. No new wire protocol; no peer recall. |
| Exit multi-select | Close on the top bar, Esc, or selection count becomes 0. |
| Composer | Stays usable during multi-select. Sending a new message does **not** exit multi-select. New messages start unselected. |
| Drag start | Do not start a drag-select when pointer-down is on interactive controls (links, buttons, voice controls, etc.). |
| Discard failure | Keep multi-select and surface an error in the chat UI. |

### Non-goals

- Peer recall / unsend / remote delete of the other party’s transcript.
- Liquid Glass or other visual-system redesign beyond the minimal top bar and selection chrome needed for this feature.
- Hover-× (or any per-row delete affordance) on system lines.
- Making system lines selectable, highlightable, or click-toggle targets.
- New Go / Wails bindings or TCH1 envelope changes for discard.
- Persistent history across restarts (transcript remains in-memory for this process, per the chat redesign spec).
- Forward, share, pin, star, or other multi-select actions beyond local delete.
- Select-all / range-shift-click unless needed later; this milestone is drag-rect entry + click toggle.
- Changing burn viewer / Reveal / Preview / Play discard behavior for received burned items.

## 2. Interaction model

### Enter multi-select (drag rectangle)

1. Pointer-down on the transcript background or on a non-interactive part of a bubble row starts a potential drag-select, unless the hit target is an interactive control (link, button, voice play control, file action, composer control, etc.).
2. After the pointer moves past a small movement threshold, show a translucent selection rectangle.
3. Any non-system message whose bubble intersects the rectangle becomes selected.
4. On pointer-up: if at least one selectable bubble was hit, enter (or stay in) multi-select with those ids selected and show the top bar. If the rectangle hit none, do not enter multi-select (selection count would be 0, which exits). A gesture that never crosses the movement threshold is a normal click and does not enter multi-select.

### Toggle selection

- Once in multi-select mode, a click on a selectable bubble toggles that message’s selected state.
- System lines ignore toggle clicks for selection (they never enter the selected set).
- Clicks on interactive controls inside a bubble perform the control’s action and do not toggle selection.

### Top action bar

When `selectedCount >= 1`, render a bar at the **top of the chat / transcript area** (Telegram-style), not floating over the composer:

- Selected count (localized).
- **Delete** — opens the confirm dialog.
- **Close** / × — exits multi-select and clears the selection.

### Confirm delete

Delete always opens a confirm dialog first. Copy must make clear this is local-only:

| Locale | Copy |
| --- | --- |
| EN | `Delete N local messages? Your peer is not affected.` |
| ZH | `删除 N 条本机记录？对方不受影响。` |

`N` is the number of **explicitly selected** bubbles (system lines in the purge range are not counted in `N`). Confirm runs discard; Cancel dismisses the dialog and leaves multi-select and the selection unchanged.

### Exit multi-select

Exit (clear selection, hide top bar, leave multi-select mode) when any of:

- User activates Close / × on the top bar.
- User presses Esc (when multi-select is active and no confirm dialog is open; Esc on the dialog cancels the dialog only).
- Selection count becomes 0 (e.g. last selected bubble toggled off).

Sending a new message does **not** exit multi-select. New messages appear unselected.

## 3. Selection rules

### Selectable

- Messages with `direction === "out"` or `direction === "in"` (text, file, voice, burn collapsed/expanded bubbles, etc.) participate in selection UI: rectangle hit-test, click toggle, highlight / checkbox-style selected chrome as implemented.

### Never selectable (system)

- Messages with `direction === "system"`:
  - Never show selected highlight, checkbox, or other selection chrome.
  - Are not click-toggle selectable.
  - Are not added to the selected id set by drag intersection.
  - Have no hover-× or per-row delete control.

### System purge range (side-effect only)

When the user confirms delete of the current selection:

1. Let `S` be the selected message ids (non-system only).
2. In transcript list order, find the minimum and maximum indices among messages in `S`.
3. The purge set is every message whose index is in `[minIndex, maxIndex]` inclusive that is either in `S` **or** has `direction === "system"`.
4. Discard every id in the purge set via the existing discard path.
5. System lines outside that index range are left alone.
6. Non-system messages in the range that were **not** selected are left alone.

Example (list order top → bottom):

```
system A
peer text B     ← selected
system C
you text D      ← selected
system E
peer text F
```

Confirm delete with B and D selected: discard B, D, and system C (between earliest and latest selected inclusive). System A and E stay. F stays.

## 4. UI placement

```
┌──────────┬──────────────────────────────────────────┐
│ Chat     │  Listening · tc…                  [Copy] │
│ Settings │  Peer …                        [Connect] │
│          │  ┌ selection bar (when count ≥ 1) ─────┐ │
│          │  │  N selected    [Delete]        [×]  │ │
│          │  └─────────────────────────────────────┘ │
│          │  transcript (drag rect / toggles)        │
│          │  composer (still usable)           [Send]│
└──────────┴──────────────────────────────────────────┘
```

- Top bar sits above the scrollable transcript inside the chat main column.
- Selection chrome on bubbles should be readable in light and dark theme; do not invent a new glass language.
- `BurnBadge` keeps status text only (`chatBurnRemoved` / `chatBurnKept`). No Delete button on the badge.

## 5. Data / API

- Continue to call the existing UI prop `onDiscard(id)` which maps to `discardChatMessage` in `App.tsx` → Wails `DiscardChatMessage(id)`.
- Confirmed bulk delete may issue **N sequential** `onDiscard` calls (one per purge-set id). Do not add a new binding unless a batch helper already exists in the Go/Wails surface (today it does not — use N calls).
- Order: discard in list order (or any stable order). If one call fails mid-batch:
  - Stop or continue remaining ids per implementer preference, but **keep multi-select active**.
  - Surface an error in the chat UI (status / inline error region already used for chat errors).
  - Do not claim success for ids that did not discard.
  - Prefer leaving successfully discarded ids removed from the transcript and from the selection; keep failed ids selected.
- No protocol change: discard remains local transcript + local inbox/partial cleanup as already defined for burn/file discard.
- Received burn Reveal / Preview / Play still discard through the same path; this feature does not replace that flow.

## 6. i18n

### Add

| Key | EN | ZH |
| --- | --- | --- |
| `chatSelectCount` | `{n} selected` | `已选择 {n} 条` |
| `chatSelectDelete` | `Delete` | `删除` |
| `chatSelectClose` | `Close` | `关闭` |
| `chatSelectDeleteConfirm` | `Delete {n} local messages? Your peer is not affected.` | `删除 {n} 条本机记录？对方不受影响。` |
| `chatSelectDeleteError` | `Could not delete some local messages.` | `部分本机记录删除失败。` |

Exact interpolation style should match existing i18n helpers in the frontend (placeholder form may be `{n}` or a small formatter — follow `en.ts` / `zh-CN.ts` conventions when implementing).

Reuse existing generic `delete` / dialog confirm-cancel keys for dialog buttons if they already exist and fit; otherwise add `chatSelectConfirm` / `chatSelectCancel` only if needed.

### Retire / stop using on burn badge

- `chatDelete` is currently used by `BurnBadge`’s Delete button. After this change, that button is gone. Retire `chatDelete` if nothing else references it; otherwise leave the key unused until a cleanup pass. Do not keep a burn-only Delete label on the badge.

### Keep

- `chatBurnRemoved`, `chatBurnKept`, and other burn composer / collapsed strings.

## 7. Acceptance tests

Manual / automated coverage should verify:

- [ ] Outbound burn bubbles show burn status copy and **do not** show a standalone Delete button on `BurnBadge`.
- [ ] Dragging a rectangle over the transcript that intersects one or more non-system bubbles enters multi-select and selects those bubbles.
- [ ] Dragging that starts on a link, button, or voice control does **not** begin drag-select.
- [ ] In multi-select, clicking a non-system bubble toggles its selection.
- [ ] System lines never show selection chrome and cannot be toggled into the selection set.
- [ ] When selected count ≥ 1, a top bar shows the count, Delete, and Close/×.
- [ ] Close/× exits multi-select and clears selection.
- [ ] Esc exits multi-select when no confirm dialog is open.
- [ ] Toggling the last selected bubble off (count → 0) exits multi-select / hides the bar.
- [ ] Delete opens a confirm dialog whose EN/ZH copy states local-only deletion and that the peer is unaffected.
- [ ] Confirm discards selected bubbles via `onDiscard` / `DiscardChatMessage`.
- [ ] Confirm also discards system lines that fall between the earliest and latest selected messages inclusive in list order; system lines outside that range remain.
- [ ] Non-selected non-system messages inside the index range are **not** discarded.
- [ ] Cancel on the dialog leaves selection and multi-select unchanged.
- [ ] Composer remains usable; sending a message does not exit multi-select; the new message is unselected.
- [ ] A failed `onDiscard` keeps multi-select active and shows a chat UI error.
- [ ] No new Wails/protocol method is introduced for this feature.
- [ ] English and 简体中文 strings exist for the new chrome; burn status strings still resolve.

## 8. Implementation notes

Primary touch points (for a later implementation plan — not this document’s PR):

| Area | Location |
| --- | --- |
| Transcript UI, selection state, drag rect, top bar, confirm | `frontend/src/pages/ChatPage.tsx` |
| Remove `BurnBadge` Delete button; keep badge copy | `BurnBadge` in `ChatPage.tsx` |
| Discard wiring (pass-through) | `frontend/src/App.tsx` (`onDiscard={discardChatMessage}`) |
| Wails / fake discard helper | `frontend/src/lib/wails.ts` → `DiscardChatMessage` |
| Go binding (unchanged contract) | `app.go` `DiscardChatMessage` |
| Strings | `frontend/src/i18n/en.ts`, `frontend/src/i18n/zh-CN.ts` |
| Existing burn discard tests to extend | `frontend/src/App.phase2.test.tsx`, related ChatPage tests |

Suggested state shape (illustrative):

- `multiSelectActive: boolean`
- `selectedIds: Set<string>` (non-system ids only)
- Derive `selectedCount` from `selectedIds.size`
- On confirm, compute purge ids from transcript order + system range rule, then await discards

CSS: prefer extending existing chat layout classes rather than a one-off design system. Keep the top bar inside the chat column so Settings / sidebar layout is untouched.

## 9. Testing strategy

- Unit / component: selection toggle, system exclusion, purge-range helper given a fixed message list, Esc / count-0 exit.
- Frontend tests: mock `onDiscard`; assert N calls for selected + in-range system ids; assert burn badge has no Delete; assert failure path keeps selection and surfaces error.
- `npm run build` and existing `go test ./...` remain green; no Go behavior change expected.
- Manual: drag across mixed system/peer/you rows; confirm dialog copy in both locales; send while selecting.

## 10. Open questions

None for the locked decisions in §1. Deferred non-goals (peer recall, select-all, shift-range) stay out of this milestone on purpose.
