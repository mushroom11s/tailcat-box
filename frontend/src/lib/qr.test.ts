import * as QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { acceptScannedText, decodeQrImageData, encodeQrDataURL, shareableAddress } from "./qr";

function rasterize(text: string): { pixels: Uint8ClampedArray; width: number; height: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const quiet = 4;
  const scale = 4;
  const count = qr.modules.size + quiet * 2;
  const width = count * scale;
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const col = Math.floor(x / scale) - quiet;
      const row = Math.floor(y / scale) - quiet;
      const dark =
        col >= 0 &&
        row >= 0 &&
        col < qr.modules.size &&
        row < qr.modules.size &&
        qr.modules.get(row, col) === 1;
      const i = (y * width + x) * 4;
      const v = dark ? 0 : 255;
      pixels[i] = v;
      pixels[i + 1] = v;
      pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  }
  return { pixels, width, height: width };
}

describe("qr helpers", () => {
  it("accepts the same trimmed tc prefix as paste and join", () => {
    expect(shareableAddress("  tc:room  ")).toBe("tc:room");
    expect(shareableAddress("tc")).toBe("tc");
    expect(shareableAddress("https://example")).toBe("");
    expect(shareableAddress("  ")).toBe("");
    expect(acceptScannedText("\n tc:peer \n")).toEqual({ ok: true, value: "tc:peer" });
    expect(acceptScannedText("not-a-key")).toEqual({ ok: false });
  });

  it("round-trips a raw address through the QR matrix", () => {
    const text = "tc:fake-room-abc";
    const image = rasterize(text);
    expect(decodeQrImageData(image.pixels, image.width, image.height)).toBe(text);
  });

  it("round-trips a longer key without wrapping it in a URL", () => {
    const text = `tc:${"a".repeat(80)}`;
    const image = rasterize(text);
    expect(decodeQrImageData(image.pixels, image.width, image.height)).toBe(text);
    expect(text.includes("http")).toBe(false);
  });

  it("encodes an svg data URL of the raw string", async () => {
    const text = "tc:fake-port-1";
    const url = await encodeQrDataURL(text);
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    expect(svg.includes("<svg")).toBe(true);
    expect(svg.includes(text)).toBe(false);
    expect(svg.includes("#invite")).toBe(false);
  });
});
