import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import { encodePng } from "../lib/qrMark";
import QrScanButton from "./QrScanButton";

afterEach(() => {
  cleanup();
  localStorage.removeItem("tailcat-locale");
});

async function solidPng(name: string): Promise<File> {
  const size = 48;
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 180;
    rgba[i + 3] = 255;
  }
  const png = await encodePng({ width: size, height: size, rgba });
  const buffer = new ArrayBuffer(png.byteLength);
  new Uint8Array(buffer).set(png);
  return new File([buffer], name, { type: "image/png" });
}

describe("scan QR image", () => {
  it("shows the Chinese missing-code error for a picture without a QR", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <QrScanButton onAccept={vi.fn()} />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "扫码" }));
    const dialog = await screen.findByRole("dialog", { name: "扫描二维码" });
    await user.upload(dialog.querySelector('input[type="file"]') as HTMLInputElement, await solidPng("blank.png"));
    expect((await screen.findByRole("alert")).textContent).toBe("这张图片里没有二维码。");
  });
});
