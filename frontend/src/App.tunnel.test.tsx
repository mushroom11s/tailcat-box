import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { MAPPINGS_KEY } from "./lib/portMappings";
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
  localStorage.removeItem(MAPPINGS_KEY);
  vi.mocked(startForward).mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.removeItem(MAPPINGS_KEY);
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

async function addServe(user: ReturnType<typeof userEvent.setup>, spec?: string) {
  await user.click(screen.getByRole("button", { name: "+ New mapping" }));
  if (spec !== undefined) {
    const field = screen.getByLabelText("Port mappings");
    await user.clear(field);
    await user.type(field, spec);
  }
  await user.click(screen.getByRole("button", { name: "Save mapping" }));
}

describe("tunnel page", () => {
  it("saves a port serve mapping, starts it, forwards it, and keeps SSH and exit-node off the sidebar", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    expect(screen.getByRole("heading", { name: "Tunnel" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Saved mappings" })).toBeTruthy();
    expect(screen.getByText("No saved mappings yet.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Browse" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Browse port 80" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start SSH serve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start exit node" })).toBeNull();

    await addServe(user);
    await user.click(screen.getByRole("button", { name: "Start 8080" }));
    const serve = await screen.findByText(/tc:fake-port-/, { selector: ".address" });
    const addr = (serve.textContent ?? "").trim();

    await user.click(screen.getByRole("button", { name: "+ New mapping" }));
    await user.click(screen.getByRole("radio", { name: "Local forward" }));
    expect(screen.getByRole("checkbox", { name: "Open in browser" })).toBeTruthy();
    await user.type(screen.getByLabelText("Address"), addr);
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    await user.click(screen.getByRole("button", { name: "Start 18080 → :8080" }));

    expect(startForward).toHaveBeenCalledWith(
      addr,
      [{ LocalPort: 18080, RemoteHost: "", RemotePort: 8080 }],
      false,
    );
    await waitFor(() => {
      expect(screen.getByText("127.0.0.1:18080", { selector: ".address" })).toBeTruthy();
    });
  });

  it("opens the browser from a saved forward mapping with a bare remote port", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    const before = new Set(
      screen.queryAllByText(/tc:fake-port-/, { selector: ".address" }).map((el) => el.textContent),
    );
    await addServe(user);
    await user.click(screen.getByRole("button", { name: "Start 8080" }));
    const addr = await waitFor(() => {
      const fresh = screen
        .getAllByText(/tc:fake-port-/, { selector: ".address" })
        .map((el) => el.textContent ?? "")
        .find((text) => !before.has(text));
      if (!fresh) {
        throw new Error("port serve address not ready");
      }
      return fresh.trim();
    });

    await user.click(screen.getByRole("button", { name: "+ New mapping" }));
    await user.click(screen.getByRole("radio", { name: "Local forward" }));
    await user.type(screen.getByLabelText("Address"), addr);
    const mappings = screen.getByLabelText("Mappings");
    await user.clear(mappings);
    await user.type(mappings, "80");
    await user.click(screen.getByRole("checkbox", { name: "Open in browser" }));
    await user.click(screen.getByRole("button", { name: "Save mapping" }));
    await user.click(screen.getByRole("button", { name: "Start browser → :80" }));

    expect(startForward).toHaveBeenCalledWith(addr, [{ LocalPort: 0, RemoteHost: "", RemotePort: 80 }], true);
    await waitFor(() => {
      expect(screen.getByText("http://127.0.0.1:0/", { selector: ".address" })).toBeTruthy();
    });
  });

  it("stops and deletes a saved mapping", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    await addServe(user);
    await user.click(screen.getByRole("button", { name: "Start 8080" }));
    await screen.findByText(/tc:fake-port-/, { selector: ".address" });
    await user.click(screen.getByRole("button", { name: "Stop 8080" }));
    expect(await screen.findByRole("button", { name: "Start 8080" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete 8080" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Delete 8080" })).toBeNull();
      expect(screen.getByText("No saved mappings yet.")).toBeTruthy();
    });
    expect(JSON.parse(localStorage.getItem(MAPPINGS_KEY) ?? "null")).toEqual([]);
  });

  it("keeps a saved mapping after remount and leaves it stopped", async () => {
    const user = userEvent.setup();
    const first = renderApp();
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    await addServe(user);
    expect(screen.getByRole("button", { name: "Start 8080" })).toBeTruthy();
    expect(screen.queryByText(/tc:fake-port-/)).toBeNull();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(MAPPINGS_KEY) ?? "[]") as Array<{ mode: string; localPort: number }>;
      expect(stored).toEqual([expect.objectContaining({ mode: "serve", localPort: 8080 })]);
    });
    first.unmount();

    const nextUser = userEvent.setup();
    renderApp();
    await nextUser.click(screen.getByRole("button", { name: "Tunnel" }));
    expect(screen.getByRole("button", { name: "Start 8080" })).toBeTruthy();
    expect(screen.queryByText(/tc:fake-port-/)).toBeNull();
  });

  it("uses 穿透 in zh-CN", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "穿透" }));
    expect(screen.getByRole("heading", { name: "穿透" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "已保存的映射" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "+ 新映射" }));
    expect(screen.getByRole("radio", { name: "端口监听" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "本地转发" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存映射" })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "本地转发" }));
    expect(screen.getByRole("checkbox", { name: "用浏览器打开" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "浏览" })).toBeNull();
    expect(screen.queryByRole("button", { name: "打开对方 80 端口" })).toBeNull();
    expect(screen.queryByRole("button", { name: "开始 SSH 服务" })).toBeNull();
  });
});
