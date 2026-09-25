import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { encodeJoin, MAX_SHARE_BYTES, parseJoin } from "../lib/miao";
import { decodeQrFromFile } from "../lib/qrImage";
import { decodePng } from "../lib/qrMark";
import { releaseBrowserReceiveHolds, resetBrowserMiao, setBrowserReceiveHold } from "../lib/miaoBrowser";
import { listMiaoReceives, startMiaoReceive } from "../lib/wails";
import css from "../styles/glass.css?inline";
import MiaoPage from "./MiaoPage";

vi.mock("../lib/qrImage", () => ({
  decodeQrFromFile: vi.fn(),
}));

const originalClipboard = navigator.clipboard;

function setClipboard(value: Partial<Clipboard>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

function pasteOn(target: HTMLElement, fill: (data: DataTransfer) => void) {
  const data = new DataTransfer();
  fill(data);
  const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: data });
  target.dispatchEvent(event);
}

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
  vi.useRealTimers();
  clearGoApp();
  resetBrowserMiao();
  localStorage.removeItem("tailcat-locale");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
  vi.mocked(decodeQrFromFile).mockReset();
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
    expect(screen.getByText(/must not be moved/)).toBeTruthy();

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
    const baked = await decodePng(pngBytes(qr.getAttribute("src") ?? ""));
    const art = colorBounds(baked);
    expect(art).not.toBeNull();
    const box = art as { minX: number; minY: number; maxX: number; maxY: number };
    const aspect = (box.maxY - box.minY + 1) / (box.maxX - box.minX + 1);
    expect(aspect).toBeGreaterThan(1.12);
    expect(aspect).toBeLessThan(1.35);
  });

  it("tells the host when a large share stays on the original path", async () => {
    const user = userEvent.setup();
    installGoApp({
      StartChatRoom: () => Promise.resolve({}),
      SetUILocale: () => Promise.resolve(),
      ListMiaoReceives: () => Promise.resolve([]),
      MiaoRestoreNotes: () => Promise.resolve([]),
      EndMiaoShare: () => Promise.resolve(),
      MiaoShareStatus: () =>
        Promise.resolve([
          {
            id: "share-big",
            status: "active",
            payload: "mw1.big-share",
            forever: true,
            total: 9,
            byRef: true,
            warning: "The original file was moved or deleted. Put it back in the same place, or end this share and start again.",
            files: [{ name: "big.bin", size: 9 }],
          },
        ]),
    });
    renderPage();
    expect(await screen.findByText("These files stay at their original path. Do not move or rename them while this share is active.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("moved or deleted");
    await user.click(screen.getByRole("button", { name: "End share" }));
    expect(await screen.findByText("Share ended. The original files were left where they are.")).toBeTruthy();
  });

  it("rejects an oversize drop before staging", async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByLabelText("Choose files") as HTMLInputElement;
    const file = new File(["x"], "big.bin", { type: "application/octet-stream" });
    Object.defineProperty(file, "size", { value: MAX_SHARE_BYTES + 1 });
    await user.upload(input, file);
    expect((await screen.findByRole("alert")).textContent).toContain("A copied share cannot be larger than 300 MiB.");
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
      const runningCat = document.querySelector(".miao-progress-cat img");
      const mid = screen.getByRole("progressbar").getAttribute("aria-valuenow");
      expect(Number(mid)).toBeGreaterThan(0);
      expect(Number(mid)).toBeLessThan(100);
      expect(runningCat?.getAttribute("alt")).toBe("");
      expect(runningCat?.getAttribute("src") ?? "").toContain("running-cat.gif");
      expect(document.querySelector(".miao-progress-cat source")?.getAttribute("srcset") ?? "").toContain("running-cat.webp");
      expect(document.querySelector(".miao-progress-cat")?.getAttribute("style") ?? "").toContain(`${mid}%`);
      expect(screen.getByRole("progressbar").querySelector("span")?.getAttribute("style") ?? "").toContain(`${mid}%`);
      expect(screen.getByRole("progressbar").querySelector(".miao-progress-cat")).toBeNull();
      expect(cssBlock(css, ".miao-progress-wrap")).toContain("overflow: visible");
      expect(cssBlock(css, ".miao-progress")).toContain("overflow: hidden");
      expect(cssBlock(css, ".miao-progress-cat")).toContain("clamp(20px, var(--miao-pct, 0%), calc(100% - 20px))");
      expect(cssBlock(css, ".miao-progress-cat img")).toContain("width: 40px");
      expect(cssBlock(css, ".miao-progress-cat img")).toContain("height: 53px");
      expect(screen.getAllByText("notes.txt").length).toBeGreaterThan(0);
      const partial = Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(await screen.findByText("Interrupted")).toBeTruthy();
      expect(document.querySelector(".miao-progress-cat")).toBeNull();
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

  it("fills the share field from a pasted code or QR image without a file picker", async () => {
    const user = userEvent.setup();
    const code = encodeJoin("tc:room", "abc");
    if (!code) {
      throw new Error("missing code");
    }
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Download" }));
    expect(screen.getByText("Paste a share code or a QR image, or scan the code.")).toBeTruthy();
    const join = screen.getByRole("textbox", { name: "Share code" }) as HTMLTextAreaElement;
    await user.click(join);

    await user.paste(`  ${code}\n`);
    expect(join.value).toBe(code);

    await user.paste(`口令 https://example.test/s?code=${code}`);
    expect(join.value).toBe(code);

    await user.paste("not-a-share-code");
    expect(join.value).toBe(code);
    expect(screen.getByRole("alert").textContent).toBe("That share code is not valid.");

    vi.mocked(decodeQrFromFile).mockResolvedValueOnce(`  ${code}  `);
    const image = new File([new Uint8Array([1, 2, 3])], "share.png", { type: "image/png" });
    pasteOn(join, (data) => {
      data.items.add(image);
    });
    await waitFor(() => {
      expect(join.value).toBe(code);
    });
    expect(decodeQrFromFile).toHaveBeenCalledTimes(1);
    const decoded = vi.mocked(decodeQrFromFile).mock.calls[0][0];
    expect(decoded).toBeInstanceOf(File);
    expect(decoded.type).toBe("image/png");
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false);

    vi.mocked(decodeQrFromFile).mockResolvedValueOnce(null);
    pasteOn(join, (data) => {
      data.items.add(image);
    });
    expect((await screen.findByRole("alert")).textContent).toBe("No QR code found in that image.");
    expect(join.value).toBe(code);

    vi.mocked(decodeQrFromFile).mockResolvedValueOnce("https://example.invalid");
    pasteOn(join, (data) => {
      data.items.add(image);
    });
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("That share code is not valid.");
    });
  });

  it("reports an empty clipboard and a clipboard that is neither text nor an image", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    setClipboard({
      read: async () => [],
      readText: async () => "",
    });
    renderPage();
    await user.click(screen.getByRole("tab", { name: "下载" }));
    const join = screen.getByRole("textbox", { name: "分享口令" });
    await user.click(join);
    pasteOn(join, () => undefined);
    expect((await screen.findByRole("alert")).textContent).toBe("剪贴板是空的。");

    pasteOn(join, (data) => {
      data.setData("text/html", "<b>hi</b>");
    });
    expect((await screen.findByRole("alert")).textContent).toBe("剪贴板里既没有图片，也没有分享口令。");
  });

  it("accepts a share code pasted from the scan dialog", async () => {
    const user = userEvent.setup();
    const code = encodeJoin("tc:room", "token");
    if (!code) {
      throw new Error("missing code");
    }
    setClipboard({
      read: async () =>
        [
          {
            types: ["text/plain"],
            getType: async () => new Blob([`see ${code}`], { type: "text/plain" }),
          },
        ] as unknown as ClipboardItems,
    });
    renderPage();
    await user.click(screen.getByRole("tab", { name: "Download" }));
    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    await user.keyboard("{Control>}v{/Control}");
    await waitFor(() => {
      expect((screen.getByRole("textbox", { name: "Share code" }) as HTMLTextAreaElement).value).toBe(code);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.clear(screen.getByRole("textbox", { name: "Share code" }));
    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    await user.keyboard("{Meta>}v{/Meta}");
    await waitFor(() => {
      expect((screen.getByRole("textbox", { name: "Share code" }) as HTMLTextAreaElement).value).toBe(code);
    });
  });

  it("retries a failed download from the button without a second automatic start", async () => {
    vi.useFakeTimers();
    localStorage.setItem("tailcat-locale", "en");
    const payload = encodeJoin("tc:host-retry", "token-retry");
    if (!payload) {
      throw new Error("missing code");
    }
    let starts = 0;
    installGoApp({
      StartChatRoom: () => Promise.resolve({}),
      SetUILocale: () => Promise.resolve(),
      MiaoShareStatus: () => Promise.resolve([]),
      MiaoRestoreNotes: () => Promise.resolve([]),
      ListMiaoReceives: () =>
        Promise.resolve([
          {
            id: "job-retry",
            status: "failed",
            error: "Could not reach the host. They need to stay online.",
            payload,
            dest: "/tmp/in",
            bytesDone: 0,
            bytesTotal: 4,
            files: [{ name: "notes.txt", size: 4 }],
          },
        ]),
      StartMiaoReceive: () => {
        starts += 1;
        return Promise.resolve({
          id: "job-retry",
          status: "connecting",
          payload,
          dest: "/tmp/in",
          bytesDone: 0,
          bytesTotal: 4,
          files: [{ name: "notes.txt", size: 4 }],
        });
      },
    });

    renderPage();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Download" }));
    expect(screen.getByText("Could not reach the host. They need to stay online.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(starts).toBe(1);
    expect(screen.getByText("Connecting…")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(starts).toBe(1);
  });

  it("starts a transient download again after a short wait", async () => {
    vi.useFakeTimers();
    localStorage.setItem("tailcat-locale", "en");
    const payload = encodeJoin("tc:host-auto", "token-auto");
    if (!payload) {
      throw new Error("missing code");
    }
    let starts = 0;
    installGoApp({
      StartChatRoom: () => Promise.resolve({}),
      SetUILocale: () => Promise.resolve(),
      MiaoShareStatus: () => Promise.resolve([]),
      MiaoRestoreNotes: () => Promise.resolve([]),
      ListMiaoReceives: () =>
        Promise.resolve([
          {
            id: "job-auto",
            status: "failed",
            error: "Could not reach the host. They need to stay online.",
            payload,
            dest: "/tmp/in",
            bytesDone: 0,
            bytesTotal: 4,
            files: [{ name: "notes.txt", size: 4 }],
          },
        ]),
      StartMiaoReceive: () => {
        starts += 1;
        return Promise.resolve({
          id: "job-auto",
          status: "connecting",
          payload,
          dest: "/tmp/in",
          bytesDone: 0,
          bytesTotal: 4,
          files: [{ name: "notes.txt", size: 4 }],
        });
      },
    });

    renderPage();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Download" }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByText("Retrying…")).toBeTruthy();
    expect(starts).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(starts).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(starts).toBe(1);
  });

  it("keeps a Retry button when the share has ended, without retrying on its own", async () => {
    vi.useFakeTimers();
    localStorage.setItem("tailcat-locale", "en");
    const payload = encodeJoin("tc:host-ended", "token-ended");
    if (!payload) {
      throw new Error("missing code");
    }
    let starts = 0;
    installGoApp({
      StartChatRoom: () => Promise.resolve({}),
      SetUILocale: () => Promise.resolve(),
      MiaoShareStatus: () => Promise.resolve([]),
      MiaoRestoreNotes: () => Promise.resolve([]),
      ListMiaoReceives: () =>
        Promise.resolve([
          {
            id: "job-ended",
            status: "failed",
            error: "The share has ended.",
            payload,
            dest: "/tmp/in",
            bytesDone: 0,
            bytesTotal: 4,
            files: [{ name: "notes.txt", size: 4 }],
          },
        ]),
      StartMiaoReceive: () => {
        starts += 1;
        return Promise.resolve({ id: "job-ended", status: "connecting", payload, dest: "/tmp/in", files: null });
      },
    });

    renderPage();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Download" }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByText("The share has ended.")).toBeTruthy();
    expect(screen.queryByText("Retrying…")).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(starts).toBe(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("explains a share that is not listening and one that ends within an hour", async () => {
    localStorage.setItem("tailcat-locale", "en");
    const soon = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    installGoApp({
      StartChatRoom: () => Promise.resolve({}),
      SetUILocale: () => Promise.resolve(),
      ListMiaoReceives: () => Promise.resolve([]),
      MiaoRestoreNotes: () => Promise.resolve([]),
      MiaoShareStatus: () =>
        Promise.resolve([
          {
            id: "share-soon",
            status: "active",
            payload: "",
            forever: false,
            expiresAt: soon,
            listening: false,
            total: 4,
            maxDownloads: 1,
            downloads: 0,
            files: [{ name: "notes.txt", size: 4 }],
          },
        ]),
    });

    renderPage();
    expect(await screen.findByText("notes.txt")).toBeTruthy();
    expect(screen.getAllByText("This share is not online yet. Tailcat Box will keep trying. The other person can download once this device is reachable.").length).toBeGreaterThan(0);
    expect(screen.getByText("This share ends in less than an hour.")).toBeTruthy();
    expect(screen.queryByText("Packing…")).toBeNull();
    expect(screen.getByRole("heading", { name: "Mew Share" })).toBeTruthy();
  });

  it("warns that a download's share ends soon", async () => {
    localStorage.setItem("tailcat-locale", "en");
    const soon = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    installGoApp({
      StartChatRoom: () => Promise.resolve({}),
      SetUILocale: () => Promise.resolve(),
      MiaoShareStatus: () => Promise.resolve([]),
      MiaoRestoreNotes: () => Promise.resolve([]),
      ListMiaoReceives: () =>
        Promise.resolve([
          {
            id: "job-soon",
            status: "downloading",
            expiresAt: soon,
            dest: "/tmp/in",
            bytesDone: 1,
            bytesTotal: 4,
            files: [{ name: "notes.txt", size: 4 }],
          },
        ]),
    });

    renderPage();
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("tab", { name: "Download" }));
    expect(screen.getByText("This share ends in less than an hour.")).toBeTruthy();
    expect(screen.getByRole("article", { name: "notes.txt" })).toBeTruthy();
  });

  it("shows an offline notice without hiding the share page", () => {
    localStorage.setItem("tailcat-locale", "en");
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false });
    try {
      renderPage();
      expect(screen.getByRole("alert").textContent).toContain("You appear to be offline. Mew Share needs a network connection.");
      expect(screen.getByText("Drop files here, or click to choose.")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Mew Share" })).toBeTruthy();
    } finally {
      if (desc) {
        Object.defineProperty(Navigator.prototype, "onLine", desc);
      }
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

function pngBytes(url: string): Uint8Array {
  const body = url.slice(url.indexOf(",") + 1);
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function colorBounds(image: { width: number; height: number; rgba: Uint8Array }): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      const r = image.rgba[i];
      const g = image.rgba[i + 1];
      const b = image.rgba[i + 2];
      if (!(r !== g || g !== b || (r !== 0 && r !== 255))) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}
