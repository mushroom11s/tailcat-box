import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { emitBrowserEvent, listSessions, resetBrowserRooms } from "./lib/wails";
import { ROOM_PINS_KEY } from "./lib/roomPins";

beforeEach(() => {
  resetBrowserRooms();
  localStorage.setItem("tailcat-locale", "en");
  localStorage.removeItem(ROOM_PINS_KEY);
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(ROOM_PINS_KEY);
});

function renderApp() {
  const view = render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
  fireEvent.click(document.querySelector(".nav-chat > .nav-btn") as HTMLElement);
  return view;
}

function abbrev(address: string): string {
  return address.length <= 8 ? address : `tc…${address.slice(-4)}`;
}

async function waitRoomAddress(): Promise<string> {
  let address = "";
  await waitFor(() => {
    address = document.querySelector(".chat-identity-addr")?.getAttribute("title")?.trim() || document.querySelector(".chat-address")?.textContent?.trim() || "";
    expect(address.startsWith("tc:fake-room-")).toBe(true);
  });
  return address;
}

describe("chat search and room pins", () => {
  it("filters the current room and highlights the match", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    await waitRoomAddress();
    const details = screen.queryByRole("button", { name: "Show room details" });
    if (details) {
      await user.click(details);
    }
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "alpha-cat");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("echo")).toBeTruthy();
    expect(screen.getByText("alpha-cat")).toBeTruthy();

    await user.type(screen.getByRole("searchbox", { name: "Search messages" }), "ALPHA");
    expect(screen.getByText("alpha").classList.contains("chat-hit")).toBe(true);
    expect(screen.queryByText("echo")).toBeNull();

    await user.clear(screen.getByRole("searchbox", { name: "Search messages" }));
    await user.type(screen.getByRole("searchbox", { name: "Search messages" }), "missing-word");
    expect(screen.getByText("No messages match.")).toBeTruthy();
    expect(screen.queryByText("alpha-cat")).toBeNull();
  });

  it("does not reveal a sealed burn message through search", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const address = await waitRoomAddress();
    const chats = (await listSessions()).filter((item) => item.Kind === "chat");
    const room = chats.find((item) => item.Address === address);
    emitBrowserEvent({
      SessionID: room?.ID ?? "",
      Kind: "message",
      Data: JSON.stringify({
        id: "sealed-1",
        direction: "in",
        type: "text",
        burn: true,
        body: "secret-burn",
        at: "2026-09-23T00:00:00.000Z",
      }),
    });
    expect(await screen.findByText("Burn after reading")).toBeTruthy();
    expect(screen.queryByText("secret-burn")).toBeNull();
    await user.type(screen.getByRole("searchbox", { name: "Search messages" }), "secret-burn");
    expect(screen.getByText("No messages match.")).toBeTruthy();
    expect(screen.queryByText("secret-burn")).toBeNull();
  });

  it("keeps a pinned room above the others and remembers the pin", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const first = await waitRoomAddress();
    await user.click(screen.getByRole("button", { name: "+ New room" }));
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    const second = await waitRoomAddress();
    const rows = () => [...document.querySelectorAll(".nav-room-list .nav-room-primary")].map((node) => node.textContent);
    expect(rows()[0]).toBe(abbrev(second));

    await user.click(screen.getByRole("button", { name: `Pin ${abbrev(first)}` }));
    expect(rows()[0]).toBe(abbrev(first));
    expect(rows()[1]).toBe(abbrev(second));
    expect(screen.getByRole("button", { name: `Unpin ${abbrev(first)}` }).getAttribute("aria-pressed")).toBe("true");
    const stored = JSON.parse(localStorage.getItem(ROOM_PINS_KEY) ?? "[]") as string[];
    expect(stored).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: `Unpin ${abbrev(first)}` }));
    const after = [...document.querySelectorAll(".nav-room-list .nav-room-primary")].map((node) => node.textContent);
    expect(after[0]).toBe(abbrev(second));
    expect(localStorage.getItem(ROOM_PINS_KEY)).toBe("[]");
  });
});
