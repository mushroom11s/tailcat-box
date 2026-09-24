import * as QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import iconUrl from "../assets/icon.png?inline";
import { acceptScannedText, decodeQrImageData, encodeQrDataURL, shareableAddress } from "./qr";
import { decodePng, encodePng, type RgbaImage } from "./qrMark";

function rasterize(
  text: string,
  errorCorrectionLevel: "L" | "M" | "Q" | "H" = "M",
): { pixels: Uint8ClampedArray; width: number; height: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel });
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

function coverCenter(
  image: { pixels: Uint8ClampedArray; width: number; height: number },
  fraction: number,
): { pixels: Uint8ClampedArray; width: number; height: number } {
  const pixels = new Uint8ClampedArray(image.pixels);
  const box = Math.round(image.width * fraction);
  const x0 = Math.floor((image.width - box) / 2);
  const y0 = Math.floor((image.height - box) / 2);
  for (let y = y0; y < y0 + box; y++) {
    for (let x = x0; x < x0 + box; x++) {
      const i = (y * image.width + x) * 4;
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = 255;
    }
  }
  return { pixels, width: image.width, height: image.height };
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

  it("still scans when a center mark covers the share code", () => {
    const text = "mw1.AAAHdGM6cm9vbQADYWJj";
    const image = rasterize(text, "H");
    const covered = coverCenter(image, 0.28);
    expect(decodeQrImageData(covered.pixels, covered.width, covered.height)).toBe(text);
  });

  it("encodes an svg data URL of the raw string", async () => {
    const text = "tc:fake-port-1";
    const url = await encodeQrDataURL(text);
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
    const svg = decodeURIComponent(url.slice(url.indexOf(",") + 1));
    expect(svg.includes("<svg")).toBe(true);
    expect(svg.includes(text)).toBe(false);
    expect(svg.includes("#invite")).toBe(false);
    const high = await encodeQrDataURL(text, "H");
    expect(high.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("bakes a center mark into one PNG and wraps modules around the silhouette", async () => {
    const text = "mw1.AAAHdGM6cm9vbQADYWJj";
    const mark = plusMark();
    const url = await encodeQrDataURL(text, { errorCorrectionLevel: "H", centerMark: await pngDataUrl(mark) });
    expect(url.startsWith("data:image/png")).toBe(true);
    const image = await decodePng(dataUrlBytes(url));
    expect(decodeQrImageData(toClamped(image), image.width, image.height)).toBe(text);

    const red = boundsWhere(image, (r, g, b) => r > 200 && g < 40 && b < 40);
    expect(red).not.toBeNull();
    const box = red as Box;
    let blackInBox = 0;
    for (let y = box.minY; y <= box.maxY; y++) {
      for (let x = box.minX; x <= box.maxX; x++) {
        const [r, g, b] = pixel(image, x, y);
        if (r === 0 && g === 0 && b === 0) {
          blackInBox += 1;
        }
      }
    }
    expect(blackInBox).toBeGreaterThan(0);

    const center = pixel(image, Math.round((box.minX + box.maxX) / 2), Math.round((box.minY + box.maxY) / 2));
    expect(center[0]).toBeGreaterThan(200);
    expect(nearestBlackDistance(image, box)).toBeGreaterThanOrEqual(6);
    expect(nearestBlackDistance(image, box)).toBeLessThanOrEqual(24);

    const plain = QRCode.create(text, { errorCorrectionLevel: "H" });
    const modulePx = 8;
    const margin = 2;
    for (const [row, col] of [
      [0, 0],
      [0, plain.modules.size - 1],
      [plain.modules.size - 1, 0],
    ]) {
      const x = (col + margin) * modulePx;
      const y = (row + margin) * modulePx;
      const [r, g, b] = pixel(image, x, y);
      expect(r === 0 && g === 0 && b === 0).toBe(plain.modules.get(row, col) === 1);
    }
  });

  it("bakes the app icon so modules sit in the gaps around the cat", async () => {
    const text = "mw1.AAAVdGM6ZmFrZS1taWFvLWFiY2QxMjM0ACBhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYQ";
    const url = await encodeQrDataURL(text, { centerMark: iconUrl });
    expect(url.startsWith("data:image/png")).toBe(true);
    const image = await decodePng(dataUrlBytes(url));
    expect(decodeQrImageData(toClamped(image), image.width, image.height)).toBe(text);
    const logo = boundsWhere(image, (r, g, b) => r !== g || g !== b || (r !== 0 && r !== 255));
    expect(logo).not.toBeNull();
    const box = logo as Box;
    let blackInBox = 0;
    for (let y = box.minY; y <= box.maxY; y++) {
      for (let x = box.minX; x <= box.maxX; x++) {
        const [r, g, b] = pixel(image, x, y);
        if (r === 0 && g === 0 && b === 0) {
          blackInBox += 1;
        }
      }
    }
    expect(blackInBox).toBeGreaterThan(20);
    const widthFraction = (box.maxX - box.minX + 1) / image.width;
    expect(widthFraction).toBeGreaterThan(0.16);
    expect(widthFraction).toBeLessThan(0.26);
  });
});

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function plusMark(): RgbaImage {
  const size = 17;
  const rgba = new Uint8Array(size * size * 4);
  const cx = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const arm = (Math.abs(x - cx) <= 1 && Math.abs(y - cx) <= 6) || (Math.abs(y - cx) <= 1 && Math.abs(x - cx) <= 6);
      const i = (y * size + x) * 4;
      if (arm) {
        rgba[i] = 220;
        rgba[i + 3] = 255;
      }
    }
  }
  return { width: size, height: size, rgba };
}

async function pngDataUrl(image: RgbaImage): Promise<string> {
  const png = await encodePng(image);
  let binary = "";
  for (let i = 0; i < png.length; i++) {
    binary += String.fromCharCode(png[i]);
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function dataUrlBytes(url: string): Uint8Array {
  const body = url.slice(url.indexOf(",") + 1);
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function toClamped(image: RgbaImage): Uint8ClampedArray {
  return new Uint8ClampedArray(image.rgba);
}

function pixel(image: RgbaImage, x: number, y: number): [number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]];
}

function boundsWhere(image: RgbaImage, match: (r: number, g: number, b: number) => boolean): Box | null {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const [r, g, b] = pixel(image, x, y);
      if (!match(r, g, b)) {
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

function nearestBlackDistance(image: RgbaImage, box: Box): number {
  let best = image.width;
  for (let y = box.minY; y <= box.maxY; y++) {
    for (let x = box.minX; x <= box.maxX; x++) {
      const [r, g, b] = pixel(image, x, y);
      if (!(r > 200 && g < 40 && b < 40)) {
        continue;
      }
      for (let oy = -24; oy <= 24; oy++) {
        for (let ox = -24; ox <= 24; ox++) {
          const px = x + ox;
          const py = y + oy;
          if (px < 0 || py < 0 || px >= image.width || py >= image.height) {
            continue;
          }
          const [br, bg, bb] = pixel(image, px, py);
          if (br === 0 && bg === 0 && bb === 0) {
            const dist = Math.max(Math.abs(ox), Math.abs(oy));
            if (dist < best) {
              best = dist;
            }
          }
        }
      }
    }
  }
  return best;
}
