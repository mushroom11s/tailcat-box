import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { resetBrowserMiao } from "../lib/miaoBrowser";
import { MAX_SHARE_BYTES, parseJoin } from "../lib/miao";
import css from "../styles/glass.css?inline";
import MiaoPage from "./MiaoPage";

afterEach(() => {
  resetBrowserMiao();
  cleanup();
});

function renderPage() {
  return render(
    <LocaleProvider>
      <MiaoPage />
    </LocaleProvider>,
  );
}

describe("Mew Share page", () => {
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
      expect(document.querySelector(".miao-qr img")).toBeTruthy();
    });
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

    await user.click(screen.getByRole("tab", { name: "Receive" }));
    const join = screen.getByRole("textbox", { name: "Share code" });
    await user.click(join);
    await user.paste(code);
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(await screen.findByRole("heading", { name: "Saved" })).toBeTruthy();
    expect(screen.getByText("笔记.txt")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Send" }));
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

  it("scrolls the send column so active cards stay whole", async () => {
    const listRule = cssBlock(css, ".miao-share-list");
    expect(listRule).not.toMatch(/max-height\s*:/);
    expect(listRule).not.toMatch(/overflow\s*:/);
    expect(listRule).toContain("flex: 0 0 auto");

    const sendRule = cssBlock(css, ".miao-send");
    expect(sendRule).toContain("min-height: 0");
    expect(sendRule).toContain("overflow-y: auto");
    expect(sendRule).toContain("overflow-x: hidden");

    const cardRule = cssBlock(css, ".miao-active");
    expect(cardRule).toContain("overflow: visible");
    expect(cardRule).not.toContain("min-height: 0");

    const qrRule = cssBlock(css, ".miao-qr img");
    const qrWidth = Number(qrRule.match(/width:\s*(\d+)px/)?.[1]);
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
      const list = document.querySelector(".miao-share-list") as HTMLElement;
      const drop = document.querySelector(".miao-drop") as HTMLElement;
      const cards = [...list.querySelectorAll("article")];
      expect(cards).toHaveLength(2);
      expect(send.contains(list)).toBe(true);
      expect(send.contains(drop)).toBe(true);
      expect(list.compareDocumentPosition(drop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

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
      const qr = document.querySelector(".miao-qr img") as HTMLImageElement | null;
      expect(qr?.width).toBe(qrWidth);
      expect(qr?.height).toBe(qrWidth);
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
