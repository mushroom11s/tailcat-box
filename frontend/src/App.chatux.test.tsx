import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import ChatPage, { type ChatMessage } from "./pages/ChatPage";
import { LocaleProvider } from "./i18n";
import { translate } from "./i18n/locale";

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const thread: ChatMessage[] = [
  {
    id: "sys-a",
    direction: "system",
    type: "system",
    code: "hear-meow",
    body: "they're hear meow",
    at: "2026-09-22T00:00:00.000Z",
  },
  { id: "b", direction: "in", type: "text", body: "peer hi", at: "2026-09-22T00:00:01.000Z" },
  { id: "d", direction: "out", type: "text", body: "you hi", at: "2026-09-22T00:00:03.000Z" },
];

function renderChat(overrides: Partial<ComponentProps<typeof ChatPage>> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onDiscard = vi.fn().mockResolvedValue(undefined);
  const onSave = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <LocaleProvider>
      <ChatPage
        address="tc:room"
        peer="tc:peer"
        messages={thread}
        roomError=""
        onConnect={vi.fn()}
        onSend={onSend}
        onDiscard={onDiscard}
        onSave={onSave}
        onRetry={vi.fn()}
        {...overrides}
      />
    </LocaleProvider>,
  );
  return { ...utils, onSend, onDiscard, onSave };
}

function identityRoom(props: Partial<ComponentProps<typeof ChatPage>> = {}) {
  return (
    <LocaleProvider>
      <ChatPage
        address="tc:fake-room-abcd"
        peer=""
        messages={thread}
        roomError=""
        onConnect={vi.fn()}
        onSend={vi.fn()}
        onRetry={vi.fn()}
        {...props}
      />
    </LocaleProvider>
  );
}

describe("room identity bar", () => {
  it("collapses when the address is ready and keeps a manual toggle", async () => {
    const user = userEvent.setup();
    const view = renderChat({ address: "", peer: "" });
    expect(screen.getByLabelText("Peer")).toBeTruthy();
    expect(screen.getByLabelText("Remark")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide room details" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show room details" })).toBeNull();

    view.rerender(identityRoom());
    expect(screen.queryByLabelText("Peer")).toBeNull();
    expect(screen.getByText("tc…abcd")).toBeTruthy();
    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(document.querySelector(".chat-identity-peer")?.classList.contains("is-quiet")).toBe(true);
    expect(screen.getByText("Listening")).toBeTruthy();
    const copy = screen.getByRole("button", { name: "Copy" });
    expect(document.querySelector(".chat-identity-compact")?.contains(copy)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Show room details" }));
    expect(screen.getByLabelText("Peer")).toBeTruthy();
    expect(screen.getByLabelText("Remark")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.getByText("tc:fake-room-abcd")).toBeTruthy();

    view.rerender(identityRoom({ peer: "tc:fake-echo", remarks: { "tc:fake-echo": "Bob" } }));
    expect(screen.queryByLabelText("Peer")).toBeNull();
    expect(screen.queryByText("Peer connected")).toBeNull();
    expect(document.querySelector(".chat-identity-peer")?.textContent).toBe("Bob");
    expect(screen.getByText("tc…abcd")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Show room details" }));
    expect(screen.getByLabelText("Peer")).toBeTruthy();
    expect(screen.getByText("Peer connected")).toBeTruthy();

    view.rerender(identityRoom({ peer: "tc:fake-echo", remarks: { "tc:fake-echo": "Bob" } }));
    expect(screen.getByLabelText("Peer")).toBeTruthy();
    expect(screen.getByText("Peer connected")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Hide room details" }));
    expect(screen.queryByLabelText("Peer")).toBeNull();
    expect(document.querySelector(".chat-identity-peer")?.textContent).toBe("Bob");

    view.rerender(identityRoom({ peer: "tc:fake-echo", remarks: { "tc:fake-echo": "Bob" } }));
    expect(screen.queryByLabelText("Peer")).toBeNull();
    expect(document.querySelector(".chat-identity-peer")?.textContent).toBe("Bob");

    view.rerender(identityRoom({ peer: "" }));
    expect(screen.queryByLabelText("Peer")).toBeNull();
    expect(screen.getByText("Not connected")).toBeTruthy();

    await user.click(screen.getByText("tc…abcd"));
    expect(screen.getByLabelText("Peer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide room details" })).toBeTruthy();
  });

  it("expands the identity bar when the room has an error", () => {
    const view = renderChat({ address: "tc:fake-room-abcd", peer: "", roomError: "listen failed" });
    expect(screen.queryByText("listen failed")).toBeNull();
    expect(document.querySelector(".chat-identity .err")).toBeNull();
    expect(document.querySelector(".status-dot.bad")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByLabelText("Peer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide room details" })).toBeNull();

    view.rerender(identityRoom());
    expect(screen.queryByLabelText("Peer")).toBeNull();
    expect(screen.getByText("Not connected")).toBeTruthy();
  });

  it("stays open after a manual expand when an error clears", async () => {
    const user = userEvent.setup();
    const view = renderChat({ address: "tc:fake-room-abcd", peer: "" });
    await user.click(screen.getByRole("button", { name: "Show room details" }));
    view.rerender(identityRoom({ roomError: "listen failed" }));
    expect(screen.queryByText("listen failed")).toBeNull();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(document.querySelector(".status-dot.bad")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByLabelText("Peer")).toBeTruthy();
    view.rerender(identityRoom());
    expect(screen.getByLabelText("Peer")).toBeTruthy();
    expect(screen.queryByText("listen failed")).toBeNull();
    expect(screen.queryByText("Failed")).toBeNull();
  });
});

