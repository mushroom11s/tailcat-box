import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import { resetBrowserMiao } from "../lib/miaoBrowser";
import { MAX_SHARE_BYTES } from "../lib/miao";
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
    expect(token.value).toContain("tc:fake-miao-");
    expect(token.value).toContain('"kind":"miao"');
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
});
