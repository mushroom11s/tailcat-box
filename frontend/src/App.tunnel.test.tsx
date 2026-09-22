import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { startForward } from "./lib/wails";

vi.mock("./lib/wails", async () => {
  const actual = await vi.importActual<typeof import("./lib/wails")>("./lib/wails");
  return {
    ...actual,
    startForward: vi.fn(actual.startForward),
  };
});

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
  vi.mocked(startForward).mockClear();
});

afterEach(() => {
  cleanup();
});

describe("tunnel page", () => {
  it("serves a port, forwards it, and keeps SSH and exit-node off the sidebar", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    expect(screen.getByRole("heading", { name: "Tunnel" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Port serve" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Local forward" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Browse" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Browse port 80" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Open in browser" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start SSH serve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start exit node" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Start port serve" }));
    const serve = await screen.findByText(/tc:fake-port-/);
    const addr = serve.textContent ?? "";

    await user.type(screen.getByLabelText("Address"), addr);
    await user.click(screen.getByRole("button", { name: "Start forward" }));
    expect(startForward).toHaveBeenCalledWith(
      addr,
      [{ LocalPort: 18080, RemoteHost: "", RemotePort: 8080 }],
      false,
    );
    await waitFor(() => {
      expect(screen.getByText("127.0.0.1:18080")).toBeTruthy();
    });
  });

  it("opens the browser by forwarding a bare port to an ephemeral local listener", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    const before = new Set(screen.queryAllByText(/tc:fake-port-/).map((el) => el.textContent));
    await user.click(screen.getByRole("button", { name: "Start port serve" }));
    const addr = await waitFor(() => {
      const fresh = screen.getAllByText(/tc:fake-port-/).map((el) => el.textContent ?? "").find((text) => !before.has(text));
      if (!fresh) {
        throw new Error("port serve address not ready");
      }
      return fresh;
    });

    await user.type(screen.getByLabelText("Address"), addr);
    const mappings = screen.getByLabelText("Mappings");
    await user.clear(mappings);
    await user.type(mappings, "80");
    await user.click(screen.getByRole("checkbox", { name: "Open in browser" }));
    await user.click(screen.getByRole("button", { name: "Start forward" }));

    expect(startForward).toHaveBeenCalledWith(addr, [{ LocalPort: 0, RemoteHost: "", RemotePort: 80 }], true);
    await waitFor(() => {
      expect(screen.getByText("http://127.0.0.1:0/")).toBeTruthy();
    });
  });

  it("uses 穿透 in zh-CN", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "穿透" }));
    expect(screen.getByRole("heading", { name: "穿透" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始端口监听" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始转发" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "用浏览器打开" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "浏览" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开对方 80 端口" })).toBeNull();
  });
});
