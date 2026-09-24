import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { NICKNAME_KEY, NICKNAME_MAX } from "./lib/nickname";
import ChatPage, { type ChatMessage } from "./pages/ChatPage";

const messages: ChatMessage[] = [
  { id: "out-1", direction: "out", type: "text", body: "hi", at: "2026-09-23T00:00:00Z" },
  { id: "in-1", direction: "in", type: "text", body: "yo", at: "2026-09-23T00:00:01Z" },
];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function renderApp() {
  const view = render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
  fireEvent.click(document.querySelector(".nav-chat > .nav-btn") as HTMLElement);
  return view;
}

function renderChat(nickname?: string) {
  return render(
    <LocaleProvider>
      <ChatPage
        address="tc:room"
        peer="tc:peer"
        messages={messages}
        roomError=""
        nickname={nickname}
        onConnect={async () => {}}
        onSend={async () => {}}
        onRetry={async () => {}}
      />
    </LocaleProvider>,
  );
}

function label(direction: "in" | "out"): string {
  return document.querySelector(`.chat-bubble.${direction} .chat-who`)?.textContent ?? "";
}

describe("local nickname", () => {
  it("keeps You and Peer when the nickname is empty", () => {
    renderChat("   ");
    expect(label("out")).toBe("You");
    expect(label("in")).toBe("Peer");
    expect(screen.getByText("hi").textContent).toBe("hi");
  });

  it("labels only outgoing bubbles with the nickname", () => {
    renderChat("Mochi");
    expect(label("out")).toBe("Mochi");
    expect(label("in")).toBe("Peer");
    expect(screen.getByText("hi").textContent).toBe("hi");
  });

  it("uses 我 until a nickname is set in zh-CN", () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    renderChat();
    expect(label("out")).toBe("我");
    expect(label("in")).toBe("对方");
    cleanup();
    renderChat("小满");
    expect(label("out")).toBe("小满");
    expect(label("in")).toBe("对方");
  });

  it("shows You on a sent bubble when nothing is stored", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    await screen.findByRole("button", { name: "Copy" });
    await user.click(screen.getByRole("button", { name: "Show room details" }));
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("hi")).toBeTruthy();
    expect(label("out")).toBe("You");
    expect(label("in")).toBe("Peer");
  });

  it("persists the nickname from Settings and uses it on outgoing bubbles", async () => {
    const user = userEvent.setup();
    const first = await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy();
    const field = screen.getByLabelText("Nickname");
    expect(
      screen.getByText("Stored only on this device. It is never sent to the other person."),
    ).toBeTruthy();
    await user.type(field, "Mochi");
    await waitFor(() => {
      expect(localStorage.getItem(NICKNAME_KEY)).toBe("Mochi");
    });

    await user.click(screen.getByRole("button", { name: "Chat" }));
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    await screen.findByRole("button", { name: "Copy" });
    await user.click(screen.getByRole("button", { name: "Show room details" }));
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("hi")).toBeTruthy();
    expect(label("out")).toBe("Mochi");
    expect(label("in")).toBe("Peer");
    first.unmount();

    await renderApp();
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect((screen.getByLabelText("Nickname") as HTMLInputElement).value).toBe("Mochi");
  });

  it("strips controls, trims on blur, and caps the field at 32 characters", async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const field = screen.getByLabelText("Nickname") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "  Mo\u0000chi\n  " } });
    expect(field.value).toBe("  Mochi  ");
    fireEvent.blur(field);
    expect(field.value).toBe("Mochi");
    expect(localStorage.getItem(NICKNAME_KEY)).toBe("Mochi");

    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.blur(field);
    expect(field.value).toBe("");
    expect(localStorage.getItem(NICKNAME_KEY)).toBe("");

    fireEvent.change(field, { target: { value: "😀".repeat(40) } });
    expect(field.value).toBe("😀".repeat(NICKNAME_MAX));
  });

  it("shows the Chinese label and helper", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "个人" })).toBeTruthy();
    expect(screen.getByLabelText("昵称")).toBeTruthy();
    expect(screen.getByText("只保存在这台设备上，不会发给对方。")).toBeTruthy();
  });
});
