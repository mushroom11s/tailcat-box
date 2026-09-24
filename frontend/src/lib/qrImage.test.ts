import * as QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import iconUrl from "../assets/icon.png?inline";
import roomQrMark from "../assets/room-qr-cat.png?inline";
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
    const image = await rasterPng(await encodeQrDataURL(text, { centerMark: iconUrl }));
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
    const displayed = scaleNearest(await rasterPng(await encodeQrDataURL(text, { centerMark: iconUrl })), 172, 172);
    const shot = placeOnDark(displayed);
    await expect(decodeQrFromFile(await pngFile(shot))).resolves.toBe(text);

    const retina = scaleNearest(await rasterPng(await encodeQrDataURL(text, { centerMark: iconUrl })), 344, 344);
    const desktop = placeOnDark(retina, 2560, 1440);
    await expect(decodeQrFromFile(await pngFile(desktop))).resolves.toBe(text);
  });

  it("reads a logo QR whose light modules are transparent black", async () => {
    const text = "tc:fake-room-abc";
    const image = transparentLightModules(await rasterPng(await encodeQrDataURL(text, { centerMark: roomQrMark })));
    expect(decodeQrImageData(toClamped(image), image.width, image.height)).toBeNull();
    await expect(decodeQrFromFile(await pngFile(image))).resolves.toBe(text);
  });
});
