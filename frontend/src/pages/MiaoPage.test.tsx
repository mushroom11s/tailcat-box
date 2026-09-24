import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { encodeJoin, MAX_SHARE_BYTES, parseJoin } from "../lib/miao";
import { releaseBrowserReceiveHolds, resetBrowserMiao, setBrowserReceiveHold } from "../lib/miaoBrowser";
import { listMiaoReceives, startMiaoReceive } from "../lib/wails";
import css from "../styles/glass.css?inline";
import MiaoPage from "./MiaoPage";

type GoApp = Record<string, (...args: unknown[]) => unknown>;

class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <div role="alert">page blank</div>;
    }
    return this.props.children;
  }
}

function installGoApp(app: GoApp): void {
  Object.assign(window, { go: { main: { App: app } } });
}

function clearGoApp(): void {
  delete (window as { go?: unknown }).go;
}

afterEach(() => {
  clearGoApp();
  resetBrowserMiao();
  localStorage.removeItem("tailcat-locale");
  cleanup();
});

function renderPage() {
  return render(
    <PageBoundary>
      <LocaleProvider>
        <MiaoPage />
      </LocaleProvider>
    </PageBoundary>,
  );
}

describe("Mew Share page", () => {
  it("names the share and download modes in English and Chinese", async () => {
    const user = userEvent.setup();
    localStorage.setItem("tailcat-locale", "en");
    const view = renderPage();
    expect(screen.getByRole("tab", { name: "Share" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Download" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Send" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Receive" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Mew Share" })).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Download" }));
    expect(screen.getByRole("tab", { name: "Download" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();

    view.unmount();
    localStorage.setItem("tailcat-locale", "zh-CN");
    renderPage();
    expect(screen.getByRole("heading", { name: "喵传" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "共享" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "下载" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "发送" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "接收" })).toBeNull();
  });

  it("restores the share list on the Share tab after restart", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    installGoApp({
      StartChatRoom: () => Promise.resolve({}),
      SetUILocale: () => Promise.resolve(),
      ListMiaoReceives: () => Promise.resolve([]),
      MiaoRestoreNotes: () => Promise.resolve([]),
      MiaoShareStatus: () =>
        Promise.resolve([
          {
            id: "share-restored",
            status: "active",
            payload: "mw1.restored-code",
            forever: true,
            total: 4,
            maxDownloads: 3,
            downloads: 1,
            files: [{ name: "笔记.txt", size: 4 }],
          },
        ]),
    });
    renderPage();
    expect(screen.getByRole("tab", { name: "共享" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("heading", { name: "进行中的分享" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "笔记.txt" })).toBeTruthy();
    expect(screen.getByText("笔记.txt")).toBeTruthy();
    expect((screen.getByLabelText("分享口令") as HTMLTextAreaElement).value).toBe("mw1.restored-code");
    expect(screen.getByText("还可下载 2")).toBeTruthy();
  });

  it("explains when a shared file could not be restored", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    installGoApp({
      StartChatRoom: () => Promise.resolve({}),
      SetUILocale: () => Promise.resolve(),
      ListMiaoReceives: () => Promise.resolve([]),
      MiaoShareStatus: () => Promise.resolve([]),
      MiaoRestoreNotes: () => Promise.resolve(["A shared file is missing, so that share was not restored."]),
    });
    renderPage();
    expect((await screen.findByRole("alert")).textContent).toBe("有一份共享的文件已经不在了，所以没有恢复。");
    expect(screen.getByRole("heading", { name: "喵传" })).toBeTruthy();
  });

  it("shows a drop zone, then an active share with a code and QR", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByRole("heading", { name: "Mew Share" })).toBeTruthy();
    expect(screen.getByText("Drop files here, or click to choose.")).toBeTruthy();

    const input = screen.getByLabelText("Choose files") as HTMLInputElement;
    const file = new File(["hello miao"], "notes.txt", { type: "text/plain" });
    await user.upload(input, file);

    expect(await screen.findByRole("button", { name: "End share" })).toBeTruthy();
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(screen.getByText("Drop files here, or click to choose.")).toBeTruthy();
    const token = (await screen.findByLabelText("Share code")) as HTMLTextAreaElement;
    expect(token.value.startsWith("mw1.")).toBe(true);
    const parsed = parseJoin(token.value);
    expect(parsed?.kind).toBe("miao");
    expect(parsed?.addr.startsWith("tc:fake-miao-")).toBe(true);
    expect(parsed?.token).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector(".miao-qr > img")).toBeTruthy();
    });
    const qr = document.querySelector(".miao-qr > img") as HTMLImageElement;
    expect(qr.getAttribute("src") ?? "").toMatch(/^data:image\/png/);
    expect(document.querySelector(".miao-qr-mark")).toBeNull();
    expect(document.querySelectorAll(".miao-qr img")).toHaveLength(1);
  });

  it("rejects an oversize drop before staging", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText("Choose files") as HTMLInputElement;
    const file = new File(["x"], "big.bin", { type: "application/octet-stream" });
    Object.defineProperty(file, "size", { value: MAX_SHARE_BYTES + 1 });
    await user.upload(input, file);
    expect((await screen.findByRole("alert")).textContent).toContain("This share is larger than 300 MiB.");
    expect(screen.queryByRole("button", { name: "End share" })).toBeNull();
  });

  it("joins a share from the pasted code and ends it when the download cap is 1", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText("Choose files") as HTMLInputElement;
    await user.upload(input, new File(["purr"], "笔记.txt", { type: "text/plain" }));
    const token = (await screen.findByLabelText("Share code")) as HTMLTextAreaElement;
    const code = token.value;

    await user.click(screen.getByRole("tab", { name: "Download" }));
    const join = screen.getByRole("textbox", { name: "Share code" });
    await user.click(join);
    await user.paste(code);
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(screen.getAllByText("笔记.txt").length).toBeGreaterThan(0);
    expect((screen.getByRole("textbox", { name: "Share code" }) as HTMLTextAreaElement).value).toBe("");
    await user.click(screen.getByRole("tab", { name: "Share" }));
    expect(await screen.findByText("Share ended. The temporary copies are gone.")).toBeTruthy();
    expect(screen.getByText("Drop files here, or click to choose.")).toBeTruthy();
  });

  it("keeps the other share and the drop zone when one share ends", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText("Choose files") as HTMLInputElement;
    await user.upload(input, new File(["a"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByRole("article", { name: "notes.txt" })).toBeTruthy();
    await user.upload(input, new File(["b"], "second.txt", { type: "text/plain" }));
    expect(await screen.findByRole("article", { name: "second.txt" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "End share" }).length).toBe(2);
    expect(screen.getByRole("heading", { name: "Active shares" })).toBeTruthy();
    expect(screen.getByText("Drop files here, or click to choose.")).toBeTruthy();

    await user.click(within(screen.getByRole("article", { name: "notes.txt" })).getByRole("button", { name: "End share" }));
    expect(await screen.findByText("Share ended. The temporary copies are gone.")).toBeTruthy();
    expect(screen.queryByRole("article", { name: "notes.txt" })).toBeNull();
    expect(screen.getByRole("article", { name: "second.txt" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "End share" })).toBeTruthy();
    expect(screen.getByText("Drop files here, or click to choose.")).toBeTruthy();
  });

  it("keeps the code field usable and resumes an interrupted download", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText("Choose files") as HTMLInputElement;
    await user.upload(input, new File(["purr"], "notes.txt", { type: "text/plain" }));
    const code = ((await screen.findByLabelText("Share code")) as HTMLTextAreaElement).value;
    setBrowserReceiveHold(true);
    try {
      await user.click(screen.getByRole("tab", { name: "Download" }));
      const join = screen.getByRole("textbox", { name: "Share code" });
      await user.click(join);
      await user.paste(code);
      await user.click(screen.getByRole("button", { name: "Download" }));
      expect(await screen.findByText("Connecting…")).toBeTruthy();
      expect((join as HTMLTextAreaElement).value).toBe("");
      expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(true);
      await user.click(join);
      await user.paste(code);
      expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false);
      await user.click(screen.getByRole("button", { name: "Download" }));
      expect(screen.getAllByRole("progressbar")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);

      releaseBrowserReceiveHolds();
      await waitFor(() => {
        const values = screen.getAllByRole("progressbar").map((bar) => Number(bar.getAttribute("aria-valuenow")));
        expect(values.some((value) => value > 0 && value < 100)).toBe(true);
      });
      expect(screen.getByText("Downloading…")).toBeTruthy();
      expect(screen.getAllByText("notes.txt").length).toBeGreaterThan(0);
      const partial = Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await screen.findByText("Interrupted")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
      expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBe(partial);

      await user.click(join);
      await user.paste(code);
      await user.click(screen.getByRole("button", { name: "Download" }));
      expect(screen.getAllByRole("progressbar")).toHaveLength(1);
      expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBeGreaterThan(0);
      setBrowserReceiveHold(false);
      expect(await screen.findByText("Saved")).toBeTruthy();
      expect((screen.getByRole("textbox", { name: "Share code" }) as HTMLTextAreaElement).disabled).toBe(false);
    } finally {
      setBrowserReceiveHold(false);
      releaseBrowserReceiveHolds();
    }
  });

  it("stays on screen when a download job has null or missing files", async () => {
    const user = userEvent.setup();
    const code = encodeJoin("tc:room", "token");
    if (!code) {
      throw new Error("missing code");
    }
    installGoApp({
      StartChatRoom: () => Promise.resolve({}),
      SetUILocale: () => Promise.resolve(),
      ListMiaoReceives: () => Promise.resolve([{ id: "listed", status: "queued", files: null, dest: "/tmp/listed" }]),
      MiaoShareStatus: () => Promise.resolve([{ id: "share-1", status: "active", files: null, payload: "", forever: true, total: 0, maxDownloads: 0, downloads: 0 }]),
      SelectDirectory: () => Promise.resolve("/tmp/in"),
      StartMiaoReceive: () => Promise.resolve({ id: "started", status: "connecting", bytesDone: 0, bytesTotal: 0, files: null, saved: null, dest: "/tmp/in" }),
    });

    renderPage();
    expect(await screen.findByRole("heading", { name: "Mew Share" })).toBeTruthy();
    expect(screen.queryByText("page blank")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Download" }));
    expect(await screen.findByText("Queued")).toBeTruthy();
    expect(document.querySelector(".miao-receive-card .miao-files")).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Share" }));
    expect(await screen.findByRole("article", { name: "share-1" })).toBeTruthy();
    expect(document.querySelector(".miao-active .miao-files")?.children.length ?? 0).toBe(0);

    await user.click(screen.getByRole("tab", { name: "Download" }));
    const join = screen.getByRole("textbox", { name: "Share code" });
    await user.click(join);
    await user.paste(code);
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(await screen.findByText("Connecting…")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mew Share" })).toBeTruthy();
    expect(screen.queryByText("page blank")).toBeNull();
    expect(document.querySelectorAll(".miao-receive-card .miao-files")).toHaveLength(0);
    expect((await startMiaoReceive(code, "/tmp/in")).files).toEqual([]);
    expect((await listMiaoReceives())[0]?.files).toEqual([]);
  });

  it("scrolls the send column so active cards stay whole", async () => {
    const listRule = cssBlock(css, ".miao-share-list");
    expect(listRule).not.toMatch(/max-height\s*:/);
    expect(listRule).not.toMatch(/overflow\s*:/);
    expect(listRule).toContain("flex: 0 0 auto");
    const cardsRule = cssBlock(css, ".miao-share-cards");
    expect(cardsRule).toContain("display: grid");
    expect(cardsRule).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(cardsRule).not.toMatch(/max-height\s*:/);
    expect(css).toMatch(/@media \(max-width: 720px\) \{[^}]*\.miao-share-cards \{\s*grid-template-columns: 1fr;/);

    const ledeRule = cssBlock(css, ".miao-page .chat-lobby-head .lede");
    expect(ledeRule).toContain("max-width: none");
    expect(cssBlock(css, ".chat-lobby-head .lede")).toContain("max-width: 62ch");

    const sendRule = cssBlock(css, ".miao-send");
    expect(sendRule).toContain("min-height: 0");
    expect(sendRule).toContain("overflow-y: auto");
    expect(sendRule).toContain("overflow-x: hidden");

    const cardRule = cssBlock(css, ".miao-active");
    expect(cardRule).toContain("overflow: visible");
    expect(cardRule).not.toContain("min-height: 0");
    const qrPlace = cssBlock(css, ".miao-active-grid > .miao-qr");
    expect(qrPlace).toContain("grid-row: 2 / span 2");
    expect(qrPlace).toContain("align-self: start");

    const qrRule = cssBlock(css, ".miao-qr > img");
    const qrWidth = Number(qrRule.match(/width:\s*(\d+)px/)?.[1]);
    expect(qrRule).toContain("image-rendering: pixelated");
    expect(css).not.toContain(".miao-qr-mark");
    const catRule = cssBlock(css, ".loading-cat.lg img");
    expect(catRule).toContain("width: 90px");
    expect(catRule).toContain("height: 120px");
    const smCat = cssBlock(css, ".loading-cat.sm img,\n.btn .loading-cat img");
    expect(smCat).toContain("width: 30px");
    expect(smCat).toContain("height: 40px");
    expect(qrWidth).toBeGreaterThanOrEqual(160);
    expect(qrWidth).toBeLessThanOrEqual(180);

    const dropRule = cssBlock(css, ".miao-drop");
    const shrunkRule = cssBlock(css, ".miao-send:has(.miao-share-list) .miao-drop");
    const dropMin = Number(dropRule.match(/min-height:\s*(\d+)px/)?.[1]);
    const shrunkMin = Number(shrunkRule.match(/min-height:\s*(\d+)px/)?.[1]);
    expect(shrunkMin).toBeGreaterThan(0);
    expect(shrunkMin).toBeLessThan(dropMin);

    const style = document.createElement("style");
    style.textContent = [sendRule, listRule, cardRule, dropRule, shrunkRule, qrRule].join("\n");
    document.head.appendChild(style);

    try {
      const user = userEvent.setup();
      renderPage();
      const input = screen.getByLabelText("Choose files") as HTMLInputElement;
      await user.upload(input, new File(["a"], "notes.txt", { type: "text/plain" }));
      await user.upload(input, new File(["b"], "second.txt", { type: "text/plain" }));
      expect(await screen.findByRole("article", { name: "second.txt" })).toBeTruthy();

      const send = document.querySelector(".miao-send") as HTMLElement;
      const limits = document.querySelector(".miao-limits") as HTMLElement;
      const list = document.querySelector(".miao-share-list") as HTMLElement;
      const drop = document.querySelector(".miao-drop") as HTMLElement;
      const fileInput = send.querySelector('input[type="file"]') as HTMLElement;
      const cards = [...list.querySelectorAll("article")];
      expect(cards).toHaveLength(2);
      expect(send.contains(limits)).toBe(true);
      expect(send.contains(list)).toBe(true);
      expect(send.contains(drop)).toBe(true);
      expect(limits.compareDocumentPosition(drop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(drop.compareDocumentPosition(fileInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(fileInput.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      const sendStyle = getComputedStyle(send);
      expect(sendStyle.overflowY).toBe("auto");
      expect(parseFloat(sendStyle.minHeight)).toBe(0);
      const listStyle = getComputedStyle(list);
      expect(listStyle.maxHeight === "none" || listStyle.maxHeight === "").toBe(true);
      expect(listStyle.overflowY === "visible" || listStyle.overflowY === "").toBe(true);
      for (const card of cards) {
        const cardStyle = getComputedStyle(card);
        expect(cardStyle.overflowY === "visible" || cardStyle.overflowY === "").toBe(true);
        expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight + 1);
      }
      await waitFor(() => {
        expect(document.querySelectorAll(".miao-qr > img").length).toBeGreaterThan(0);
      });
      const qr = document.querySelector(".miao-qr > img") as HTMLImageElement;
      expect(qr.width).toBe(qrWidth);
      expect(qr.height).toBe(qrWidth);
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
