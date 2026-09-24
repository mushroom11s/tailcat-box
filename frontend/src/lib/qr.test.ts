import * as QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import iconUrl from "../assets/icon.png?inline";
import miaoQrMark from "../assets/miao-qr-cat.png?inline";
import roomQrMark from "../assets/room-qr-cat.png?inline";
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
    const gap = nearestBlackDistance(image, box);
    expect(gap).toBeGreaterThanOrEqual(3);
    expect(gap).toBeLessThanOrEqual(12);

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
    const icon = await decodePng(dataUrlBytes(iconUrl));
    expect(transparentFraction(icon)).toBeGreaterThan(0.15);
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

  it("keeps the warm door on the left of the room mark and still scans", async () => {
    const logo = await decodePng(dataUrlBytes(roomQrMark));
    const opaque = boundsWhere(logo, (_r, _g, _b, a) => a >= 128);
    expect(opaque).not.toBeNull();
    const art = opaque as Box;
    let warmDoor = 0;
    let darkLeft = 0;
    let clear = 0;
    const leftEdge = art.minX + Math.max(1, Math.round((art.maxX - art.minX + 1) * 0.18));
    for (let y = 0; y < logo.height; y++) {
      for (let x = 0; x < logo.width; x++) {
        const i = (y * logo.width + x) * 4;
        const a = logo.rgba[i + 3];
        if (a < 128) {
          clear += 1;
          continue;
        }
        if (x > leftEdge || y < art.minY || y > art.maxY) {
          continue;
        }
        const r = logo.rgba[i];
        const g = logo.rgba[i + 1];
        const b = logo.rgba[i + 2];
        const lum = (r + g + b) / 3;
        if (r > 220 && r - b >= 6 && lum > 200) {
          warmDoor += 1;
        }
        if (lum <= 40) {
          darkLeft += 1;
        }
      }
    }
    expect(clear).toBeGreaterThan(0);
    expect(warmDoor).toBeGreaterThan(darkLeft);
    expect(warmDoor).toBeGreaterThan(200);

    const text = "tc:fake-room-abc";
    const url = await encodeQrDataURL(text, { centerMark: roomQrMark });
    expect(url.startsWith("data:image/png")).toBe(true);
    const image = await decodePng(dataUrlBytes(url));
    expect(decodeQrImageData(toClamped(image), image.width, image.height)).toBe(text);
    const painted = boundsWhere(image, (r, g, b) => r !== g || g !== b || (r !== 0 && r !== 255));
    expect(painted).not.toBeNull();
    const box = painted as Box;
    let light = 0;
    const doorX = box.minX + Math.max(1, Math.round((box.maxX - box.minX + 1) * 0.22));
    for (let y = box.minY; y <= box.maxY; y++) {
      for (let x = box.minX; x <= doorX; x++) {
        const [r, g, b] = pixel(image, x, y);
        if ((r + g + b) / 3 > 180 && r - b >= 4) {
          light += 1;
        }
      }
    }
    expect(light).toBeGreaterThan(10);
  });

  it("wraps room QR modules into the cat silhouette instead of a rectangular hole", async () => {
    const logo = await decodePng(dataUrlBytes(roomQrMark));
    expect(transparentFraction(logo)).toBeGreaterThan(0.12);
    for (const [x, y] of [
      [0, 0],
      [logo.width - 1, 0],
      [0, logo.height - 1],
      [logo.width - 1, logo.height - 1],
    ]) {
      expect(logo.rgba[(y * logo.width + x) * 4 + 3]).toBe(0);
    }

    const text = "tc:fake-room-abc";
    const url = await encodeQrDataURL(text, { errorCorrectionLevel: "H", centerMark: roomQrMark });
    expect(url.startsWith("data:image/png")).toBe(true);
    const image = await decodePng(dataUrlBytes(url));
    expect(decodeQrImageData(toClamped(image), image.width, image.height)).toBe(text);

    const painted = boundsWhere(image, (r, g, b) => r !== g || g !== b || (r !== 0 && r !== 255));
    expect(painted).not.toBeNull();
    const box = painted as Box;
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
    expect(mostlyBlackModules(image, box)).toBeGreaterThan(0);

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

  it("bakes the miao share cat on a clear background and still scans", async () => {
    const logo = await decodePng(dataUrlBytes(miaoQrMark));
    expect(transparentFraction(logo)).toBeGreaterThan(0.15);
    expect(logo.height / logo.width).toBeGreaterThan(1.12);
    expect(logo.height / logo.width).toBeLessThan(1.35);
    for (const [x, y] of [
      [0, 0],
      [logo.width - 1, 0],
      [0, logo.height - 1],
      [logo.width - 1, logo.height - 1],
    ]) {
      expect(logo.rgba[(y * logo.width + x) * 4 + 3]).toBe(0);
    }

    let pink = 0;
    const earBottom = Math.round(logo.height * 0.42);
    for (let y = 0; y < earBottom; y++) {
      for (let x = 0; x < logo.width; x++) {
        const i = (y * logo.width + x) * 4;
        const r = logo.rgba[i];
        const g = logo.rgba[i + 1];
        const b = logo.rgba[i + 2];
        const a = logo.rgba[i + 3];
        if (a >= 128 && r > 200 && r - g > 25 && r - b > 40) {
          pink += 1;
        }
      }
    }
    expect(pink).toBeGreaterThan(2000);

    // The tray is a solid edge. Watermark glyphs would be a sparse gray row under it.
    for (let y = logo.height - 6; y < logo.height; y++) {
      let opaque = 0;
      for (let x = 0; x < logo.width; x++) {
        if (logo.rgba[(y * logo.width + x) * 4 + 3] >= 128) {
          opaque += 1;
        }
      }
      expect(opaque).toBeGreaterThan(logo.width * 0.5);
    }

    const text = "mw1.AAAVdGM6ZmFrZS1taWFvLWFiY2QxMjM0ACBhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYQ";
    const url = await encodeQrDataURL(text, { errorCorrectionLevel: "H", centerMark: miaoQrMark });
    expect(url.startsWith("data:image/png")).toBe(true);
    const image = await decodePng(dataUrlBytes(url));
    expect(decodeQrImageData(toClamped(image), image.width, image.height)).toBe(text);

    const painted = boundsWhere(image, (r, g, b) => r !== g || g !== b || (r !== 0 && r !== 255));
    expect(painted).not.toBeNull();
    const box = painted as Box;
    const widthFraction = (box.maxX - box.minX + 1) / image.width;
    const heightFraction = (box.maxY - box.minY + 1) / image.height;
    expect(widthFraction).toBeGreaterThan(0.16);
    expect(widthFraction).toBeLessThan(0.26);
    expect(heightFraction).toBeLessThan(0.32);
    let blackInside = 0;
    for (let y = box.minY; y <= box.maxY; y++) {
      for (let x = box.minX; x <= box.maxX; x++) {
        const [r, g, b] = pixel(image, x, y);
        if (r === 0 && g === 0 && b === 0) {
          blackInside += 1;
        }
      }
    }
    expect(blackInside).toBeGreaterThan(20);

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

  it("clears a solid rectangle and keeps QR inside a transparent notch", async () => {
    const text = "tc:fake-room-abc";
    const solidUrl = await encodeQrDataURL(text, { errorCorrectionLevel: "H", centerMark: await pngDataUrl(blockMark(false)) });
    const notchedUrl = await encodeQrDataURL(text, { errorCorrectionLevel: "H", centerMark: await pngDataUrl(blockMark(true)) });
    const solid = await decodePng(dataUrlBytes(solidUrl));
    const notched = await decodePng(dataUrlBytes(notchedUrl));
    expect(decodeQrImageData(toClamped(solid), solid.width, solid.height)).toBe(text);
    expect(decodeQrImageData(toClamped(notched), notched.width, notched.height)).toBe(text);
    const solidBox = boundsWhere(solid, (r, g, b) => g > 120 && r < 40 && b < 40);
    const notchedBox = boundsWhere(notched, (r, g, b) => g > 120 && r < 40 && b < 40);
    expect(solidBox).not.toBeNull();
    expect(notchedBox).not.toBeNull();
    expect(mostlyBlackModules(solid, solidBox as Box)).toBe(0);
    expect(mostlyBlackModules(notched, notchedBox as Box)).toBeGreaterThan(0);
  });
});

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function blockMark(notch: boolean): RgbaImage {
  const size = 48;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (notch && x >= 18 && x < 36 && y < 16) {
        continue;
      }
      const i = (y * size + x) * 4;
      rgba[i + 1] = 160;
      rgba[i + 3] = 255;
    }
  }
  return { width: size, height: size, rgba };
}

