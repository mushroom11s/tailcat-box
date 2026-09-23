import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { emitBrowserEvent, listSessions, resetBrowserRooms, sendChatText } from "./lib/wails";
import { resetOsNotificationsForTests } from "./lib/osNotify";

type RuntimeMocks = {
  send: ReturnType<typeof vi.fn>;
  initialize: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
};

let focused = true;
let hidden = false;

function installRuntime(authorized = true): RuntimeMocks {
  const send = vi.fn().mockResolvedValue(undefined);
  const initialize = vi.fn().mockResolvedValue(undefined);
  const request = vi.fn().mockResolvedValue(authorized);
  (window as unknown as { runtime?: object }).runtime = {
    InitializeNotifications: initialize,
    IsNotificationAvailable: vi.fn().mockResolvedValue(true),
    CheckNotificationAuthorization: vi.fn().mockResolvedValue(authorized),
    RequestNotificationAuthorization: request,
    SendNotification: send,
  };
  return { send, initialize, request };
}

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

beforeEach(() => {
  resetBrowserRooms();
  localStorage.setItem("tailcat-locale", "en");
  focused = true;
  hidden = false;
  resetOsNotificationsForTests();
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
});

afterEach(() => {
  cleanup();
  resetOsNotificationsForTests();
  delete (window as unknown as { runtime?: object }).runtime;
  vi.restoreAllMocks();
});

async function connectEcho(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Peer address (optional)"), "tc:fake-echo");
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(await screen.findByText("Peer connected")).toBeTruthy();
}

async function chatRoomId(): Promise<string> {
  const chats = (await listSessions()).filter((item) => item.Kind === "chat");
  return chats[0]?.ID ?? "";
}

describe("inbound OS notifications", () => {
  it("notifies a short text preview when the window is unfocused", async () => {
    const { send } = installRuntime();
    focused = false;
    const user = userEvent.setup();
    renderApp();
    await connectEcho(user);
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("echo");
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(send.mock.calls[0][0]).toMatchObject({
      title: "tc:fake-echo",
      body: "echo",
    });
    expect(JSON.stringify(send.mock.calls[0][0])).not.toContain("audio");
  });

  it("stays quiet while the focused window is already on the chat transcript", async () => {
    const { send } = installRuntime();
    const user = userEvent.setup();
    renderApp();
    await connectEcho(user);
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("echo");
    expect(send).not.toHaveBeenCalled();
  });

  it("notifies when the window is focused on another page", async () => {
    const { send } = installRuntime();
    const user = userEvent.setup();
    renderApp();
    await connectEcho(user);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await sendChatText(await chatRoomId(), "later", false, 0);
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(send.mock.calls[0][0].body).toBe("echo");
    expect(send.mock.calls[0][0].title).toBe("tc:fake-echo");
  });

  it("notifies when the chat page is hidden even if focus is still reported", async () => {
    const { send } = installRuntime();
    hidden = true;
    const user = userEvent.setup();
    renderApp();
    await connectEcho(user);
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  it("shows one soft note when the OS denies notifications and does not ask again", async () => {
    const { send, request } = installRuntime(false);
    focused = false;
    const user = userEvent.setup();
    renderApp();
    await connectEcho(user);
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(
      await screen.findByText("System notifications are off, so new messages stay in the chat."),
    ).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
    await sendChatText(await chatRoomId(), "again", false, 0);
    await screen.findByText("echo");
    expect(screen.getAllByText("System notifications are off, so new messages stay in the chat.")).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not notify when a peer connects without an inbound message", async () => {
    const { send } = installRuntime();
    focused = false;
    const user = userEvent.setup();
    renderApp();
    await connectEcho(user);
    expect(send).not.toHaveBeenCalled();
  });

  it("notifies for a room that is not the open transcript", async () => {
    const { send } = installRuntime();
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const firstAddress = (await screen.findByText(/^tc:fake-room-/)).textContent ?? "";
    await user.click(screen.getByRole("button", { name: "+ New room" }));
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const secondAddress = (await screen.findByText(/^tc:fake-room-/)).textContent ?? "";
    const chats = (await listSessions()).filter((item) => item.Kind === "chat");
    const hidden = chats.find((item) => item.Address === firstAddress);
    const open = chats.find((item) => item.Address === secondAddress);
    emitBrowserEvent({
      SessionID: hidden?.ID ?? "",
      Kind: "message",
      Data: JSON.stringify({
        id: "other-room",
        direction: "in",
        type: "text",
        body: "from the other room",
        at: "2026-09-23T00:00:00.000Z",
      }),
    });
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(send.mock.calls[0][0].body).toBe("from the other room");
    expect(send.mock.calls[0][0].title).toBe("Tailcat Box");
    emitBrowserEvent({
      SessionID: open?.ID ?? "",
      Kind: "message",
      Data: JSON.stringify({
        id: "this-room",
        direction: "in",
        type: "text",
        body: "while reading",
        at: "2026-09-23T00:00:01.000Z",
      }),
    });
    expect(await screen.findByText("while reading")).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
