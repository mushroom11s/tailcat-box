import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { MAPPINGS_KEY } from "./lib/portMappings";
import { startForward } from "./lib/wails";
import css from "./styles/glass.css?inline";

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
    expect(serve.tagName).toBe("CODE");
    expect(serve.classList.contains("tunnel-key")).toBe(true);
    const serveCopy = serve.closest(".tunnel-codeblock")?.querySelector("button");
    expect(serveCopy?.getAttribute("aria-label")).toBe("Copy address");
    expect(serveCopy?.querySelector("svg")).toBeTruthy();
    expect(serveCopy?.textContent?.trim()).toBe("");
    expect(serve.parentElement?.tagName).toBe("PRE");
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
    const listen = screen.getByText("127.0.0.1:18080", { selector: ".address" });
    expect(listen.tagName).toBe("CODE");
    expect(listen.parentElement?.tagName).toBe("PRE");
    expect(listen.closest(".tunnel-codeblock")?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Copy local address",
    );
    const peer = document.querySelector(".tunnel-detail code.tunnel-key:not(.address)");
    expect(peer?.textContent).toBe(addr);
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
    await user.type(screen.getByLabelText("地址"), "tc:zh-key");
    await user.click(screen.getByRole("button", { name: "保存映射" }));
    const key = document.querySelector(".tunnel-detail code.tunnel-key");
    expect(key?.textContent).toBe("tc:zh-key");
    expect(key?.parentElement?.tagName).toBe("PRE");
    const copyZh = screen.getByRole("button", { name: "复制地址" });
    expect(copyZh.getAttribute("title")).toBe("复制地址");
    expect(copyZh.querySelector("svg")).toBeTruthy();
  });

  it("keeps a long forward key inside the card and copies it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const style = document.createElement("style");
    style.textContent = [
      ":root { --mono: ui-monospace, Menlo, monospace; }",
      cssBlock(css, ".tunnel-detail"),
      cssBlock(css, ".tunnel-codeblock"),
      cssBlock(css, ".tunnel-codeblock pre"),
      cssBlock(css, ".tunnel-codeblock code"),
      cssBlock(css, ".tunnel-code-copy"),
    ].join("\n");
    document.head.appendChild(style);
    try {
      renderApp();
      await user.click(screen.getByRole("button", { name: "Tunnel" }));
      await user.click(screen.getByRole("button", { name: "+ New mapping" }));
      await user.click(screen.getByRole("radio", { name: "Local forward" }));
      const long = `tc:${"k".repeat(160)}`;
      const field = screen.getByLabelText("Address");
      await user.click(field);
      await user.paste(long);
      await user.click(screen.getByRole("button", { name: "Save mapping" }));

      const code = document.querySelector(".tunnel-detail code.tunnel-key") as HTMLElement;
      expect(code.tagName).toBe("CODE");
      expect(code.textContent).toBe(long);
      expect(code.getAttribute("title")).toBe(long);
      const pre = code.parentElement as HTMLElement;
      expect(pre.tagName).toBe("PRE");
      const block = pre.parentElement as HTMLElement;
      expect(block.classList.contains("tunnel-codeblock")).toBe(true);
      expect(block.closest(".tunnel-detail")).toBeTruthy();

      const valueStyle = getComputedStyle(code);
      expect(valueStyle.minWidth).toBe("0");
      expect(valueStyle.maxWidth).toBe("100%");
      expect(valueStyle.wordBreak).toBe("break-all");
      expect(valueStyle.overflowWrap).toBe("anywhere");
      expect(valueStyle.whiteSpace).toBe("pre-wrap");
      expect(valueStyle.fontFamily.toLowerCase()).toContain("monospace");

      const preStyle = getComputedStyle(pre);
      expect(preStyle.overflow).toBe("auto");
      expect(preStyle.maxWidth).toBe("100%");
      expect(preStyle.minWidth).toBe("0");

      const blockStyle = getComputedStyle(block);
      expect(blockStyle.position).toBe("relative");
      expect(blockStyle.minWidth).toBe("0");
      expect(blockStyle.maxWidth).toBe("100%");

      const copy = block.querySelector("button") as HTMLElement;
      expect(copy.classList.contains("btn")).toBe(false);
      expect(copy.querySelector("svg")).toBeTruthy();
      expect(getComputedStyle(copy).position).toBe("absolute");

      const cardStyle = getComputedStyle(block.parentElement as HTMLElement);
      expect(cardStyle.display).toBe("flex");
      expect(cardStyle.minWidth).toBe("0");
      expect(cardStyle.maxWidth).toBe("100%");

      await user.click(screen.getByRole("button", { name: "Copy address" }));
      expect(writeText).toHaveBeenCalledWith(long);
    } finally {
      style.remove();
    }
  });
});

function cssBlock(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
  if (!match) {
    throw new Error(`missing ${selector}`);
  }
  return match[0];
}