function mostlyBlackModules(image: RgbaImage, box: Box): number {
  const modulePx = 8;
  let kept = 0;
  for (let my = Math.floor(box.minY / modulePx); my <= Math.floor(box.maxY / modulePx); my++) {
    for (let mx = Math.floor(box.minX / modulePx); mx <= Math.floor(box.maxX / modulePx); mx++) {
      let black = 0;
      for (let y = my * modulePx; y < (my + 1) * modulePx; y++) {
        for (let x = mx * modulePx; x < (mx + 1) * modulePx; x++) {
          if (x < box.minX || y < box.minY || x > box.maxX || y > box.maxY) {
            continue;
          }
          const [r, g, b] = pixel(image, x, y);
          if (r === 0 && g === 0 && b === 0) {
            black += 1;
          }
        }
      }
      if (black >= 32) {
        kept += 1;
      }
    }
  }
  return kept;
}

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

function boundsWhere(image: RgbaImage, match: (r: number, g: number, b: number, a: number) => boolean): Box | null {
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
      const a = image.rgba[i + 3];
      if (!match(r, g, b, a)) {
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

function transparentFraction(image: RgbaImage): number {
  const art = boundsWhere(image, (_r, _g, _b, a) => a >= 128);
  if (!art) {
    return 1;
  }
  let transparent = 0;
  let area = 0;
  for (let y = art.minY; y <= art.maxY; y++) {
    for (let x = art.minX; x <= art.maxX; x++) {
      area += 1;
      if (image.rgba[(y * image.width + x) * 4 + 3] < 128) {
        transparent += 1;
      }
    }
  }
  return area === 0 ? 1 : transparent / area;
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