describe("multi-select alignment", () => {
  it("places a checkbox outside each bubble in one leading column", async () => {
    renderChat();
    fireEvent(window, new CustomEvent("tailcat-test-select", { detail: { ids: ["b", "d"] } }));
    expect(await screen.findByText("2 selected")).toBeTruthy();

    const rows = Array.from(document.querySelectorAll(".chat-msg.selecting"));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const check = row.querySelector(".chat-select-check");
      const bubble = row.querySelector(".chat-bubble");
      expect(check).toBeTruthy();
      expect(bubble).toBeTruthy();
      expect(bubble!.contains(check)).toBe(false);
      expect(row.firstElementChild).toBe(check);
      expect(check!.compareDocumentPosition(bubble!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(document.querySelector(".chat-system .chat-select-check")).toBeNull();
    expect(screen.getAllByRole("checkbox", { name: "Select message" })).toHaveLength(2);

    const inbound = document.querySelector(".chat-msg.in .chat-select-check") as HTMLElement;
    const outbound = document.querySelector(".chat-msg.out .chat-select-check") as HTMLElement;
    expect(inbound.getAttribute("aria-checked")).toBe("true");
    expect(outbound.getAttribute("aria-checked")).toBe("true");
  });

  it("offsets the drag rectangle by the transcript scroll position", () => {
    renderChat();
    const log = document.querySelector(".chat-log") as HTMLElement;
    Object.defineProperty(log, "scrollTop", { configurable: true, value: 40 });
    Object.defineProperty(log, "scrollLeft", { configurable: true, value: 6 });
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

    fireEvent.pointerDown(log, { clientX: 8, clientY: 12, button: 0, pointerId: 1 });
    fireEvent.pointerMove(log, { clientX: 30, clientY: 28, pointerId: 1 });
    const rect = document.querySelector(".chat-drag-rect") as HTMLElement;
    expect(rect.hidden).toBe(false);
    expect(rect.style.left).toBe("14px");
    expect(rect.style.top).toBe("52px");
  });
});

describe("send once with optimistic append", () => {
  it("shows the message immediately and ignores duplicate Send and Enter until the send finishes", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const view = renderChat({ messages: [], onSend });
    const composer = screen.getByLabelText("Message");
    await user.type(composer, "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect((composer as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText("hello")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSend).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
    });
    view.rerender(
      <LocaleProvider>
        <ChatPage
          address="tc:room"
          peer="tc:peer"
          messages={[
            {
              id: "real-1",
              direction: "out",
              type: "text",
              body: "hello",
              at: "2026-09-22T00:00:04.000Z",
            },
          ]}
          roomError=""
          onConnect={vi.fn()}
          onSend={onSend}
          onRetry={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getAllByText("hello")).toHaveLength(1);
    expect(document.querySelector("[data-msgid='real-1']")).toBeTruthy();
    expect(document.querySelector("[data-msgid^='local-']")).toBeNull();
  });

  it("restores the draft and drops the optimistic bubble when send fails", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockRejectedValue(new Error("no peer"));
    renderChat({ messages: [], onSend });
    const composer = screen.getByLabelText("Message");
    await user.type(composer, "stay");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect((composer as HTMLTextAreaElement).value).toBe("stay");
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".chat-bubble.out")).toBeNull();
  });
});

