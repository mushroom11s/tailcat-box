import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { emitBrowserEvent, listSessions, resetBrowserRooms } from "./lib/wails";

const SELF_NICKNAME_KEY = "tailcat-nickname";

beforeEach(() => {
  resetBrowserRooms();
  localStorage.setItem("tailcat-locale", "en");
  localStorage.removeItem(SELF_NICKNAME_KEY);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(SELF_NICKNAME_KEY);
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

function abbrev(address: string): string {
  return address.length <= 8 ? address : `tc…${address.slice(-4)}`;
}

function shownRoomAddress(): string {
  return (
    document.querySelector(".chat-address")?.textContent?.trim() ||
    document.querySelector(".chat-identity-addr")?.getAttribute("title")?.trim() ||
    ""
  );
}

async function waitRoomAddress(): Promise<string> {
  let address = "";
  await waitFor(() => {
    address = shownRoomAddress();
    expect(address.startsWith("tc:fake-room-")).toBe(true);
  });
  return address;
}

async function openRoomDetails(user: { click: (el: Element) => Promise<void> }) {
  const button = screen.queryByRole("button", { name: "Show room details" });
  if (button) {
    await user.click(button);
  }
}

describe("phase A multi-room lobby", () => {
  it("cold launch shows the lobby and starts no chat listener", async () => {
    renderApp();
    expect(screen.getByRole("heading", { name: "New room" })).toBeTruthy();
    expect(screen.getByText("Leave the peer empty to open a room and share your address later.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    await waitFor(async () => {
      const sessions = await listSessions();
      expect(sessions.filter((item) => item.Kind === "chat")).toHaveLength(0);
    });
  });

  it("creates an ephemeral room without connecting, and keeps typed peer text unsent", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText("Peer address (optional)"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    await openRoomDetails(user);
    const peer = await screen.findByLabelText("Peer");
    expect((peer as HTMLInputElement).value).toBe("tc:fake-echo");
    expect(screen.queryByText("Peer connected")).toBeNull();
    expect(document.querySelector(".chat-page")).toBeTruthy();
    expect(document.querySelector(".nav-new")?.classList.contains("active")).toBe(false);
    expect(document.querySelector(".nav-new")?.classList.contains("open")).toBe(false);
    expect(document.querySelectorAll(".nav-child:not(.nav-new)")).toHaveLength(1);
    const sessions = await listSessions();
    expect(sessions.filter((item) => item.Kind === "chat")).toHaveLength(1);
  });

  it("connects from the lobby into a new ephemeral room and rejects a bad address", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText("Peer address (optional)"), "nope");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Paste a Tailcat address that starts with tc.")).toBeTruthy();
    expect(document.querySelector(".chat-lobby")).toBeTruthy();
    expect((await listSessions()).filter((item) => item.Kind === "chat")).toHaveLength(0);

    await user.clear(screen.getByLabelText("Peer address (optional)"));
    await user.type(screen.getByLabelText("Peer address (optional)"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.click(await screen.findByRole("button", { name: "Show room details" }));
    expect(screen.getByText("Peer connected")).toBeTruthy();
    expect((await listSessions()).filter((item) => item.Kind === "chat")).toHaveLength(1);
  });

  it("routes an event to the other room and returns to the last room from Chat", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const firstAddress = await waitRoomAddress();
    await user.click(screen.getByRole("button", { name: "+ New room" }));
    expect(document.querySelector(".nav-new")?.classList.contains("active")).toBe(false);
    expect(document.querySelector(".nav-new")?.classList.contains("open")).toBe(true);
    expect(document.querySelector(".chat-lobby")).toBeTruthy();
    expect(document.querySelectorAll(".nav-child:not(.nav-new)")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const secondAddress = await waitRoomAddress();
    expect(secondAddress).not.toBe(firstAddress);

    const chats = (await listSessions()).filter((item) => item.Kind === "chat");
    const hidden = chats.find((item) => item.Address === firstAddress);
    expect(hidden).toBeTruthy();
    emitBrowserEvent({
      SessionID: hidden?.ID ?? "",
      Kind: "message",
      Data: JSON.stringify({ id: "only-first", direction: "in", type: "text", body: "only-first", at: "2026-09-23T00:00:00.000Z" }),
    });
    expect(screen.queryByText("only-first")).toBeNull();
    await user.click(screen.getByRole("button", { name: abbrev(firstAddress) }));
    expect(await screen.findByText("only-first")).toBeTruthy();
    expect(shownRoomAddress()).toBe(firstAddress);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText("only-first")).toBeTruthy();
    expect(document.querySelector(".chat-lobby")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(shownRoomAddress()).toBe(firstAddress);
  });

  it("labels rooms with the address abbreviation and outgoing bubbles with the self nickname", async () => {
    localStorage.setItem(SELF_NICKNAME_KEY, "Alice");
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const address = await waitRoomAddress();
    expect(screen.getByRole("button", { name: abbrev(address) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Alice" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Alice ·/ })).toBeNull();
    await openRoomDetails(user);
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "ping");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("echo")).toBeTruthy();
    expect(document.querySelector(".chat-bubble.out .chat-who")?.textContent).toBe("Alice");
    expect(document.querySelector(".chat-bubble.in .chat-who")?.textContent).toBe("Peer");
    expect(screen.getByText("ping").textContent).toBe("ping");
    expect(screen.getByText("echo").textContent).toBe("echo");
  });

  it("refuses the 9th room and lists every chat session", async () => {
    const user = userEvent.setup();
    renderApp();
    for (let i = 0; i < 8; i += 1) {
      if (i > 0) {
        await user.click(screen.getByRole("button", { name: "+ New room" }));
      }
      await user.click(screen.getByRole("button", { name: "Create temporary room" }));
      await screen.findByRole("button", { name: "Copy" });
    }
    await user.click(screen.getByRole("button", { name: "+ New room" }));
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    expect(await screen.findByText("You can keep 8 rooms open. Close one to start another.")).toBeTruthy();
    expect(document.querySelector(".chat-lobby")).toBeTruthy();
    expect(document.querySelectorAll(".nav-child:not(.nav-new)")).toHaveLength(8);
    expect((await listSessions()).filter((item) => item.Kind === "chat")).toHaveLength(8);

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Chat sessions" })).toBeTruthy();
    expect(screen.getAllByText(/^tc:fake-room-/)).toHaveLength(8);
  });

  it("uses the Chinese lobby strings", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    renderApp();
    expect(screen.getByRole("heading", { name: "新房间" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ 新房间" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建临时房间" })).toBeTruthy();
    expect(screen.getByText("对方地址可以留空，先开房间，稍后再把地址发给对方。")).toBeTruthy();
    expect(screen.getByText("连接会新建一个临时房间。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "固定密钥" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存密钥" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建" })).toBeTruthy();
  });

  it("creates a permanent room from a saved key and leaves the peer unsent", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByText("Choose a saved key.")).toBeTruthy();
    expect((await listSessions()).filter((item) => item.Kind === "chat")).toHaveLength(0);

    await user.type(screen.getByLabelText("New key name"), "home");
    await user.click(screen.getByRole("button", { name: "Save key" }));
    expect(await screen.findByRole("option", { name: "home" })).toBeTruthy();
    expect((screen.getByLabelText("Saved key") as HTMLSelectElement).value).toBe("home");
    await user.type(screen.getByLabelText("Peer address (optional)"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await openRoomDetails(user);
    const peer = await screen.findByLabelText("Peer");
    expect((peer as HTMLInputElement).value).toBe("tc:fake-echo");
    expect(screen.queryByText("Peer connected")).toBeNull();
    expect(document.querySelector(".nav-room-key")?.textContent).toBe("home");

    await user.click(screen.getByRole("button", { name: "+ New room" }));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("That key is already listening in another room.")).toBeTruthy();
    expect((await listSessions()).filter((item) => item.Kind === "chat")).toHaveLength(1);
  });

  it("closes an empty room immediately and confirms before discarding messages", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const first = await waitRoomAddress();
    await user.click(screen.getByRole("button", { name: "+ New room" }));
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const second = await waitRoomAddress();
    expect(second).not.toBe(first);

    const closeSecond = screen.getByRole("button", { name: `Close ${abbrev(second)}` });
    expect(closeSecond.closest(".nav-room-row")?.querySelector(".nav-btn")?.contains(closeSecond)).toBe(false);
    expect(closeSecond.querySelector("svg")).toBeTruthy();
    expect(closeSecond.textContent?.trim()).toBe("");
    expect(document.querySelector(".chat-room-close")).toBeNull();
    await user.click(closeSecond);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => {
      expect(shownRoomAddress()).toBe(first);
    });
    expect(document.querySelectorAll(".nav-child:not(.nav-new)")).toHaveLength(1);

    const chats = (await listSessions()).filter((item) => item.Kind === "chat");
    emitBrowserEvent({
      SessionID: chats[0]?.ID ?? "",
      Kind: "message",
      Data: JSON.stringify({
        id: "sys-only",
        direction: "system",
        type: "system",
        code: "hear-meow",
        body: "they're hear meow",
        at: "2026-09-23T00:00:00.000Z",
      }),
    });
    expect(await screen.findByText("they're hear meow")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: `Close ${abbrev(first)}` }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("heading", { name: "New room" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    await screen.findByRole("button", { name: "Copy" });
    await openRoomDetails(user);
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "stay");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("echo")).toBeTruthy();
    const live = shownRoomAddress();
    await user.click(screen.getByRole("button", { name: `Close ${abbrev(live)}` }));
    expect(screen.getByText("Close this room? It stops listening and this device's transcript is discarded. Your peer is not notified.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("echo")).toBeTruthy();
    expect((await listSessions()).filter((item) => item.Kind === "chat")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: `Close ${abbrev(live)}` }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("heading", { name: "New room" })).toBeTruthy();
    expect((await listSessions()).filter((item) => item.Kind === "chat")).toHaveLength(0);
  });

  it("restarts only the room open before Settings and leaves the other room's transcript and peer", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    await openRoomDetails(user);
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "alpha-only");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("alpha-only")).toBeTruthy();
    const firstAddress = await waitRoomAddress();

    await user.click(screen.getByRole("button", { name: "+ New room" }));
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    await openRoomDetails(user);
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "beta-only");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("beta-only")).toBeTruthy();
    expect(screen.queryByText("alpha-only")).toBeNull();
    const secondAddress = await waitRoomAddress();
    expect(secondAddress).not.toBe(firstAddress);
    expect(screen.getByText("Peer connected")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByText(`Restarts this room only: ${secondAddress}. Other rooms stay connected.`)).toBeTruthy();
    await user.type(screen.getByLabelText("Name"), "home");
    await user.click(screen.getByRole("button", { name: "Create key" }));
    await user.selectOptions(screen.getByLabelText("Room key"), "home");
    expect(screen.getByText("Restart room to apply")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restart room" }));

    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByText("beta-only")).toBeTruthy();
    expect(screen.getByText("Room restarted. Send the new address.")).toBeTruthy();
    expect(screen.queryByText("alpha-only")).toBeNull();
    await openRoomDetails(user);
    expect(screen.queryByText("Peer connected")).toBeNull();
    await waitFor(() => {
      expect(shownRoomAddress().startsWith("tc:fake-room-key-")).toBe(true);
    });
    const restartedAddress = shownRoomAddress();
    expect(restartedAddress).not.toBe(secondAddress);

    await user.click(screen.getByRole("button", { name: abbrev(firstAddress) }));
    expect(await screen.findByText("alpha-only")).toBeTruthy();
    expect(screen.queryByText("beta-only")).toBeNull();
    expect(screen.queryByText("Room restarted. Send the new address.")).toBeNull();
    expect(shownRoomAddress()).toBe(firstAddress);
    await openRoomDetails(user);
    expect(screen.getByText("Peer connected")).toBeTruthy();
    expect((await listSessions()).filter((item) => item.Kind === "chat")).toHaveLength(2);
    expect(screen.getByRole("button", { name: `${abbrev(restartedAddress)} home` })).toBeTruthy();
  });
});
