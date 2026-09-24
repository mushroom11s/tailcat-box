import * as QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import miaoQrMark from "../assets/miao-qr-cat.png?inline";
import roomQrMark from "../assets/room-qr-cat.png?inline";
import navyCardFixture from "./fixtures/room-cat-navy-card.png?inline";
import { decodeQrImageData, encodeQrDataURL } from "./qr";
import { decodeQrFromFile } from "./qrImage";
import { decodePng, encodePng, type RgbaImage } from "./qrMark";

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

/** Nearest-neighbor stand-in for image-rendering: pixelated at a CSS size. */
function scaleNearest(image: RgbaImage, width: number, height: number): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const s = (sy * image.width + sx) * 4;
      const d = (y * width + x) * 4;
      rgba[d] = image.rgba[s];
      rgba[d + 1] = image.rgba[s + 1];
      rgba[d + 2] = image.rgba[s + 2];
      rgba[d + 3] = image.rgba[s + 3];
    }
  }
  return { width, height, rgba };
}

function bilinear(image: RgbaImage, width: number, height: number): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  const xScale = image.width / width;
  const yScale = image.height / height;
  for (let y = 0; y < height; y++) {
    const sy = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(image.height - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < width; x++) {
      const sx = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(image.width - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      const d = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const p00 = image.rgba[(y0 * image.width + x0) * 4 + c];
        const p10 = image.rgba[(y0 * image.width + x1) * 4 + c];
        const p01 = image.rgba[(y1 * image.width + x0) * 4 + c];
        const p11 = image.rgba[(y1 * image.width + x1) * 4 + c];
        rgba[d + c] = Math.round(p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy);
      }
    }
  }
  return { width, height, rgba };
}

function roundedCard(qr: RgbaImage): RgbaImage {
  const pad = Math.max(8, Math.round(qr.width * 0.08));
  const radius = Math.max(12, Math.round(qr.width * 0.09));
  const width = qr.width + pad * 2;
  const height = qr.height + pad * 2;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dx = x < radius ? radius - x : x >= width - radius ? x - (width - radius - 1) : 0;
      const dy = y < radius ? radius - y : y >= height - radius ? y - (height - radius - 1) : 0;
      if (dx * dx + dy * dy > radius * radius) {
        continue;
      }
      const qx = x - pad;
      const qy = y - pad;
      if (qx >= 0 && qy >= 0 && qx < qr.width && qy < qr.height) {
        const s = (qy * qr.width + qx) * 4;
        rgba[i] = qr.rgba[s];
        rgba[i + 1] = qr.rgba[s + 1];
        rgba[i + 2] = qr.rgba[s + 2];
        rgba[i + 3] = 255;
      } else {
        rgba[i] = 255;
        rgba[i + 1] = 255;
        rgba[i + 2] = 255;
        rgba[i + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}

function placeOnNavy(card: RgbaImage, width: number, height: number, ox: number, oy: number): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const shade = Math.round(18 + (y / height) * 10);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = shade;
      rgba[i + 1] = shade + 4;
      rgba[i + 2] = shade + 28;
      rgba[i + 3] = 255;
    }
  }
  for (let y = 0; y < card.height; y++) {
    for (let x = 0; x < card.width; x++) {
      const s = (y * card.width + x) * 4;
      if (card.rgba[s + 3] === 0) {
        continue;
      }
      const d = ((oy + y) * width + ox + x) * 4;
      rgba[d] = card.rgba[s];
      rgba[d + 1] = card.rgba[s + 1];
      rgba[d + 2] = card.rgba[s + 2];
      rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function placeOnDark(qr: RgbaImage, width = 1400, height = 900): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 28;
    rgba[i + 1] = 32;
    rgba[i + 2] = 40;
    rgba[i + 3] = 255;
  }
  const ox = 860;
  const oy = 180;
  for (let y = 0; y < qr.height; y++) {
    for (let x = 0; x < qr.width; x++) {
      const s = (y * qr.width + x) * 4;
      const d = ((oy + y) * width + ox + x) * 4;
      rgba[d] = qr.rgba[s];
      rgba[d + 1] = qr.rgba[s + 1];
      rgba[d + 2] = qr.rgba[s + 2];
      rgba[d + 3] = 255;
    }
  }
  return { width, height, rgba };
}

function transparentDarkModules(image: RgbaImage): RgbaImage {
  const rgba = new Uint8Array(image.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] < 16 && rgba[i + 1] < 16 && rgba[i + 2] < 16) {
      rgba[i] = 255;
      rgba[i + 1] = 255;
      rgba[i + 2] = 255;
      rgba[i + 3] = 0;
    }
  }
  return { width: image.width, height: image.height, rgba };
}

function transparentLightModules(image: RgbaImage): RgbaImage {
  const rgba = new Uint8Array(image.rgba);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] > 240 && rgba[i + 1] > 240 && rgba[i + 2] > 240) {
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 0;
    }
  }
  return { width: image.width, height: image.height, rgba };
}

async function pngFile(image: RgbaImage, name = "qr.png"): Promise<File> {
  const png = await encodePng(image);
  const buffer = new ArrayBuffer(png.byteLength);
  new Uint8Array(buffer).set(png);
  return new File([buffer], name, { type: "image/png" });
}