describe("burn preview and file download affordances", () => {
  it("masks a sealed burn bubble with a flame and puts the view control outside", () => {
    renderChat({
      messages: [
        {
          id: "burn-1",
          direction: "in",
          type: "text",
          body: "secret",
          burn: true,
          ttlSec: 0,
          at: "2026-09-22T00:00:00.000Z",
        },
      ],
    });
    expect(screen.queryByText("secret")).toBeNull();
    const bubble = document.querySelector(".chat-bubble.burn-sealed") as HTMLElement;
    expect(bubble.querySelector(".chat-burn-mask")).toBeTruthy();
    const eye = screen.getByRole("button", { name: "Reveal" });
    expect(bubble.contains(eye)).toBe(false);
    expect(eye.querySelector("svg")).toBeTruthy();
    expect(eye.closest(".chat-outside-actions")).toBeTruthy();
  });

  it("dissolves a burn message after viewing finishes, then discards it", async () => {
    vi.useFakeTimers();
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    renderChat({
      messages: [
        {
          id: "burn-1",
          direction: "in",
          type: "text",
          body: "secret",
          burn: true,
          ttlSec: 0,
          at: "2026-09-22T00:00:00.000Z",
        },
      ],
      onDiscard,
    });
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(screen.getByText("secret")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(document.querySelector(".chat-msg.dissolving")).toBeTruthy();
    expect(onDiscard).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(onDiscard).toHaveBeenCalledWith("burn-1");
  });

  it("sends a burned message with a 3 second ttl", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChat({ messages: [] });
    await user.click(screen.getByRole("switch", { name: "Burn" }));
    expect(screen.getByText("Shown for 3 seconds, then it disappears.")).toBeTruthy();
    await user.type(screen.getByLabelText("Message"), "gone");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("gone", true, 3);
  });

  it("puts download outside the file bubble", () => {
    renderChat({
      messages: [
        {
          id: "file-1",
          direction: "in",
          type: "file",
          name: "notes.txt",
          mime: "text/plain",
          size: 4,
          at: "2026-09-22T00:00:00.000Z",
        },
      ],
    });
    const bubble = document.querySelector(".chat-bubble") as HTMLElement;
    const download = screen.getByRole("button", { name: "Download" });
    expect(bubble.contains(download)).toBe(false);
    expect(download.closest(".chat-outside-actions")).toBeTruthy();
    expect(download.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("notes.txt · 4")).toBeTruthy();
    expect(bubble.querySelector("img")).toBeNull();
  });

  it("puts an image preview outside the file bubble", async () => {
    const user = userEvent.setup();
    const { onSave } = renderChat({
      messages: [
        {
          id: "pic-1",
          direction: "in",
          type: "file",
          name: "pic.png",
          mime: "image/png",
          size: 4,
          preview: "data:image/png;base64,xx",
          at: "2026-09-22T00:00:00.000Z",
        },
      ],
    });
    const bubble = document.querySelector(".chat-bubble") as HTMLElement;
    const img = screen.getByRole("img", { name: "pic.png" });
    expect(bubble.contains(img)).toBe(false);
    expect(img.closest(".chat-file-preview")).toBeTruthy();
    expect(bubble.textContent).toContain("pic.png · 4");
    expect(bubble.querySelector("button")).toBeNull();
    await user.click(img);
    expect(onSave).toHaveBeenCalledWith("pic-1");
  });

  it("translates the select toggle in zh-CN", () => {
    expect(translate("en", "chatSelectToggle")).toBe("Select message");
    expect(translate("zh-CN", "chatSelectToggle")).toBe("选择消息");
  });
});
