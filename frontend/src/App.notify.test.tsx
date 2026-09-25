import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { DESKTOP_NOTIFY_KEY, resetDesktopNotifyCoalesceForTests } from "./lib/desktopNotify";
import { emitBrowserEvent, emitNotifyOpen, listSessions, resetBrowserRooms, sendChatText } from "./lib/wails";
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

async function renderApp() {
  const view = render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
  fireEvent.click(document.querySelector(".nav-chat > .nav-btn") as HTMLElement);
  return view;
}

beforeEach(() => {
  resetBrowserRooms();
  localStorage.setItem("tailcat-locale", "en");
  localStorage.removeItem(DESKTOP_NOTIFY_KEY);
  focused = true;
  hidden = false;
  resetOsNotificationsForTests();
  resetDesktopNotifyCoalesceForTests();
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
  expect(await screen.findByRole("button", { name: "Show room details" })).toBeTruthy();
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
    await renderApp();
    await connectEcho(user);
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("echo");
    await waitFor(() => {
      expect(send.mock.calls.some((call) => call[0].body === "echo")).toBe(true);
    });
    const preview = send.mock.calls.find((call) => call[0].body === "echo");
    expect(preview?.[0]).toMatchObject({
      title: "tc:fake-echo",
      body: "echo",
      data: { page: "chat" },
    });
    expect(JSON.stringify(preview?.[0])).not.toContain("audio");
  });

  it("stays quiet while the focused window is already on the chat transcript", async () => {
    const { send } = installRuntime();
    const user = userEvent.setup();
    await renderApp();
    await connectEcho(user);
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("echo");
    expect(send).not.toHaveBeenCalled();
  });

  it("notifies when the window is focused on another page", async () => {
    const { send } = installRuntime();
    const user = userEvent.setup();
    await renderApp();
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
    await renderApp();
    await connectEcho(user);
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(send.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows one soft note when the OS denies notifications and does not ask again", async () => {
    const { send, request } = installRuntime(false);
    focused = false;
    const user = userEvent.setup();
    await renderApp();
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

  it("notifies once when a peer joins in the background and ignores a quick reconnect", async () => {
    const { send } = installRuntime();
    focused = false;
    const user = userEvent.setup();
    await renderApp();
    await connectEcho(user);
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(send.mock.calls[0][0].body).toBe("tc:fake-echo joined the room");
    expect(send.mock.calls[0][0].data).toMatchObject({ page: "chat" });
    const id = await chatRoomId();
    emitBrowserEvent({
      SessionID: id,
      Kind: "peer",
      Data: JSON.stringify({ address: "" }),
    });
    emitBrowserEvent({
      SessionID: id,
      Kind: "peer",
      Data: JSON.stringify({ address: "tc:fake-echo", caps: ["resume"] }),
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stays quiet about a peer join while this room is in front", async () => {
    const { send } = installRuntime();
    const user = userEvent.setup();
    await renderApp();
    await connectEcho(user);
    expect(send).not.toHaveBeenCalled();
  });

  it("notifies when a Mew Share starts and finishes in the background, once each", async () => {
    const { send } = installRuntime();
    focused = false;
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Mew Share" })).toBeTruthy();
    const base = {
      id: "job-1",
      bytesDone: 0,
      bytesTotal: 10,
      files: [{ name: "notes.txt", size: 10 }],
      dest: "/tmp",
    };
    emitBrowserEvent({
      SessionID: "job-1",
      Kind: "miao-receive",
      Data: JSON.stringify({ ...base, status: "connecting" }),
    });
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(send.mock.calls[0][0].body).toBe("Mew Share started · notes.txt");
    expect(send.mock.calls[0][0].data).toEqual({ page: "miao" });
    emitBrowserEvent({
      SessionID: "job-1",
      Kind: "miao-receive",
      Data: JSON.stringify({ ...base, status: "downloading", bytesDone: 4 }),
    });
    emitBrowserEvent({
      SessionID: "job-1",
      Kind: "miao-receive",
      Data: JSON.stringify({ ...base, status: "downloading", bytesDone: 8 }),
    });
    expect(send).toHaveBeenCalledTimes(1);
    emitBrowserEvent({
      SessionID: "job-1",
      Kind: "miao-receive",
      Data: JSON.stringify({ ...base, status: "done", bytesDone: 10 }),
    });
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });
    expect(send.mock.calls[1][0].body).toBe("Mew Share download finished · notes.txt");
  });

  it("opens the chat room when a notification click arrives", async () => {
    const show = vi.fn();
    const unmin = vi.fn();
    installRuntime();
    (window as unknown as { runtime: { WindowShow: typeof show; WindowUnminimise: typeof unmin } }).runtime.WindowShow = show;
    (window as unknown as { runtime: { WindowUnminimise: typeof unmin } }).runtime.WindowUnminimise = unmin;
    const user = userEvent.setup();
    await renderApp();
    await connectEcho(user);
    const id = await chatRoomId();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    emitNotifyOpen({ page: "chat", room: id });
    expect(show).toHaveBeenCalled();
    expect(unmin).toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Show room details" })).toBeTruthy();
  });

  it("turns desktop notifications off from Settings", async () => {
    const { send } = installRuntime();
    focused = false;
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const toggle = screen.getByRole("button", { name: "Desktop notifications" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await user.click(document.querySelector(".nav-chat > .nav-btn") as HTMLElement);
    await connectEcho(user);
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("echo");
    expect(send).not.toHaveBeenCalled();
  });

  it("notifies for a room that is not the open transcript", async () => {
    const { send } = installRuntime();
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    let firstAddress = "";
    await waitFor(() => {
      firstAddress = document.querySelector(".chat-identity-addr")?.getAttribute("title") ?? "";
      expect(firstAddress.startsWith("tc:fake-room-")).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "+ New room" }));
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    let secondAddress = "";
    await waitFor(() => {
      secondAddress = document.querySelector(".chat-identity-addr")?.getAttribute("title") ?? "";
      expect(secondAddress.startsWith("tc:fake-room-")).toBe(true);
      expect(secondAddress).not.toBe(firstAddress);
    });
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
