import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import ChatPage, { type ChatMessage } from "./pages/ChatPage";
import { LocaleProvider } from "./i18n";

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

const burnedText: ChatMessage = {
  id: "burn-1",
  direction: "in",
  type: "text",
  body: "secret",
  burn: true,
  ttlSec: 0,
  at: "2026-09-22T00:00:00.000Z",
};

describe("phase 2 files and burn", () => {
  it("sends a dropped image to an official peer as a full transfer", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "Copy" });
    await user.type(screen.getByLabelText("Peer"), "tc:fake-official");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.selectOptions(screen.getByLabelText("Burn"), "0");
    await user.type(screen.getByLabelText("Message"), "kept");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("They may keep a copy.")).toBeTruthy();

    const file = new File([Uint8Array.from([1, 2, 3, 4])], "pic.png", { type: "image/png" });
    fireEvent.drop(window, { dataTransfer: { files: [file], types: ["Files"] } });
    expect(await screen.findByText("Full transfer — this peer cannot resume.")).toBeTruthy();
    expect(await screen.findByRole("img", { name: "pic.png" })).toBeTruthy();
  });

  it("uses the burn badge when the peer advertises burn", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "Copy" });
    await user.type(screen.getByLabelText("Peer"), "tc:fake-box");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.selectOptions(screen.getByLabelText("Burn"), "5");
    await user.type(screen.getByLabelText("Message"), "gone");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Removed on their side after they open it.")).toBeTruthy();
  });

  it("keeps a burned message collapsed until Reveal, then discards it", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    render(
      <LocaleProvider>
        <ChatPage
          address="tc:room"
          peer="tc:peer"
          messages={[burnedText]}
          roomError=""
          onConnect={vi.fn()}
          onSend={vi.fn()}
          onDiscard={onDiscard}
          onRetry={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.getByText("Burn after reading")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reveal" }));
    expect(screen.getByText("secret")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDiscard).toHaveBeenCalledWith("burn-1");
  });

  it("discards a burned message when the countdown reaches zero", async () => {
    vi.useFakeTimers();
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    render(
      <LocaleProvider>
        <ChatPage
          address="tc:room"
          peer="tc:peer"
          messages={[{ ...burnedText, ttlSec: 2 }]}
          roomError=""
          onConnect={vi.fn()}
          onSend={vi.fn()}
          onDiscard={onDiscard}
          onRetry={vi.fn()}
        />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(screen.getByText("secret")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(onDiscard).toHaveBeenCalledWith("burn-1");
  });

  it("shows resume progress and Resend on a failed transfer", () => {
    render(
      <LocaleProvider>
        <ChatPage
          address="tc:room"
          peer="tc:peer"
          messages={[]}
          transfers={[
            {
              id: "t1",
              offset: 32,
              size: 40,
              mode: "resume",
              status: "error",
              error: "Could not reach peer. Check the address and that they are online.",
            },
          ]}
          roomError=""
          onConnect={vi.fn()}
          onSend={vi.fn()}
          onResend={vi.fn()}
          onRetry={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText("32 / 40")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resend" })).toBeTruthy();
    expect(screen.getByText("Could not reach peer. Check the address and that they are online.")).toBeTruthy();
  });

  it("shows the save warning on a burned file", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    render(
      <LocaleProvider>
        <ChatPage
          address="tc:room"
          peer="tc:peer"
          messages={[
            {
              id: "file-1",
              direction: "in",
              type: "file",
              name: "notes.txt",
              mime: "text/plain",
              size: 4,
              burn: true,
              ttlSec: 0,
              at: "2026-09-22T00:00:00.000Z",
            },
          ]}
          roomError=""
          onConnect={vi.fn()}
          onSend={vi.fn()}
          onSave={onSave}
          onDiscard={onDiscard}
          onRetry={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByText("Saving a copy keeps the file on disk.")).toBeTruthy();
    expect(screen.queryByText("notes.txt · 4")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("file-1");
    expect(onDiscard).toHaveBeenCalledWith("file-1");
  });
});