async function rasterPng(url: string): Promise<RgbaImage> {
  return decodePng(dataUrlBytes(url));
}

describe("decodeQrFromFile", () => {
  it("reads a plain QR image", async () => {
    const text = "tc:plain-room";
    const image = await rasterPng(await QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 2, width: 280 }));
    await expect(decodeQrFromFile(await pngFile(image))).resolves.toBe(text);
  });

  it("reads a center-logo QR at the Mew Share display size", async () => {
    const text = `mw1.${"A".repeat(200)}`;
    const image = await rasterPng(await encodeQrDataURL(text, { centerMark: miaoQrMark }));
    const displayed = scaleNearest(image, 172, 172);
    expect(decodeQrImageData(toClamped(displayed), displayed.width, displayed.height)).toBeNull();
    await expect(decodeQrFromFile(await pngFile(displayed))).resolves.toBe(text);
    const aliased = scaleNearest(image, 244, 244);
    expect(decodeQrImageData(toClamped(aliased), aliased.width, aliased.height)).toBeNull();
    await expect(decodeQrFromFile(await pngFile(aliased))).resolves.toBe(text);
  });

  it("reads a room logo QR and a screenshot that only contains the displayed code", async () => {
    const room = "tc:fake-room-abc";
    const roomImage = await rasterPng(await encodeQrDataURL(room, { centerMark: roomQrMark }));
    await expect(decodeQrFromFile(await pngFile(roomImage))).resolves.toBe(room);

    const text = `mw1.${"A".repeat(200)}`;
    const displayed = scaleNearest(await rasterPng(await encodeQrDataURL(text, { centerMark: miaoQrMark })), 172, 172);
    const shot = placeOnDark(displayed);
    await expect(decodeQrFromFile(await pngFile(shot))).resolves.toBe(text);

    const retina = scaleNearest(await rasterPng(await encodeQrDataURL(text, { centerMark: miaoQrMark })), 344, 344);
    const desktop = placeOnDark(retina, 2560, 1440);
    await expect(decodeQrFromFile(await pngFile(desktop))).resolves.toBe(text);
  });

  it("reads a logo QR whose dark modules are transparent white", async () => {
    const text = "tc:fake-room-abc";
    const image = transparentDarkModules(await rasterPng(await encodeQrDataURL(text, { centerMark: roomQrMark })));
    expect(decodeQrImageData(toClamped(image), image.width, image.height)).toBeNull();
    await expect(decodeQrFromFile(await pngFile(image))).resolves.toBe(text);
  });

  it("reads a logo QR whose light modules are transparent black", async () => {
    const text = "tc:fake-room-abc";
    const image = transparentLightModules(await rasterPng(await encodeQrDataURL(text, { centerMark: roomQrMark })));
    expect(decodeQrImageData(toClamped(image), image.width, image.height)).toBeNull();
    await expect(decodeQrFromFile(await pngFile(image))).resolves.toBe(text);
  });

  it("reads a miao-cat QR on a white card inside a large navy screenshot", async () => {
    const text = `mw1.${"A".repeat(160)}`;
    const native = await rasterPng(await encodeQrDataURL(text, { centerMark: miaoQrMark }));
    const card = roundedCard(bilinear(native, 172, 172));
    const shot = placeOnNavy(card, 1440, 900, Math.round(1440 * 0.62), Math.round(900 * 0.18));
    expect(decodeQrImageData(toClamped(shot), shot.width, shot.height)).toBeNull();
    await expect(decodeQrFromFile(await pngFile(shot, "miao-navy-card.png"))).resolves.toBe(text);
  });

  it("reads a room-cat QR on a white card inside a large navy screenshot", async () => {
    const text = `mw1.${"A".repeat(160)}`;
    const native = await rasterPng(await encodeQrDataURL(text, { centerMark: roomQrMark }));
    const card = roundedCard(bilinear(native, 172, 172));
    for (const [width, height] of [
      [1440, 900],
      [3024, 1964],
    ] as const) {
      const shot = placeOnNavy(card, width, height, Math.round(width * 0.62), Math.round(height * 0.18));
      expect(decodeQrImageData(toClamped(shot), shot.width, shot.height)).toBeNull();
      await expect(decodeQrFromFile(await pngFile(shot, "navy-card.png"))).resolves.toBe(text);
    }
  });

  it("reads the committed navy-card room QR fixture", async () => {
    const text = `mw1.${"A".repeat(160)}`;
    const image = await decodePng(dataUrlBytes(navyCardFixture));
    expect(image.width).toBe(1440);
    expect(image.height).toBe(900);
    expect(decodeQrImageData(toClamped(image), image.width, image.height)).toBeNull();
    await expect(decodeQrFromFile(await pngFile(image, "room-cat-navy-card.png"))).resolves.toBe(text);
  });

  it("does not invent a payload for a blank white card", async () => {
    const card = roundedCard({ width: 180, height: 180, rgba: new Uint8Array(180 * 180 * 4).fill(255) });
    const shot = placeOnNavy(card, 900, 600, 360, 80);
    await expect(decodeQrFromFile(await pngFile(shot, "blank-card.png"))).resolves.toBeNull();
  });
});
