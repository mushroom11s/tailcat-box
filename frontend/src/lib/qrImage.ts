import { decodeQrImageData } from "./qr";
import { decodePng } from "./qrMark";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Resamples that realign modules after a non-integer screenshot scale. */
const SCALES = [0.5, 0.75, 0.95, 1.05, 1.25, 1.5, 2, 0.25, 1 / 3];
const MIN_QR = 21;
const MIN_EDGE = 48;
const MAX_EDGE = 1200;
const NATIVE_LIMIT = 1600;

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

/** jsQR ignores alpha, so transparent light modules stored as black disappear. */
function flattenOnWhite(data: Uint8ClampedArray): Uint8ClampedArray {
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      transparent = true;
      break;
    }
  }
  if (!transparent) {
    return data;
  }
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const keep = 1 - alpha;
    out[i] = data[i] * alpha + 255 * keep;
    out[i + 1] = data[i + 1] * alpha + 255 * keep;
    out[i + 2] = data[i + 2] * alpha + 255 * keep;
    out[i + 3] = 255;
  }
  return out;
}

function nearest(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    const srcRow = sy * sw;
    const dstRow = y * dw;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const s = (srcRow + sx) * 4;
      const d = (dstRow + x) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
  return out;
}

/**
 * Decode one QR from RGBA pixels.
 * A single jsQR pass misses logo codes that were screenshotted at a CSS size
 * (the Mew Share code is drawn at 172px) and PNGs whose light modules are transparent.
 */
export function decodeQrBitmap(data: Uint8ClampedArray, width: number, height: number): string | null {
  if (width < MIN_QR || height < MIN_QR || data.length < width * height * 4) {
    return null;
  }
  const flat = flattenOnWhite(data);
  const seen = new Set<string>();
  const sizes: Array<{ w: number; h: number }> = [];
  const add = (w: number, h: number, allowSmall: boolean) => {
    if (w < MIN_QR || h < MIN_QR) {
      return;
    }
    const edge = Math.max(w, h);
    if (allowSmall) {
      if (edge > NATIVE_LIMIT) {
        return;
      }
    } else if (edge < MIN_EDGE || edge > MAX_EDGE) {
      return;
    }
    const key = `${w}x${h}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    sizes.push({ w, h });
  };
  add(width, height, true);
  for (const scale of SCALES) {
    add(Math.round(width * scale), Math.round(height * scale), false);
  }
  if (Math.max(width, height) > MAX_EDGE) {
    const fit = MAX_EDGE / Math.max(width, height);
    add(Math.round(width * fit), Math.round(height * fit), false);
  }
  for (const size of sizes) {
    const pixels = size.w === width && size.h === height ? flat : nearest(flat, width, height, size.w, size.h);
    const text = decodeQrImageData(pixels, size.w, size.h);
    if (text) {
      return text;
    }
  }
  return null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = url;
  });
}

function decodeDrawable(source: CanvasImageSource, width: number, height: number): string | null {
  if (width < 1 || height < 1) {
    return null;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  return decodeQrBitmap(image.data, image.width, image.height);
}

/** Decode the first QR code in an image file. Returns null when none is found. */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isPng(bytes)) {
    try {
      const image = await decodePng(bytes);
      return decodeQrBitmap(new Uint8ClampedArray(image.rgba), image.width, image.height);
    } catch {
      // Palette, grayscale, or interlaced PNGs fall through to the canvas decoder.
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type || "image/png" }));
  try {
    const image = await loadImage(url);
    return decodeDrawable(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
