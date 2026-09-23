import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { NICKNAME_KEY } from "./lib/nickname";
import { REMARKS_KEY, REMARK_MAX, applyRemark, type RemarkMap } from "./lib/remark";
import { resetBrowserRooms } from "./lib/wails";
import ChatPage, { type ChatMessage } from "./pages/ChatPage";

const messages: ChatMessage[] = [
  { id: "out-1", direction: "out", type: "text", body: "hi", at: "2026-09-23T00:00:00Z" },
  { id: "in-1", direction: "in", type: "text", body: "yo", at: "2026-09-23T00:00:01Z" },
  { id: "in-2", direction: "in", type: "text", body: "other", at: "2026-09-23T00:00:02Z", peer: "tc:other" },
];

beforeEach(() => {
  resetBrowserRooms();
  localStorage.clear();
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function labels(direction: "in" | "out"): string[] {
  return [...document.querySelectorAll(`.chat-bubble.${direction} .chat-who`)].map((el) => el.textContent ?? "");
}

function RemarkChat({
  peer = "tc:peer",
  nickname,
  initial,
}: {
  peer?: string;
  nickname?: string;
  initial?: RemarkMap;
}) {
  const [remarks, setRemarks] = useState<RemarkMap>(initial ?? {});
  return (
    <LocaleProvider>
      <ChatPage
        address="tc:room"
        peer={peer}
        messages={messages}
        roomError=""
        nickname={nickname}
        remarks={remarks}
        onRemark={(address, raw, commit) => setRemarks((prev) => applyRemark(prev, address, raw, commit))}
        onConnect={async () => {}}
        onSend={async () => {}}
        onRetry={async () => {}}
      />
    </LocaleProvider>
  );
}

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

describe("peer remarks", () => {
  it("keeps Peer and You when no remark is stored", () => {
    render(<RemarkChat />);
    expect(labels("in")).toEqual(["Peer", "Peer"]);
    expect(labels("out")).toEqual(["You"]);
    expect(screen.getByText("yo").textContent).toBe("yo");
  });

  it("labels inbound bubbles from the current peer and from a message peer", () => {
    render(<RemarkChat initial={{ "tc:peer": "Bob", "tc:other": "崔" }} />);
    expect(labels("in")).toEqual(["Bob", "崔"]);
    expect(labels("out")).toEqual(["You"]);
  });

  it("sets, then clears, a remark without changing an outgoing nickname", async () => {
    const user = userEvent.setup();
    render(<RemarkChat nickname="Mochi" />);
    expect(labels("out")).toEqual(["Mochi"]);
    expect(labels("in")[0]).toBe("Peer");
    const field = screen.getByLabelText("Remark");
    await user.type(field, "Bob");
    expect(labels("in")).toEqual(["Bob", "Peer"]);
    expect(labels("out")).toEqual(["Mochi"]);
    await user.clear(field);
    fireEvent.blur(field);
    expect(labels("in")).toEqual(["Peer", "Peer"]);
    expect(labels("out")).toEqual(["Mochi"]);
    expect(screen.getByText("hi").textContent).toBe("hi");
  });

  it("uses 对方 until a remark is set in zh-CN", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    render(<RemarkChat />);
    expect(labels("out")).toEqual(["我"]);
    expect(labels("in")[0]).toBe("对方");
    expect(screen.getByLabelText("备注")).toBeTruthy();
    expect(screen.getByText("只存在这台设备上，对应这个地址。对方看不到。这不是你的昵称。")).toBeTruthy();
    await user.type(screen.getByLabelText("备注"), "小满");
    expect(labels("in")[0]).toBe("小满");
    expect(labels("out")).toEqual(["我"]);
  });

  it("stays disabled until the peer field has a tc address, including before connect", async () => {
    const user = userEvent.setup();
    render(<RemarkChat peer="" />);
    const field = screen.getByLabelText("Remark") as HTMLInputElement;
    expect(field.disabled).toBe(true);
    await user.type(screen.getByLabelText("Peer"), "nope");
    expect(field.disabled).toBe(true);
    await user.clear(screen.getByLabelText("Peer"));
    await user.type(screen.getByLabelText("Peer"), "tc:alice");
    expect(field.disabled).toBe(false);
    await user.type(field, "Ann");
    expect(field.value).toBe("Ann");
    expect(labels("in")).toEqual(["Peer", "Peer"]);
  });

  it("strips controls, trims on blur, and caps the field at 32 characters", () => {
    render(<RemarkChat />);
    const field = screen.getByLabelText("Remark") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "  Mo\u0000chi\n  " } });
    expect(field.value).toBe("  Mochi  ");
    expect(labels("in")[0]).toBe("Mochi");
    fireEvent.blur(field);
    expect(field.value).toBe("Mochi");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.blur(field);
    expect(field.value).toBe("");
    expect(labels("in")[0]).toBe("Peer");
    fireEvent.change(field, { target: { value: "😀".repeat(40) } });
    expect(field.value).toBe("😀".repeat(REMARK_MAX));
  });

  it("persists a remark across reload and leaves You / the nickname on outgoing bubbles", async () => {
    const user = userEvent.setup();
    localStorage.setItem(NICKNAME_KEY, "Mochi");
    const first = renderApp();
    await user.type(screen.getByLabelText("Peer address (optional)"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Peer connected")).toBeTruthy();
    const field = screen.getByLabelText("Remark");
    expect(screen.getByText("Only on this device, for this address. The other person never sees it. This is not your nickname.")).toBeTruthy();
    await user.type(field, "Bob");
    fireEvent.blur(field);
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(REMARKS_KEY) ?? "{}")).toEqual({ "tc:fake-echo": "Bob" });
    });
    expect(screen.getByRole("button", { name: "Bob", exact: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mochi", exact: true })).toBeNull();
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("echo")).toBeTruthy();
    expect(labels("out")[0]).toBe("Mochi");
    expect(labels("in")).toEqual(["Bob"]);
    expect(screen.getByText("hi").textContent).toBe("hi");
    expect(screen.getByText("echo").textContent).toBe("echo");
    first.unmount();

    renderApp();
    await user.type(screen.getByLabelText("Peer address (optional)"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Peer connected")).toBeTruthy();
    expect((screen.getByLabelText("Remark") as HTMLInputElement).value).toBe("Bob");
    expect(screen.getByRole("button", { name: "Bob", exact: true })).toBeTruthy();
    await user.clear(screen.getByLabelText("Remark"));
    fireEvent.blur(screen.getByLabelText("Remark"));
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(REMARKS_KEY) ?? "{}")).toEqual({});
    });
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("echo")).toBeTruthy();
    expect(labels("out")[0]).toBe("Mochi");
    expect(labels("in")).toEqual(["Peer"]);
    expect(screen.queryByRole("button", { name: "Bob", exact: true })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mochi", exact: true })).toBeNull();
  });

  it("uses the peer remark as the room label and suffixes it when two rooms share it", async () => {
    localStorage.setItem(NICKNAME_KEY, "Alice");
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const first = (await screen.findByText(/^tc:fake-room-/)).textContent ?? "";
    expect(screen.getByRole("button", { name: abbrev(first), exact: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Alice", exact: true })).toBeNull();
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.type(screen.getByLabelText("Remark"), "Bob");
    fireEvent.blur(screen.getByLabelText("Remark"));
    expect(screen.getByRole("button", { name: abbrev(first), exact: true })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Peer connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bob", exact: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Alice", exact: true })).toBeNull();

    await user.click(screen.getByRole("button", { name: "+ New room" }));
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const second = (await screen.findByText(/^tc:fake-room-/)).textContent ?? "";
    expect(second).not.toBe(first);
    await user.type(screen.getByLabelText("Peer"), "tc:fake-official");
    await user.type(screen.getByLabelText("Remark"), "Bob");
    fireEvent.blur(screen.getByLabelText("Remark"));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByText("Peer connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: `Bob · ${abbrev(first)}`, exact: true })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Bob · ${abbrev(second)}`, exact: true })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Alice", exact: true })).toBeNull();
    expect(screen.queryByRole("button", { name: /Alice ·/ })).toBeNull();
  });
});
