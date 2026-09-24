import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

async function renderApp() {
  const view = render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
  fireEvent.click(document.querySelector(".nav-chat > .nav-btn") as HTMLElement);
  return view;
}

function button(name: string): HTMLButtonElement {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

function panelByHeading(name: string): HTMLElement {
  const panel = screen.getByRole("heading", { name }).closest(".chat-lobby-panel");
  if (!(panel instanceof HTMLElement)) {
    throw new Error(`missing panel ${name}`);
  }
  return panel;
}

function connectPanel(label: string): HTMLElement {
  const panel = screen.getByLabelText(label).closest(".chat-lobby-panel");
  if (!(panel instanceof HTMLElement)) {
    throw new Error("missing connect panel");
  }
  return panel;
}

function panelCat(panel: HTMLElement, label: string): HTMLElement {
  const cat = panel.querySelector(".chat-lobby-busy .loading-cat.block");
  if (!(cat instanceof HTMLElement) || !cat.textContent?.includes(label)) {
    throw new Error(`missing panel cat ${label}`);
  }
  return cat;
}

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
  vi.mocked(startChatRoom).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("lobby room start loading", () => {
  it("disables lobby actions and keeps the temporary create label while a room is starting", async () => {
    const pending = deferred<Session>();
    vi.mocked(startChatRoom).mockReturnValue(pending.promise);
    const user = userEvent.setup();
    await renderApp();

    await user.click(button("Create temporary room"));

    const create = button("Create temporary room");
    expect(create.disabled).toBe(true);
    expect(create.textContent).toBe("Create temporary room");
    expect(create.querySelector(".loading-cat")).toBeNull();
    expect(screen.queryByRole("button", { name: "Creating…" })).toBeNull();
    const tempCat = panelCat(panelByHeading("Temporary room"), "Creating…");
    expect(tempCat.querySelector("img")?.getAttribute("src")).toContain("loading-cat");
    expect(panelByHeading("Permanent key").querySelector(".chat-lobby-busy")).toBeNull();
    expect(connectPanel("Peer address (optional)").querySelector(".chat-lobby-busy")).toBeNull();
    expect(button("Restart room").disabled).toBe(true);
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
    await renderApp();
    await user.type(screen.getByLabelText("New key name"), "home-busy");
    await user.click(button("Save key"));
    expect(await screen.findByRole("option", { name: "home-busy" })).toBeTruthy();

    await user.click(button("Restart room"));

    expect(button("Creating…").disabled).toBe(true);
    expect(button("Creating…").querySelector("img")?.getAttribute("src")).toContain("loading-cat");
    const permanentCat = panelCat(panelByHeading("Permanent key"), "Creating…");
    expect(permanentCat.querySelector("img")?.getAttribute("src")).toContain("loading-cat");
    expect(panelByHeading("Temporary room").querySelector(".chat-lobby-busy")).toBeNull();
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
    await renderApp();
    await user.type(screen.getByLabelText("Peer address (optional)"), "tc:fake-echo");
    await user.click(button("Connect"));

    expect(button("Connecting…").disabled).toBe(true);
    expect(button("Connecting…").querySelector("img")?.getAttribute("src")).toContain("loading-cat");
    const connectCat = panelCat(connectPanel("Peer address (optional)"), "Connecting…");
    expect(connectCat.querySelector("img")?.getAttribute("src")).toContain("loading-cat");
    expect(panelByHeading("Temporary room").querySelector(".chat-lobby-busy")).toBeNull();
    expect(panelByHeading("Permanent key").querySelector(".chat-lobby-busy")).toBeNull();
    expect(button("Create temporary room").disabled).toBe(true);
    expect(button("Restart room").disabled).toBe(true);
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
    await renderApp();
    await user.click(button("Create temporary room"));
    const create = button("Create temporary room");
    expect(create.disabled).toBe(true);
    expect(create.textContent).toBe("Create temporary room");
    expect(create.querySelector(".loading-cat")).toBeNull();
    expect(screen.queryByRole("button", { name: "Creating…" })).toBeNull();

    pending.reject(new Error("network down"));

    const alert = await screen.findByRole("alert");
    expect(alert.closest(".toast-stack")).toBeTruthy();
    expect(alert.querySelector(".toast-message")?.textContent).toBe("network down");
    expect(document.querySelector(".chat-lobby .err")).toBeNull();
    expect(panelByHeading("Temporary room").querySelector(".chat-lobby-busy")).toBeNull();
    expect(button("Create temporary room").disabled).toBe(false);
    expect(button("Restart room").disabled).toBe(false);
    expect(button("Save key").disabled).toBe(false);
    expect(button("Connect").disabled).toBe(false);
    expect(document.querySelector(".chat-lobby")).toBeTruthy();
  });

  it("does not enter a loading state for validation errors", async () => {
    vi.mocked(startChatRoom).mockReturnValue(deferred<Session>().promise);
    const user = userEvent.setup();
    await renderApp();

    await user.click(button("Restart room"));
    const keyAlert = screen.getByText("Choose a saved key.");
    expect(keyAlert.closest(".chat-lobby")).toBeTruthy();
    expect(keyAlert.closest(".toast-stack")).toBeNull();
    expect(button("Restart room").disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Creating…" })).toBeNull();
    expect(document.querySelector(".chat-lobby-busy")).toBeNull();

    await user.type(screen.getByLabelText("Peer address (optional)"), "nope");
    await user.click(button("Connect"));
    const addrAlert = screen.getByText("Paste a Tailcat address that starts with tc.");
    expect(addrAlert.closest(".chat-lobby")).toBeTruthy();
    expect(addrAlert.closest(".toast-stack")).toBeNull();
    expect(button("Connect").disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Connecting…" })).toBeNull();
    expect(document.querySelector(".chat-lobby-busy")).toBeNull();
    expect(startChatRoom).not.toHaveBeenCalled();
  });

  it("uses the Chinese loading copy", async () => {
    const pending = deferred<Session>();
    vi.mocked(startChatRoom).mockReturnValue(pending.promise);
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    await renderApp();

    await user.click(button("新建临时房间"));
    const create = button("新建临时房间");
    expect(create.disabled).toBe(true);
    expect(create.textContent).toBe("新建临时房间");
    expect(create.querySelector(".loading-cat")).toBeNull();
    expect(screen.queryByRole("button", { name: "正在创建…" })).toBeNull();
    const tempCat = panelCat(panelByHeading("临时房间"), "正在创建…");
    expect(tempCat.querySelector("img")?.getAttribute("src")).toContain("loading-cat");
    expect(button("重启房间").disabled).toBe(true);
    expect(button("保存密钥").disabled).toBe(true);
    expect(button("连接").disabled).toBe(true);

    pending.resolve(started);
    await waitFor(() => {
      expect(document.querySelector(".chat-lobby")).toBeNull();
    });
  });
});
