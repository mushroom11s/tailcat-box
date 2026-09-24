import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { listSessions, setNetworkSettings, startChatRoom, startPortServe, type Session } from "./lib/wails";

vi.mock("./lib/wails", async () => {
  const actual = await vi.importActual<typeof import("./lib/wails")>("./lib/wails");
  return {
    ...actual,
    listSessions: vi.fn(actual.listSessions),
    setNetworkSettings: vi.fn(actual.setNetworkSettings),
    startChatRoom: vi.fn(actual.startChatRoom),
    startPortServe: vi.fn(actual.startPortServe),
  };
});

const derp = 'fetching DERPMap for region -1: Get "https://tailcat.dev/derpmap.json": EOF';

const started: Session = {
  ID: "room-toast",
  Kind: "chat",
  Status: "error",
  Address: "tc:fake-room-toast",
  CreatedAt: "",
  Err: derp,
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

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
  vi.mocked(startChatRoom).mockReset();
  vi.mocked(setNetworkSettings).mockReset();
  vi.mocked(startPortServe).mockReset();
});

afterEach(async () => {
  cleanup();
  const actual = await vi.importActual<typeof import("./lib/wails")>("./lib/wails");
  vi.mocked(listSessions).mockImplementation(actual.listSessions);
});

describe("operational error toasts", () => {
  it("toasts a room DERPMap error and keeps the identity bar compact", async () => {
    vi.mocked(startChatRoom).mockResolvedValue(started);
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));

    const alert = await screen.findByRole("alert");
    expect(alert.closest(".toast-stack")).toBeTruthy();
    expect(alert.querySelector(".toast-message")?.textContent).toBe(derp);
    const identity = document.querySelector(".chat-identity");
    expect(identity?.textContent).not.toContain("derpmap.json");
    expect(identity?.querySelector(".err")).toBeNull();
    expect(identity?.querySelector(".status-dot.bad")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("toasts a keys network save failure away from the settings form", async () => {
    vi.mocked(setNetworkSettings).mockRejectedValue(new Error(derp));
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: "Save network settings" }));

    const alert = await screen.findByRole("alert");
    expect(alert.closest(".toast-stack")).toBeTruthy();
    expect(alert.querySelector(".toast-message")?.textContent).toBe(derp);
    expect(document.querySelector(".settings-panel .err")).toBeNull();
    expect(document.querySelector("main .err")?.textContent ?? "").not.toContain("derpmap.json");
  });

  it("toasts a tunnel start failure and a forward session error", async () => {
    vi.mocked(startPortServe).mockRejectedValue(new Error("connection reset"));
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    await user.click(screen.getByRole("button", { name: "+ New mapping" }));
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    await user.click(screen.getByRole("button", { name: "Start 8080" }));

    const alert = await screen.findByRole("alert");
    expect(alert.closest(".toast-stack")).toBeTruthy();
    expect(alert.querySelector(".toast-message")?.textContent).toBe("connection reset");
    expect(document.querySelector(".tunnel-page .err")).toBeNull();

    const forward: Session = {
      ID: "fwd-toast",
      Kind: "forward",
      Status: "error",
      Address: "",
      CreatedAt: "",
      Err: derp,
      Progress: "",
      Dangerous: false,
    };
    vi.mocked(listSessions).mockResolvedValue([forward]);
    await waitFor(
      () => {
        expect(screen.getByText(derp, { selector: ".toast-message" })).toBeTruthy();
      },
      { timeout: 4000 },
    );
    expect(document.querySelector(".tunnel-detail .err")).toBeNull();
  });
});
