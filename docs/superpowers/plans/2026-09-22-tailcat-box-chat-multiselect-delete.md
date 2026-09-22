# Chat multi-select local delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the outbound burn-bubble standalone Delete control with Approach A local-transcript multi-select delete (drag rectangle, click toggle, Telegram-style top bar, confirm) that reuses existing `onDiscard` / `DiscardChatMessage`.

**Architecture:** Keep discard on the existing Wails path (`ChatPage` → `App.tsx` `discardChatMessage` → `frontend/src/lib/wails.ts` → Go `DiscardChatMessage`). Add a pure helper `purgeDiscardIds` that expands selected bubble ids with in-range system lines. `ChatPage` owns multi-select state, drag-rect hit testing, top bar, confirm dialog, and sequential discard orchestration. No new Go bindings, no TCH1 changes, no peer recall.

**Tech Stack:** React/TS ChatPage, existing DiscardChatMessage, en/zh-CN i18n, Vitest/existing frontend tests, Wails Go bindings unchanged

## Global Constraints

- Burn Delete button: Remove the standalone **Delete** on outbound burn bubbles (`BurnBadge` delete). Keep burn status copy (`chatBurnRemoved` / `chatBurnKept`) when useful.
- Selection entry: Approach A: drag a rectangle on the chat log to enter multi-select.
- Top bar: When selection count ≥ 1, show a bar at the top of the chat area with selected count, **Delete**, and **Close** / ×.
- Toggle: After drag enters multi-select, click bubbles to toggle selection.
- Confirm: Confirm dialog before delete. EN: “Delete N local messages? Your peer is not affected.” ZH: 「删除 N 条本机记录？对方不受影响。」
- System lines: `direction === "system"` never shows selection UI (no highlight / checkbox). Not click-toggle selectable. Purged only as a side-effect of bulk delete: when the user confirms delete of selected bubbles, also discard system lines that fall between the earliest and latest selected message inclusive in list order. No hover-× on system lines.
- API: Delete uses existing local `DiscardChatMessage` / `onDiscard`. Batch is N sequential calls. No new wire protocol; no peer recall.
- Exit multi-select: Close on the top bar, Esc, or selection count becomes 0.
- Composer: Stays usable during multi-select. Sending a new message does **not** exit multi-select. New messages start unselected.
- Drag start: Do not start a drag-select when pointer-down is on interactive controls (links, buttons, voice controls, etc.).
- Discard failure: Keep multi-select and surface an error in the chat UI.
- No new Wails/protocol method. English and 简体中文 cover every new string. Do not change burn Reveal / Preview / Play discard behavior for received burned items.
- Spec source of truth: `docs/superpowers/specs/2026-09-22-tailcat-box-chat-multiselect-delete-design.md`.

## 中文摘要

去掉 `BurnBadge` 上的独立删除按钮，在聊天记录上拖矩形进入多选，点气泡切换选中，顶栏显示数量并提供删除与关闭。删除前确认「只删本机、对方不受影响」。系统行不可选；确认删除时顺带清掉最早与最晚选中气泡之间的系统行。继续走现有 `onDiscard`，失败时保持多选并显示错误。发送新消息不退出多选。

## 范围之外

- Peer recall / unsend / remote delete.
- Select-all / shift-range-click.
- New Go / Wails discard batch binding.
- Liquid Glass redesign beyond minimal top bar + selection chrome.
- Hover-× on system lines.
- Changing inbound burn Reveal / Preview / Play discard.

## 文件地图

| Path | Responsibility |
| --- | --- |
| `frontend/src/lib/chatPurge.ts` | Pure `purgeDiscardIds(messages, selectedIds)` — selected bubbles + in-range system lines → discard id list in transcript order. |
| `frontend/src/lib/chatPurge.test.ts` | Unit tests for empty selection, single bubble, range with systems, non-selected peers left alone, unknown ids. |
| `frontend/src/i18n/en.ts` | Add `chatSelectCount`, `chatSelectDelete`, `chatSelectClose`, `chatSelectDeleteConfirm`, `chatSelectDeleteError`. Leave `chatDelete` in the catalog until a later cleanup (unused after BurnBadge change). |
| `frontend/src/i18n/zh-CN.ts` | Matching ZH strings. `MessageKey` stays `keyof typeof en`. |
| `frontend/src/pages/ChatPage.tsx` | Multi-select state, drag rect, click toggle, top bar, confirm dialog, sequential `onDiscard`, remove `BurnBadge` Delete / `onDelete`. |
| `frontend/src/styles/glass.css` | Top bar, selection chrome, drag rectangle — extend existing chat classes. |
| `frontend/src/App.multiselect.test.tsx` | Component tests for bar, Esc/close/count-0, toggle, system exclusion, confirm discard calls, failure path, BurnBadge without Delete, send-while-selecting. |
| `frontend/src/App.tsx` | **No change** — already passes `onDiscard={discardChatMessage}`. |
| `app.go` / Wails bindings | **Unchanged.** |

