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
  {
    id: "sys-a",
    direction: "system",
    type: "system",
    code: "hear-meow",
    body: "they're hear meow",
    at: "2026-09-22T00:00:00.000Z",
  },
  { id: "b", direction: "in", type: "text", body: "peer hi", at: "2026-09-22T00:00:01.000Z" },
  {
    id: "sys-c",
    direction: "system",
    type: "system",
    code: "peer-changed",
    body: "Peer changed",
    at: "2026-09-22T00:00:02.000Z",
  },
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
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b", "d"] } }));
    expect(await screen.findByText("2 selected")).toBeTruthy();
    const bar = screen.getByRole("toolbar", { name: "2 selected" });
    expect(within(bar).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(within(bar).getByRole("button", { name: "Close" })).toBeTruthy();
    await user.click(within(bar).getByRole("button", { name: "Close" }));
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

describe("drag rectangle selection", () => {
  it("enters multi-select when a drag rect intersects non-system bubbles", () => {
    renderChat();
    const log = document.querySelector(".chat-log") as HTMLElement;
    const bubble = document.querySelector(".chat-bubble.in") as HTMLElement;
    const out = document.querySelector(".chat-bubble.out") as HTMLElement;
    expect(log && bubble && out).toBeTruthy();

    vi.spyOn(log, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 400,
      right: 400,
      width: 400,
      height: 400,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(bubble, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      bottom: 50,
      right: 120,
      width: 110,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect);
    // Keep other bubbles outside the drag so only the inbound one is hit.
    vi.spyOn(out, "getBoundingClientRect").mockReturnValue({
      x: 200,
      y: 200,
      top: 200,
      left: 200,
      bottom: 240,
      right: 320,
      width: 120,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(log, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(log, { clientX: 80, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(log, { clientX: 80, clientY: 80, pointerId: 1 });

    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(bubble.className).toMatch(/selected/);
    expect(out.className).not.toMatch(/selected/);
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

describe("confirm delete and purge", () => {
  it("confirms local-only copy and discards selected plus in-range systems", async () => {
    const user = userEvent.setup();
    const { onDiscard } = renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b", "d"] } }));
    const bar = await screen.findByRole("toolbar", { name: "2 selected" });
    await user.click(within(bar).getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.className).toContain("modal-compact");
    expect(dialog.className).toContain("glass");
    expect(dialog.getAttribute("aria-labelledby")).toBe("chat-select-delete-title");
    expect(dialog.getAttribute("aria-describedby")).toBe("chat-select-delete-body");
    expect(document.activeElement).toBe(dialog);
    expect(dialog.textContent).toContain("Delete 2 local messages? Your peer is not affected.");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(onDiscard.mock.calls.map((c) => c[0])).toEqual(["b", "sys-c", "d"]);
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it("cancel leaves selection unchanged", async () => {
    const user = userEvent.setup();
    const { onDiscard } = renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b"] } }));
    const bar = await screen.findByRole("toolbar", { name: "1 selected" });
    await user.click(within(bar).getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("Esc on the dialog cancels the dialog only", async () => {
    renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b"] } }));
    const bar = await screen.findByRole("toolbar", { name: "1 selected" });
    fireEvent.click(within(bar).getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("1 selected")).toBeTruthy();
  });
});

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

describe("failure and composer", () => {
  it("keeps multi-select and shows an error when onDiscard fails", async () => {
    const user = userEvent.setup();
    const onDiscard = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("disk full"));
    renderChat({ onDiscard });
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b", "d"] } }));
    const bar = await screen.findByRole("toolbar", { name: "2 selected" });
    await user.click(within(bar).getByRole("button", { name: "Delete" }));
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
