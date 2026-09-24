import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import QrScanButton from "./QrScanButton";

const originalClipboard = navigator.clipboard;

afterEach(() => {
  cleanup();
  localStorage.removeItem("tailcat-locale");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: originalClipboard });
});

function setClipboard(value: Partial<Clipboard>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}

function textItem(text: string) {
  return {
    types: ["text/plain"],
    getType: async () => new Blob([text], { type: "text/plain" }),
  };
}

function renderScan(onAccept = vi.fn(), decodeFile = vi.fn()) {
  localStorage.setItem("tailcat-locale", "en");
  render(
    <LocaleProvider>
      <QrScanButton onAccept={onAccept} decodeFile={decodeFile} />
    </LocaleProvider>,
  );
  return { onAccept, decodeFile };
}

describe("scan QR paste", () => {
  it("decodes a pasted image with the same path as choosing a file", async () => {
    const user = userEvent.setup();
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    setClipboard({
      read: async () => [{ types: ["image/png"], getType: async () => png }] as unknown as ClipboardItems,
    });
    const { onAccept, decodeFile } = renderScan(vi.fn(), vi.fn().mockResolvedValue("  tc:from-image  "));

    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    expect(screen.getByRole("button", { name: "Paste" })).toBeTruthy();
    expect(screen.getByText(/paste a QR image or Tailcat address/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Paste" }));

    expect(decodeFile).toHaveBeenCalledTimes(1);
    const file = decodeFile.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe("image/png");
    expect(onAccept).toHaveBeenCalledWith("tc:from-image");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("accepts a pasted Tailcat address from the button and from Ctrl+V and Cmd+V", async () => {
    const user = userEvent.setup();
    setClipboard({
      read: async () => [textItem("tc:from-text")] as unknown as ClipboardItems,
    });
    const { onAccept, decodeFile } = renderScan();

    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(onAccept).toHaveBeenCalledWith("tc:from-text");
    expect(decodeFile).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    await user.keyboard("{Control>}v{/Control}");
    expect(onAccept).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    await user.keyboard("{Meta>}v{/Meta}");
    expect(onAccept).toHaveBeenCalledTimes(3);
    expect(decodeFile).not.toHaveBeenCalled();
  });

  it("shows errors for an empty clipboard, unusable contents, a failed decode, and denied access", async () => {
    const user = userEvent.setup();
    const { decodeFile } = renderScan(vi.fn(), vi.fn().mockResolvedValue(null));

    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    setClipboard({ read: async () => [] });
    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(screen.getByRole("alert").textContent).toBe("The clipboard is empty.");

    setClipboard({
      read: async () => [textItem("not-an-address")] as unknown as ClipboardItems,
    });
    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(screen.getByRole("alert").textContent).toBe("The clipboard has neither an image nor a Tailcat address.");

    const png = new Blob([new Uint8Array([4])], { type: "image/png" });
    setClipboard({
      read: async () => [{ types: ["image/png"], getType: async () => png }] as unknown as ClipboardItems,
    });
    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(screen.getByRole("alert").textContent).toBe("No QR code found in that image.");
    expect(decodeFile).toHaveBeenCalledTimes(1);

    const deny = () => {
      const err = new Error("denied");
      err.name = "NotAllowedError";
      throw err;
    };
    setClipboard({ read: deny, readText: deny });
    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(screen.getByRole("alert").textContent).toBe("Clipboard access was denied.");
    expect(screen.getByRole("button", { name: "Use camera" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose image" })).toBeTruthy();
  });

  it("uses 粘贴 and the Chinese empty-clipboard error", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    setClipboard({ read: async () => [] });
    render(
      <LocaleProvider>
        <QrScanButton onAccept={vi.fn()} />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "扫码" }));
    await user.click(screen.getByRole("button", { name: "粘贴" }));
    expect(screen.getByRole("alert").textContent).toBe("剪贴板是空的。");
  });
});