Interpolation: `t` has no params today. Use `t(key).replaceAll("{n}", String(n))` at call sites (catalog strings store `{n}`).

---

### Task 1: Pure purge-range helper

**Files:**
- Create: `frontend/src/lib/chatPurge.ts`
- Test: `frontend/src/lib/chatPurge.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:

```ts
export type PurgeMessage = {
  id: string;
  direction: "in" | "out" | "system";
};

/** Selected bubble ids plus system lines in [minSelectedIndex, maxSelectedIndex]. List order. */
export function purgeDiscardIds(
  messages: readonly PurgeMessage[],
  selectedIds: ReadonlySet<string> | Iterable<string>,
): string[]
```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/chatPurge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { purgeDiscardIds, type PurgeMessage } from "./chatPurge";

const msgs: PurgeMessage[] = [
  { id: "sys-a", direction: "system" },
  { id: "b", direction: "in" },
  { id: "sys-c", direction: "system" },
  { id: "d", direction: "out" },
  { id: "sys-e", direction: "system" },
  { id: "f", direction: "in" },
];

describe("purgeDiscardIds", () => {
  it("returns empty when nothing is selected", () => {
    expect(purgeDiscardIds(msgs, new Set())).toEqual([]);
  });

  it("discards one bubble and no systems when alone in range", () => {
    expect(purgeDiscardIds(msgs, new Set(["f"]))).toEqual(["f"]);
  });

  it("includes in-range system lines between earliest and latest selected", () => {
    expect(purgeDiscardIds(msgs, new Set(["b", "d"]))).toEqual(["b", "sys-c", "d"]);
  });

  it("leaves non-selected non-system messages inside the index range", () => {
    expect(purgeDiscardIds(msgs, new Set(["b", "f"]))).toEqual(["b", "sys-c", "sys-e", "f"]);
  });

  it("ignores selected ids that are not in the list", () => {
    expect(purgeDiscardIds(msgs, new Set(["missing"]))).toEqual([]);
  });

  it("does not treat a system id in selectedIds as a selectable anchor", () => {
    // Spec: selected set is non-system only. If a system id sneaks in, ignore it for anchors.
    expect(purgeDiscardIds(msgs, new Set(["sys-c"]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/chatPurge.test.ts`

Expected: FAIL with `Cannot find module './chatPurge'` or similar.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/chatPurge.ts`:

```ts
export type PurgeMessage = {
  id: string;
  direction: "in" | "out" | "system";
};

