import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { NICKNAME_KEY } from "./lib/roomLabel";
import { emitBrowserEvent, listSessions, resetBrowserRooms } from "./lib/wails";

beforeEach(() => {
  resetBrowserRooms();
  localStorage.setItem("tailcat-locale", "en");
  localStorage.removeItem(NICKNAME_KEY);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(NICKNAME_KEY);
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
    const peer = await screen.findByLabelText("Peer");
    expect((peer as HTMLInputElement).value).toBe("tc:fake-echo");
    expect(screen.queryByText("Peer connected")).toBeNull();
    expect(document.querySelector(".chat-page")).toBeTruthy();
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
    expect(await screen.findByText("Peer connected")).toBeTruthy();
    expect((await listSessions()).filter((item) => item.Kind === "chat")).toHaveLength(1);
  });

  it("routes an event to the other room and returns to the last room from Chat", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const firstAddress = (await screen.findByText(/^tc:fake-room-/)).textContent ?? "";
    await user.click(screen.getByRole("button", { name: "+ New room" }));
    expect(document.querySelector(".chat-lobby")).toBeTruthy();
    expect(document.querySelectorAll(".nav-child:not(.nav-new)")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const secondAddress = (await screen.findByText(/^tc:fake-room-/)).textContent ?? "";
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
    expect(screen.getByText(firstAddress)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText("only-first")).toBeTruthy();
    expect(document.querySelector(".chat-lobby")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText(firstAddress)).toBeTruthy();
  });

  it("labels rooms with the settings nickname and keeps that name off the transcript", async () => {
    localStorage.setItem(NICKNAME_KEY, "Alice");
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    expect(await screen.findByRole("button", { name: "Alice" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "+ New room" }));
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const labeled = await screen.findAllByRole("button", { name: /Alice · tc…/ });
    expect(labeled).toHaveLength(2);
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "ping");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("echo")).toBeTruthy();
    const log = document.querySelector(".chat-log")?.textContent ?? "";
    expect(log.includes("Alice")).toBe(false);
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
    expect(await screen.findByText("You can keep 8 rooms open. Quit the app to close rooms.")).toBeTruthy();
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
  });
});
