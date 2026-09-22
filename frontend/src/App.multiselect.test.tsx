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

describe("drag rectangle selection", () => {
  it("enters multi-select when a drag rect intersects non-system bubbles", () => {
    renderChat();
    const log = document.querySelector(".chat-log") as HTMLElement;
    const bubble = document.querySelector(".chat-bubble.in") as HTMLElement;
    expect(log && bubble).toBeTruthy();

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