export function purgeDiscardIds(
  messages: readonly PurgeMessage[],
  selectedIds: ReadonlySet<string> | Iterable<string>,
): string[] {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  let min = -1;
  let max = -1;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.direction === "system") {
      continue;
    }
    if (!selected.has(msg.id)) {
      continue;
    }
    if (min < 0 || i < min) {
      min = i;
    }
    if (i > max) {
      max = i;
    }
  }
  if (min < 0) {
    return [];
  }
  const out: string[] = [];
  for (let i = min; i <= max; i++) {
    const msg = messages[i]!;
    if (selected.has(msg.id) || msg.direction === "system") {
      out.push(msg.id);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/chatPurge.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/chatPurge.ts frontend/src/lib/chatPurge.test.ts
git commit -m "feat(chat): add purgeDiscardIds helper for multi-select delete"
```

---

### Task 2: i18n keys for multi-select chrome

**Files:**
- Modify: `frontend/src/i18n/en.ts` (insert after `chatDelete`)
- Modify: `frontend/src/i18n/zh-CN.ts` (same keys)
- Test: `frontend/src/lib/chatText.test.ts` (extend with catalog asserts)

**Interfaces:**
- Consumes: existing `MessageKey` / `translate` / `t`
- Produces: keys `chatSelectCount`, `chatSelectDelete`, `chatSelectClose`, `chatSelectDeleteConfirm`, `chatSelectDeleteError`. Dialog buttons reuse existing `cancel` and `chatSelectDelete` (confirm action). Do not remove `chatDelete` yet (still referenced until Task 7).

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/chatText.test.ts`:

```ts
import { translate } from "../i18n/locale";

describe("multi-select delete strings", () => {
  it("resolves EN and ZH select chrome with {n} placeholders", () => {
    expect(translate("en", "chatSelectCount")).toBe("{n} selected");
    expect(translate("en", "chatSelectDelete")).toBe("Delete");
    expect(translate("en", "chatSelectClose")).toBe("Close");
    expect(translate("en", "chatSelectDeleteConfirm")).toBe(
      "Delete {n} local messages? Your peer is not affected.",
    );
    expect(translate("en", "chatSelectDeleteError")).toBe("Could not delete some local messages.");

    expect(translate("zh-CN", "chatSelectCount")).toBe("已选择 {n} 条");
    expect(translate("zh-CN", "chatSelectDelete")).toBe("删除");
    expect(translate("zh-CN", "chatSelectClose")).toBe("关闭");
    expect(translate("zh-CN", "chatSelectDeleteConfirm")).toBe("删除 {n} 条本机记录？对方不受影响。");
    expect(translate("zh-CN", "chatSelectDeleteError")).toBe("部分本机记录删除失败。");
  });

  it("keeps burn status strings", () => {
    expect(translate("en", "chatBurnRemoved")).toBe("Removed on their side after they open it.");
    expect(translate("en", "chatBurnKept")).toBe("They may keep a copy.");
    expect(translate("zh-CN", "chatBurnRemoved")).toBe("对方打开后，他们那边会删掉。");
    expect(translate("zh-CN", "chatBurnKept")).toBe("对方可能会留下一份。");
  });
});
```

(If the file already imports `translate`, reuse that import; do not duplicate.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/chatText.test.ts`

Expected: FAIL — TypeScript / catalog missing `chatSelectCount` (or `translate` argument not assignable to `MessageKey`).

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/i18n/en.ts`, immediately after `chatDelete: "Delete",` add:

```ts
  chatSelectCount: "{n} selected",
  chatSelectDelete: "Delete",
  chatSelectClose: "Close",
  chatSelectDeleteConfirm: "Delete {n} local messages? Your peer is not affected.",
  chatSelectDeleteError: "Could not delete some local messages.",
```

In `frontend/src/i18n/zh-CN.ts`, immediately after `chatDelete: "删除",` add:

```ts
  chatSelectCount: "已选择 {n} 条",
  chatSelectDelete: "删除",
  chatSelectClose: "关闭",
  chatSelectDeleteConfirm: "删除 {n} 条本机记录？对方不受影响。",
  chatSelectDeleteError: "部分本机记录删除失败。",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/chatText.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/en.ts frontend/src/i18n/zh-CN.ts frontend/src/lib/chatText.test.ts
git commit -m "feat(i18n): add multi-select local delete strings"
```

---

### Task 3: Multi-select state, top bar, Esc / Close / count-0 exit

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`
- Modify: `frontend/src/styles/glass.css`
- Test: `frontend/src/App.multiselect.test.tsx` (create)

**Interfaces:**
- Consumes: Task 2 keys; existing `ChatMessage`, `Props`, `useI18n`
- Produces: ChatPage state `multiSelectActive: boolean`, `selectedIds: Set<string>`; helpers `exitMultiSelect()`, `fillN(template, n)`; top bar when `selectedIds.size >= 1`; Esc listener when multi-select active and confirm dialog closed

Helper shared in ChatPage (or next to purge):

```ts
function fillN(template: string, n: number): string {
  return template.replaceAll("{n}", String(n));
}
```

- [ ] **Step 1: Write the failing test**

Create `frontend/src/App.multiselect.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import ChatPage, { type ChatMessage } from "./pages/ChatPage";
import { LocaleProvider } from "./i18n";

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
});

const base: ChatMessage[] = [
  { id: "sys-a", direction: "system", type: "system", code: "hear-meow", body: "they're hear meow", at: "2026-09-22T00:00:00.000Z" },
  { id: "b", direction: "in", type: "text", body: "peer hi", at: "2026-09-22T00:00:01.000Z" },
  { id: "sys-c", direction: "system", type: "system", code: "peer-changed", body: "Peer changed", at: "2026-09-22T00:00:02.000Z" },
  { id: "d", direction: "out", type: "text", body: "you hi", at: "2026-09-22T00:00:03.000Z" },
];

function renderChat(overrides: Partial<ComponentProps<typeof ChatPage>> = {}) {
  const onDiscard = vi.fn().mockResolvedValue(undefined);
  const onSend = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <LocaleProvider>
      <ChatPage
        address="tc:room"
        peer="tc:peer"
        messages={base}
        roomError=""
        onConnect={vi.fn()}
        onSend={onSend}
        onDiscard={onDiscard}
        onRetry={vi.fn()}
        {...overrides}
      />
    </LocaleProvider>,
  );
  return { ...utils, onDiscard, onSend };
}

