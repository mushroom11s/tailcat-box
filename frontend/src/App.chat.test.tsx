import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import appSource from "./App.tsx?raw";
import App from "./App";
import ChatPage from "./pages/ChatPage";
import { LocaleProvider } from "./i18n";

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

describe("phase 1 chat shell", () => {
  it("opens Chat, copies the raw address, and echoes text", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderApp();

    const nav = document.querySelectorAll(".nav-btn");
    expect(Array.from(nav).map((node) => node.textContent)).toEqual(["Chat", "Settings"]);
    expect(screen.getByRole("heading", { name: "Tailcat Box" })).toBeTruthy();

    const copy = await screen.findByRole("button", { name: "Copy" });
    await waitFor(() => {
      expect(copy.hasAttribute("disabled")).toBe(false);
    });
    await user.click(copy);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied.startsWith("tc:fake-room-")).toBe(true);
    expect(copied.includes("#invite=")).toBe(false);
    expect(copied.includes("http")).toBe(false);

    await user.type(screen.getByLabelText("Peer"), "nope");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByText("Paste a Tailcat address that starts with tc.")).toBeTruthy();

    await user.clear(screen.getByLabelText("Peer"));
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.type(screen.getByLabelText("Message"), "hi");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("echo")).toBeTruthy();
    expect(screen.queryByText("hi")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText(copied)).toBeTruthy();
  });

  it("keeps the draft when send fails and inserts a newline on Shift+Enter", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "Copy" });
    await user.type(screen.getByLabelText("Peer"), "tc:fake-room-missing");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    const composer = screen.getByLabelText("Message");
    await user.type(composer, "stay");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect((composer as HTMLTextAreaElement).value).toBe("stay");
    await user.click(composer);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect((composer as HTMLTextAreaElement).value).toBe("stay\n");
    await user.clear(composer);
    await user.keyboard("{Enter}");
    expect((composer as HTMLTextAreaElement).value).toBe("");
  });

  it("shows Retry for a room error", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(
      <LocaleProvider>
        <ChatPage address="" peer="" messages={[]} roomError="listen failed" onConnect={vi.fn()} onSend={vi.fn()} onRetry={onRetry} />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("uses 聊天 and 设置 in zh-CN", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    renderApp();
    const nav = document.querySelectorAll(".nav-btn");
    expect(Array.from(nav).map((node) => node.textContent)).toEqual(["聊天", "设置"]);
  });

  it("does not import toolbox pages", () => {
    const src = appSource;
    for (const name of ["ConnectPage", "ServicesPage", "FilesPage", "KeysPage", "DiagnosticsPage"]) {
      expect(src.includes(`pages/${name}`)).toBe(false);
    }
  });

  it("reaches Keys & DERP and Diagnostics inside Settings", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByRole("button", { name: "Copy" });
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Keys & DERP" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Diagnostics" })).toBeTruthy();
    expect(screen.getByLabelText("Room key")).toBeTruthy();
    expect((screen.getByLabelText("Address") as HTMLInputElement).value).toBe("tc:fake-echo");
    await user.type(screen.getByLabelText("Name"), "home");
    await user.click(screen.getByRole("button", { name: "Create key" }));
    await user.selectOptions(screen.getByLabelText("Room key"), "home");
    expect(screen.getByText("Restart room to apply")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Restart room" }));
    await user.click(screen.getByRole("button", { name: "Chat" }));
    await waitFor(() => {
      const shown = document.querySelector(".chat-address")?.textContent ?? "";
      expect(shown.startsWith("tc:fake-room-key-")).toBe(true);
    });
    expect(screen.queryByText("Peer connected")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Services" })).toBeNull();
    expect(document.querySelectorAll(".nav-btn").length).toBe(2);
  });
});
