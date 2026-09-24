import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { startChatRoom, type Session } from "./lib/wails";

vi.mock("./lib/wails", async () => {
  const actual = await vi.importActual<typeof import("./lib/wails")>("./lib/wails");
  return {
    ...actual,
    startChatRoom: vi.fn(actual.startChatRoom),
  };
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const started: Session = {
  ID: "room-busy",
  Kind: "chat",
  Status: "running",
  Address: "tc:fake-room-busy",
  CreatedAt: "",
  Err: "",
  Progress: "",
  Dangerous: false,
};

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
  vi.mocked(startChatRoom).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("lobby room start loading", () => {
  it("disables lobby actions and shows Creating… while a temporary room is starting", async () => {
    const pending = deferred<Session>();
    vi.mocked(startChatRoom).mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderApp();

    await user.click(button("Create temporary room"));

    expect(button("Creating…").disabled).toBe(true);
    expect(button("Create").disabled).toBe(true);
    expect(button("Save key").disabled).toBe(true);
    expect(button("Connect").disabled).toBe(true);
    expect(startChatRoom).toHaveBeenCalledTimes(1);
    expect(startChatRoom).toHaveBeenCalledWith("");

    pending.resolve(started);
    await waitFor(() => {
      expect(document.querySelector(".chat-lobby")).toBeNull();
    });
  });

  it("shows Creating… on the permanent create button and keeps the temporary label", async () => {
    const pending = deferred<Session>();
    vi.mocked(startChatRoom).mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText("New key name"), "home-busy");
    await user.click(button("Save key"));
    expect(await screen.findByRole("option", { name: "home-busy" })).toBeTruthy();

    await user.click(button("Create"));

    expect(button("Creating…").disabled).toBe(true);
    expect(button("Create temporary room").disabled).toBe(true);
    expect(button("Connect").disabled).toBe(true);
    expect(button("Save key").disabled).toBe(true);
    expect(startChatRoom).toHaveBeenCalledTimes(1);
    expect(startChatRoom).toHaveBeenCalledWith("home-busy");

    pending.resolve(started);
    await waitFor(() => {
      expect(document.querySelector(".chat-lobby")).toBeNull();
    });
  });

  it("shows Connecting… while the lobby connect starts a room", async () => {
    const pending = deferred<Session>();
    vi.mocked(startChatRoom).mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText("Peer address (optional)"), "tc:fake-echo");
    await user.click(button("Connect"));

    expect(button("Connecting…").disabled).toBe(true);
    expect(button("Create temporary room").disabled).toBe(true);
    expect(button("Create").disabled).toBe(true);
    expect(button("Save key").disabled).toBe(true);
    expect(startChatRoom).toHaveBeenCalledTimes(1);

    pending.resolve(started);
    await waitFor(() => {
      expect(document.querySelector(".chat-lobby")).toBeNull();
    });
  });

  it("restores the lobby and shows the error when starting a room fails", async () => {
    const pending = deferred<Session>();
    vi.mocked(startChatRoom).mockReturnValue(pending.promise);
    const user = userEvent.setup();
    renderApp();
    await user.click(button("Create temporary room"));
    expect(button("Creating…").disabled).toBe(true);

    pending.reject(new Error("network down"));

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "network down");
    expect(button("Create temporary room").disabled).toBe(false);
    expect(button("Create").disabled).toBe(false);
    expect(button("Save key").disabled).toBe(false);
    expect(button("Connect").disabled).toBe(false);
    expect(document.querySelector(".chat-lobby")).toBeTruthy();
  });

  it("does not enter a loading state for validation errors", async () => {
    vi.mocked(startChatRoom).mockReturnValue(deferred<Session>().promise);
    const user = userEvent.setup();
    renderApp();

    await user.click(button("Create"));
    expect(screen.getByText("Choose a saved key.")).toBeTruthy();
    expect(button("Create").disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Creating…" })).toBeNull();

    await user.type(screen.getByLabelText("Peer address (optional)"), "nope");
    await user.click(button("Connect"));
    expect(screen.getByText("Paste a Tailcat address that starts with tc.")).toBeTruthy();
    expect(button("Connect").disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Connecting…" })).toBeNull();
    expect(startChatRoom).not.toHaveBeenCalled();
  });

  it("uses the Chinese loading copy", async () => {
    const pending = deferred<Session>();
    vi.mocked(startChatRoom).mockReturnValue(pending.promise);
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    renderApp();

    await user.click(button("新建临时房间"));
    expect(button("正在创建…").disabled).toBe(true);
    expect(button("新建").disabled).toBe(true);
    expect(button("保存密钥").disabled).toBe(true);
    expect(button("连接").disabled).toBe(true);

    pending.resolve(started);
    await waitFor(() => {
      expect(document.querySelector(".chat-lobby")).toBeNull();
    });
  });
});