describe("multi-select top bar and exit", () => {
  it("shows the top bar after a test select seed and closes on Close", async () => {
    const user = userEvent.setup();
    renderChat();
    fireEvent(
      window,
      new CustomEvent("tailcat-test-select", { detail: { ids: ["b", "d"] } }),
    );
    expect(await screen.findByText("2 selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("exits multi-select on Escape when no confirm dialog is open", async () => {
    renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b"] } }));
    expect(await screen.findByText("1 selected")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("1 selected")).toBeNull();
  });
});
```

Keep the CustomEvent `tailcat-test-select` seed for hermetic bar/Esc tests in this task. Task 4 adds real drag tests and keeps the same seed for convenience.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx`

Expected: FAIL — no “2 selected” / missing listener.

- [ ] **Step 3: Write minimal implementation**

In `ChatPage.tsx`:

1. Import nothing new except keep React types. Add state near other `useState` calls:

```tsx
  const [multiSelectActive, setMultiSelectActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
```

2. Add helpers inside the component:

```tsx
  function fillN(template: string, n: number): string {
    return template.replaceAll("{n}", String(n));
  }

  function exitMultiSelect(): void {
    setMultiSelectActive(false);
    setSelectedIds(new Set());
    setConfirmOpen(false);
  }

  function applySelection(next: Set<string>): void {
    if (next.size === 0) {
      exitMultiSelect();
      return;
    }
    setMultiSelectActive(true);
    setSelectedIds(next);
  }
```

3. Test-only seed + Esc (place with other `useEffect`s):

```tsx
  useEffect(() => {
    if (!import.meta.env.MODE || import.meta.env.MODE !== "test") {
      return;
    }
    function onSeed(ev: Event): void {
      const detail = (ev as CustomEvent<{ ids: string[] }>).detail;
      applySelection(new Set(detail?.ids ?? []));
    }
    window.addEventListener("tailcat-test-select", onSeed);
    return () => window.removeEventListener("tailcat-test-select", onSeed);
  }, []);

  useEffect(() => {
    if (!multiSelectActive || confirmOpen) {
      return;
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === "Escape") {
        exitMultiSelect();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiSelectActive, confirmOpen]);
```

Note: `applySelection` / `exitMultiSelect` in effects will trigger exhaustive-deps warnings if the project lint is strict. Inline the setState bodies inside the effects instead of closing over helpers if needed — keep behavior identical.

4. Render the top bar **above** `.chat-log`, inside `.chat-stage` (or wrapping the transcript column). Structure:

```tsx
      <div className="chat-stage">
        <div className="chat-transcript-column">
          {selectedIds.size >= 1 ? (
            <div className="chat-select-bar" role="toolbar" aria-label={fillN(t("chatSelectCount"), selectedIds.size)}>
              <span>{fillN(t("chatSelectCount"), selectedIds.size)}</span>
              <button className="btn" type="button" onClick={() => setConfirmOpen(true)}>
                {t("chatSelectDelete")}
              </button>
              <button className="btn" type="button" onClick={() => exitMultiSelect()}>
                {t("chatSelectClose")}
              </button>
            </div>
          ) : null}
          <div className="chat-log">
            {/* existing messages map unchanged in this task */}
```

Close the extra wrapper `</div>` before the media dock / stage end so layout stays: column = bar + log, dock beside.

5. In `glass.css` append:

```css
.chat-transcript-column {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.chat-select-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  margin: 8px 0 0;
}
.chat-select-bar span {
  flex: 1;
  font-size: 14px;
}
```

Do **not** implement confirm body yet (Delete may set `confirmOpen` — Task 6 renders the dialog). For Task 3 tests that do not open confirm, Esc path is enough. If Delete is clicked with no dialog UI yet, `confirmOpen` true blocks Esc exit — acceptable until Task 6; Task 3 tests do not click Delete.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx`

Expected: PASS for the two Task 3 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/styles/glass.css frontend/src/App.multiselect.test.tsx
git commit -m "feat(chat): add multi-select top bar and Esc/Close exit"
```

---

### Task 4: Drag rectangle selection

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`
- Modify: `frontend/src/styles/glass.css`
- Test: `frontend/src/App.multiselect.test.tsx`

**Interfaces:**
- Consumes: Task 3 state (`applySelection` / `multiSelectActive` / `selectedIds`)
- Produces: pointer handlers on `.chat-log`; translucent `.chat-drag-rect`; movement threshold 4px; skip start when `closest("a,button,input,textarea,select,[role='button']")`; on pointer-up with ≥1 hit selectable bubble → `applySelection`; zero hits → do not enter (or exit if empty)

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/App.multiselect.test.tsx`:

```tsx
describe("drag rectangle selection", () => {
  it("enters multi-select when a drag rect intersects non-system bubbles", () => {
    renderChat();
    const log = document.querySelector(".chat-log") as HTMLElement;
    const bubble = document.querySelector(".chat-bubble.in") as HTMLElement;
    expect(log && bubble).toBeTruthy();

    // happy-dom: stub geometry so intersection is deterministic
    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, bottom: 400, right: 400, width: 400, height: 400, toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(bubble, "getBoundingClientRect").mockReturnValue({
      x: 10, y: 10, top: 10, left: 10, bottom: 50, right: 120, width: 110, height: 40, toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(log, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(log, { clientX: 80, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(log, { clientX: 80, clientY: 80, pointerId: 1 });

    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(bubble.className).toMatch(/selected/);
  });

  it("does not start drag-select from a button", () => {
    renderChat({
      messages: [
        {
          id: "voice-1",
          direction: "in",
          type: "voice",
          mime: "audio/webm",
          audio: "",
          duration: 1,
          burn: true,
          ttlSec: 0,
          at: "2026-09-22T00:00:00.000Z",
        },
      ],
    });
    const play = screen.getByRole("button", { name: "Play" });
    fireEvent.pointerDown(play, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(play, { clientX: 80, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(play, { clientX: 80, clientY: 80, pointerId: 1 });
    expect(screen.queryByText(/selected/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx`

Expected: FAIL — no selection after drag.

- [ ] **Step 3: Write minimal implementation**

Add refs and drag state in `ChatPage`:

```tsx
  const logRef = useRef<HTMLDivElement>(null);
  const bubbleEls = useRef(new Map<string, HTMLElement>());
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    originX: number;
    originY: number;
  } | null>(null);

  const DRAG_THRESHOLD = 4;

  function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    return Boolean(target.closest("a, button, input, textarea, select, [role='button']"));
  }

  function rectsIntersect(
    a: { left: number; top: number; width: number; height: number },
    b: DOMRect,
  ): boolean {
    const ar = { left: a.left, top: a.top, right: a.left + a.width, bottom: a.top + a.height };
    return !(ar.right < b.left || ar.left > b.right || ar.bottom < b.top || ar.top > b.bottom);
  }

  function onLogPointerDown(ev: PointerEvent<HTMLDivElement>): void {
    if (ev.button !== 0 || isInteractiveTarget(ev.target)) {
      return;
    }
    const log = logRef.current;
    if (!log) {
      return;
    }
    const box = log.getBoundingClientRect();
    dragRef.current = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      active: false,
      originX: box.left,
      originY: box.top,
    };
    log.setPointerCapture?.(ev.pointerId);
  }

  function onLogPointerMove(ev: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== ev.pointerId) {
      return;
    }
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    if (!drag.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }
    drag.active = true;
    const left = Math.min(drag.startX, ev.clientX) - drag.originX;
    const top = Math.min(drag.startY, ev.clientY) - drag.originY;
    const width = Math.abs(dx);
    const height = Math.abs(dy);
    setDragRect({ left, top, width, height });
  }

  function onLogPointerUp(ev: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.pointerId !== ev.pointerId) {
      setDragRect(null);
      return;
    }
    if (!drag.active) {
      setDragRect(null);
      return;
    }
    const left = Math.min(drag.startX, ev.clientX) - drag.originX;
    const top = Math.min(drag.startY, ev.clientY) - drag.originY;
    const width = Math.abs(ev.clientX - drag.startX);
    const height = Math.abs(ev.clientY - drag.startY);
    const local = { left, top, width, height };
    const hit = new Set<string>();
    for (const msg of messages) {
      if (msg.direction === "system") {
        continue;
      }
      const el = bubbleEls.current.get(msg.id);
      if (!el) {
        continue;
      }
      const br = el.getBoundingClientRect();
      const rel = {
        left: br.left - drag.originX,
        top: br.top - drag.originY,
        right: br.right - drag.originX,
        bottom: br.bottom - drag.originY,
        width: br.width,
        height: br.height,
        x: br.left - drag.originX,
        y: br.top - drag.originY,
        toJSON: () => ({}),
      } as DOMRect;
      if (rectsIntersect(local, rel)) {
        hit.add(msg.id);
      }
    }
    setDragRect(null);
    if (hit.size === 0) {
      return;
    }
    applySelection(hit);
  }
```

Wire the log:

```tsx
          <div
            className="chat-log"
            ref={logRef}
            onPointerDown={onLogPointerDown}
            onPointerMove={onLogPointerMove}
            onPointerUp={onLogPointerUp}
            onPointerCancel={() => {
              dragRef.current = null;
              setDragRect(null);
            }}
            style={{ position: "relative" }}
          >
            {dragRect ? (
              <div
                className="chat-drag-rect"
                style={{
                  left: dragRect.left,
                  top: dragRect.top,
                  width: dragRect.width,
                  height: dragRect.height,
                }}
              />
            ) : null}
```

On each selectable bubble `<article>`:

```tsx
            <article
              key={msg.id}
              ref={(el) => {
                if (el) {
                  bubbleEls.current.set(msg.id, el);
                } else {
                  bubbleEls.current.delete(msg.id);
                }
              }}
              data-msgid={msg.id}
              className={`glass chat-bubble ${msg.direction}${selectedIds.has(msg.id) ? " selected" : ""}`}
            >
```

CSS:

```css
.chat-drag-rect {
  position: absolute;
  pointer-events: none;
  border: 1px solid color-mix(in srgb, var(--accent, #0a84ff) 70%, transparent);
  background: color-mix(in srgb, var(--accent, #0a84ff) 18%, transparent);
  z-index: 2;
}
.chat-bubble.selected {
  outline: 2px solid color-mix(in srgb, var(--accent, #0a84ff) 80%, transparent);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx`

Expected: PASS including drag cases. If geometry mocking in happy-dom needs `pointerId` capture stubs, adjust mocks only — do not weaken the interactive-control assertion.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/styles/glass.css frontend/src/App.multiselect.test.tsx
git commit -m "feat(chat): drag rectangle enters multi-select"
```

---

### Task 5: Click toggle + system exclusion

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`
- Test: `frontend/src/App.multiselect.test.tsx`

**Interfaces:**
- Consumes: Task 3–4 selection state
- Produces: when `multiSelectActive`, click on a non-system bubble toggles id in `selectedIds` via `applySelection`; system rows ignore selection clicks; clicks on interactive controls inside bubbles do not toggle

- [ ] **Step 1: Write the failing test**

Append:

```tsx
describe("click toggle", () => {
  it("toggles a bubble and exits when the last selection is cleared", async () => {
    const user = userEvent.setup();
    renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b", "d"] } }));
    expect(await screen.findByText("2 selected")).toBeTruthy();
    const peerBubble = screen.getByText("peer hi").closest("article") as HTMLElement;
    await user.click(peerBubble);
    expect(screen.getByText("1 selected")).toBeTruthy();
    const youBubble = screen.getByText("you hi").closest("article") as HTMLElement;
    await user.click(youBubble);
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it("does not select system lines on click", async () => {
    const user = userEvent.setup();
    renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b"] } }));
    const sys = screen.getByText("they're hear meow");
    await user.click(sys);
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(sys.className).not.toMatch(/selected/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx`

Expected: FAIL — click does not change count.

- [ ] **Step 3: Write minimal implementation**

On selectable `<article>`:

```tsx
              onClick={(ev) => {
                if (!multiSelectActive) {
                  return;
                }
                if (isInteractiveTarget(ev.target)) {
                  return;
                }
                ev.preventDefault();
                const next = new Set(selectedIds);
                if (next.has(msg.id)) {
                  next.delete(msg.id);
                } else {
                  next.add(msg.id);
                }
                applySelection(next);
              }}
```

System branch stays plain `<p className="chat-system">` with no `selected` class and no toggle handler.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/App.multiselect.test.tsx
git commit -m "feat(chat): click-toggle multi-select; exclude system lines"
```

---

### Task 6: Confirm dialog + sequential discard + system purge side-effect

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`
- Test: `frontend/src/App.multiselect.test.tsx`

**Interfaces:**
- Consumes: `purgeDiscardIds` from Task 1; `onDiscard`; Task 2 confirm strings; existing `.modal-backdrop` / `.modal` / `cancel` key (same pattern as `ServicesPage.tsx`)
- Produces: `confirmOpen` dialog; on confirm, `ids = purgeDiscardIds(messages, selectedIds)` then `for (const id of ids) await onDiscard(id)` in list order; success → `exitMultiSelect()`; Cancel → close dialog only; `N` in copy = `selectedIds.size` (not purge length)

- [ ] **Step 1: Write the failing test**

Append:

```tsx
describe("confirm delete and purge", () => {
  it("confirms local-only copy and discards selected plus in-range systems", async () => {
    const user = userEvent.setup();
    const { onDiscard } = renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b", "d"] } }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Delete 2 local messages? Your peer is not affected.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onDiscard.mock.calls.map((c) => c[0])).toEqual(["b", "sys-c", "d"]);
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it("cancel leaves selection unchanged", async () => {
    const user = userEvent.setup();
    const { onDiscard } = renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b"] } }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("Esc on the dialog cancels the dialog only", async () => {
    renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b"] } }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("1 selected")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx`

Expected: FAIL — no dialog / no discard calls with system id.

- [ ] **Step 3: Write minimal implementation**

Import:

```ts
import { purgeDiscardIds } from "../lib/chatPurge";
```

Add discard runner:

```tsx
  async function confirmDelete(): Promise<void> {
    const ids = purgeDiscardIds(messages, selectedIds);
    setConfirmOpen(false);
    for (const id of ids) {
      await onDiscard?.(id);
    }
    exitMultiSelect();
  }
```

Task 8 replaces this body with stop-on-failure + `setInline(t("chatSelectDeleteError"))` + `applySelection(remaining)`. For Task 6 success-only tests, the loop above is enough. Render dialog when `confirmOpen`:

```tsx
      {confirmOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setConfirmOpen(false)}
        >
          <div
            className="glass modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-select-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="chat-select-delete-title">{t("chatSelectDelete")}</h3>
            <p>{fillN(t("chatSelectDeleteConfirm"), selectedIds.size)}</p>
            <div className="row">
              <button className="btn btn-ghost" type="button" onClick={() => setConfirmOpen(false)}>
                {t("cancel")}
              </button>
              <button className="btn btn-danger" type="button" onClick={() => void confirmDelete()}>
                {t("chatSelectDelete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
```

Ensure Esc effect: when `confirmOpen`, first Esc only `setConfirmOpen(false)`:

```tsx
  useEffect(() => {
    if (!multiSelectActive) {
      return;
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key !== "Escape") {
        return;
      }
      if (confirmOpen) {
        setConfirmOpen(false);
        return;
      }
      exitMultiSelect();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiSelectActive, confirmOpen]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx`

Expected: PASS; `onDiscard` order `b`, `sys-c`, `d`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/App.multiselect.test.tsx
git commit -m "feat(chat): confirm multi-select local delete with system purge"
```

---

### Task 7: Remove BurnBadge Delete; keep burn copy

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx` (`BurnBadge`, `BubbleBody`, message map)
- Test: `frontend/src/App.multiselect.test.tsx` and existing `frontend/src/App.phase2.test.tsx` (re-run; should still pass)

**Interfaces:**
- Consumes: `chatBurnRemoved` / `chatBurnKept`
- Produces: `BurnBadge({ caps })` with status `<p>` only — no Delete button, no `onDelete` prop. Remove `onDelete` from `BubbleBody` props and call sites. Leave unused `chatDelete` key in catalogs (spec: retire if unused; leave until cleanup pass is OK).

- [ ] **Step 1: Write the failing test**

Append:

```tsx
describe("burn badge without Delete", () => {
  it("shows burn status copy and no Delete on outbound burn bubbles", () => {
    renderChat({
      caps: ["burn"],
      messages: [
        {
          id: "out-burn",
          direction: "out",
          type: "text",
          body: "gone",
          burn: true,
          ttlSec: 5,
          at: "2026-09-22T00:00:00.000Z",
        },
      ],
    });
    expect(screen.getByText("Removed on their side after they open it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx -t "burn badge"`

Expected: FAIL — Delete button still present (query finds it).

- [ ] **Step 3: Write minimal implementation**

Replace `BurnBadge`:

```tsx
function BurnBadge({ caps }: { caps: string[] }) {
  const { t } = useI18n();
  return (
    <div className="chat-actions">
      <p className="chat-badge">{caps.includes("burn") ? t("chatBurnRemoved") : t("chatBurnKept")}</p>
    </div>
  );
}
```

Update every `<BurnBadge caps={caps} onDelete={onDelete} />` to `<BurnBadge caps={caps} />`.

Remove `onDelete` from `BubbleBody` props type, parameter list, and the parent call:

```tsx
                onSave={async () => {
                  await onSave?.(msg.id);
                  if (msg.burn && msg.direction === "in") {
                    await onDiscard?.(msg.id);
                  }
                }}
                canPlayMime={canPlayMime}
                decodeVoice={decodeVoice}
```

(delete the `onDelete={() => onDiscard?.(msg.id)}` line).

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd frontend && npm test -- src/App.multiselect.test.tsx src/App.phase2.test.tsx
```

Expected: PASS. Inbound Reveal/Close discard behavior unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/App.multiselect.test.tsx
git commit -m "feat(chat): remove BurnBadge Delete; keep burn status copy"
```

---

### Task 8: Failure path, composer stays usable, CSS polish, final verification

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx` (`confirmDelete` failure handling)
- Modify: `frontend/src/styles/glass.css` (polish only if Task 4/3 chrome needs light/dark readability)
- Test: `frontend/src/App.multiselect.test.tsx`

**Interfaces:**
- Consumes: `onDiscard`, `setInline`, `chatSelectDeleteError`
- Produces: on mid-batch failure — **stop** remaining calls, keep `multiSelectActive`, set inline error to `t("chatSelectDeleteError")`, remove successfully discarded ids from `selectedIds`, keep failed id selected; sending via composer does not call `exitMultiSelect`

- [ ] **Step 1: Write the failing test**

Append:

```tsx
describe("failure and composer", () => {
  it("keeps multi-select and shows an error when onDiscard fails", async () => {
    const user = userEvent.setup();
    const onDiscard = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));
    renderChat({ onDiscard });
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b", "d"] } }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Could not delete some local messages.")).toBeTruthy();
    expect(screen.getByText(/selected/)).toBeTruthy();
  });

  it("sending a message does not exit multi-select", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b"] } }));
    expect(await screen.findByText("1 selected")).toBeTruthy();
    await user.type(screen.getByLabelText("Message"), "still selecting");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalled();
    expect(screen.getByText("1 selected")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/App.multiselect.test.tsx -t "failure and composer"`

Expected: FAIL — either multi-select cleared on error, or wrong/missing error text, or send exits selection.

- [ ] **Step 3: Write minimal implementation**

Replace `confirmDelete` with:

```tsx
  async function confirmDelete(): Promise<void> {
    const selectedSnapshot = new Set(selectedIds);
    const ids = purgeDiscardIds(messages, selectedSnapshot);
    setConfirmOpen(false);
    const remaining = new Set(selectedSnapshot);
    let failed = false;
    for (const id of ids) {
      try {
        await onDiscard?.(id);
        remaining.delete(id);
      } catch {
        failed = true;
        break;
      }
    }
    if (failed) {
      setInline(t("chatSelectDeleteError"));
      applySelection(remaining);
      return;
    }
    exitMultiSelect();
  }
```

Confirm the existing `send()` path does not call `exitMultiSelect` (it should not today — do not add any exit there). New outbound rows from parent props appear without being in `selectedIds` automatically.

CSS polish (only if needed for contrast): ensure `.chat-select-bar` and `.chat-bubble.selected` remain readable under existing light/dark variables — no new purple theme, no redesign.

- [ ] **Step 4: Run full frontend tests + build; Go tests unchanged**

```bash
cd frontend && npm test
cd frontend && npm run build
go test ./...
```

Expected: all green. No Go file changes in this plan.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/styles/glass.css frontend/src/App.multiselect.test.tsx
git commit -m "fix(chat): keep multi-select on discard failure; composer stays usable"
```

---

## Self-review (spec coverage)

| Spec locked decision / acceptance | Task |
| --- | --- |
| Remove BurnBadge Delete; keep burn copy | Task 7 |
| Drag rectangle entry; threshold; interactive skip | Task 4 |
| Top bar count / Delete / Close when count ≥ 1 | Task 3 |
| Click toggle; system never selectable / no chrome | Task 5 |
| Confirm EN/ZH local-only copy; Cancel keeps selection | Task 6 |
| Purge in-range systems; leave non-selected peers | Task 1 + Task 6 |
| N sequential `onDiscard`; no new Wails API | Task 6 (App.tsx untouched) |
| Exit: Close, Esc, count → 0 | Task 3 + Task 5 |
| Esc on dialog cancels dialog only | Task 6 |
| Composer usable; send does not exit; new msgs unselected | Task 8 |
| Discard failure keeps multi-select + error | Task 8 |
| i18n EN/ZH new keys; burn strings remain | Task 2 |
| Manual/automated AC list §7 | Tasks 1–8 tests above |

Placeholder scan: no TBD/TODO/"similar to Task N" left unresolved — Task 3 documents the test-only `tailcat-test-select` seed explicitly for hermetic bar tests alongside Task 4 drag.

Type consistency: `purgeDiscardIds` / `PurgeMessage` / `applySelection` / `exitMultiSelect` / `fillN` / `confirmOpen` / `selectedIds` names are stable across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-tailcat-box-chat-multiselect-delete.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration (`superpowers:subagent-driven-development`).
2. **Inline Execution** — execute tasks in one session with `superpowers:executing-plans` and checkpoints.

Which approach?
