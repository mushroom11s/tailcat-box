import { decodeQrImageData } from "./qr";
import { decodePng } from "./qrMark";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Resamples that realign modules after a non-integer screenshot scale. */
const SCALES = [0.5, 0.75, 0.95, 1.05, 1.25, 1.5, 2, 3, 0.25, 1 / 3];
const MIN_QR = 21;
const MIN_EDGE = 48;
const MAX_EDGE = 1200;
const NATIVE_LIMIT = 1600;
/** Light card on a dark page. Navy glass sits well below this. */
const CARD_LUMA = 170;

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function hasPartialAlpha(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      return true;
    }
  }
  return false;
}

/** jsQR ignores alpha, so transparent light modules stored as black disappear. */
function flattenOn(data: Uint8ClampedArray, background: number): Uint8ClampedArray {
  if (!hasPartialAlpha(data)) {
    return data;
  }
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const keep = 1 - alpha;
    out[i] = data[i] * alpha + background * keep;
    out[i + 1] = data[i + 1] * alpha + background * keep;
    out[i + 2] = data[i + 2] * alpha + background * keep;
    out[i + 3] = 255;
  }
  return out;
}

/** Clipboard bitmaps are sometimes premultiplied; straight-alpha compositing then stays too dark. */
function unpremultiply(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0 || alpha === 255) {
      out[i] = data[i];
      out[i + 1] = data[i + 1];
      out[i + 2] = data[i + 2];
      out[i + 3] = alpha;
      continue;
    }
    out[i] = Math.min(255, Math.round((data[i] * 255) / alpha));
    out[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / alpha));
    out[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / alpha));
    out[i + 3] = alpha;
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

function luma(data: Uint8ClampedArray, index: number): number {
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

type Bounds = { x: number; y: number; w: number; h: number };

function brightCards(data: Uint8ClampedArray, width: number, height: number): Bounds[] {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 180));
  const gridW = Math.ceil(width / step);
  const gridH = Math.ceil(height / step);
  const mask = new Uint8Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy++) {
    const y = Math.min(height - 1, gy * step);
    for (let gx = 0; gx < gridW; gx++) {
      const x = Math.min(width - 1, gx * step);
      if (luma(data, (y * width + x) * 4) >= CARD_LUMA) {
        mask[gy * gridW + gx] = 1;
      }
    }
  }
  const seen = new Uint8Array(mask.length);
  const cards: Bounds[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) {
      continue;
    }
    let minX = gridW;
    let minY = gridH;
    let maxX = -1;
    let maxY = -1;
    let area = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const index = stack.pop() as number;
      const gx = index % gridW;
      const gy = Math.floor(index / gridW);
      area += 1;
      if (gx < minX) minX = gx;
      if (gy < minY) minY = gy;
      if (gx > maxX) maxX = gx;
      if (gy > maxY) maxY = gy;
      const neighbors = [index - 1, index + 1, index - gridW, index + gridW];
      for (const next of neighbors) {
        if (next < 0 || next >= mask.length || seen[next] || !mask[next]) {
          continue;
        }
        if ((index % gridW === 0 && next === index - 1) || (next % gridW === 0 && next === index + 1)) {
          continue;
        }
        seen[next] = 1;
        stack.push(next);
      }
    }
    const roughX = Math.max(0, minX * step - step);
    const roughY = Math.max(0, minY * step - step);
    const roughR = Math.min(width - 1, (maxX + 1) * step + step - 1);
    const roughB = Math.min(height - 1, (maxY + 1) * step + step - 1);
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = roughY; y <= roughB; y++) {
      const row = y * width;
      for (let x = roughX; x <= roughR; x++) {
        if (luma(data, (row + x) * 4) < CARD_LUMA) {
          continue;
        }
        if (x < left) left = x;
        if (y < top) top = y;
        if (x > right) right = x;
        if (y > bottom) bottom = y;
      }
    }
    if (right < 0) {
      continue;
    }
    const w = right - left + 1;
    const h = bottom - top + 1;
    const aspect = w / h;
    if (w < MIN_EDGE || h < MIN_EDGE || aspect < 0.45 || aspect > 2.2) {
      continue;
    }
    if ((w * h) / (width * height) > 0.9 || area < 12) {
      continue;
    }
    cards.push({ x: left, y: top, w, h });
  }
  cards.sort((a, b) => b.w * b.h - a.w * a.h);
  return cards.slice(0, 2);
}

function crop(data: Uint8ClampedArray, width: number, bounds: Bounds): Uint8ClampedArray {
  const out = new Uint8ClampedArray(bounds.w * bounds.h * 4);
  for (let y = 0; y < bounds.h; y++) {
    const src = ((bounds.y + y) * width + bounds.x) * 4;
    out.set(data.subarray(src, src + bounds.w * 4), y * bounds.w * 4);
  }
  return out;
}

function contrastStretch(data: Uint8ClampedArray): Uint8ClampedArray {
  let min = 255;
  let max = 0;
  const step = Math.max(1, Math.floor(data.length / 4 / 4000)) * 4;
  for (let i = 0; i < data.length; i += step) {
    const y = luma(data, i);
    if (y < min) min = y;
    if (y > max) max = y;
  }
  if (max - min < 40 || (min < 12 && max > 243)) {
    return data;
  }
  const span = max - min;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = Math.max(0, Math.min(255, ((data[i] - min) * 255) / span));
    out[i + 1] = Math.max(0, Math.min(255, ((data[i + 1] - min) * 255) / span));
    out[i + 2] = Math.max(0, Math.min(255, ((data[i + 2] - min) * 255) / span));
    out[i + 3] = 255;
  }
  return out;
}

/** Drop a colored or gray center mark so it cannot impersonate an alignment pattern. */
function maskCenterLogo(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const box = Math.round(Math.min(width, height) * 0.42);
  const x0 = Math.floor((width - box) / 2);
  const y0 = Math.floor((height - box) / 2);
  for (let y = y0; y < y0 + box; y++) {
    for (let x = x0; x < x0 + box; x++) {
      const i = (y * width + x) * 4;
      const yv = luma(out, i);
      const chroma = Math.max(out[i], out[i + 1], out[i + 2]) - Math.min(out[i], out[i + 1], out[i + 2]);
      if (yv > 55 && (yv < 200 || chroma > 28)) {
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
        out[i + 3] = 255;
      }
    }
  }
  return out;
}

function scanPrepared(data: Uint8ClampedArray, width: number, height: number): string | null {
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
    const pixels = size.w === width && size.h === height ? data : nearest(data, width, height, size.w, size.h);
    const text = decodeQrImageData(pixels, size.w, size.h);
    if (text) {
      return text;
    }
  }
  return null;
}

/**
 * Decode one QR from RGBA pixels.
 * A single jsQR pass misses logo codes that were screenshotted at a CSS size
 * (the Mew Share code is drawn at 172px), PNGs whose light modules are transparent,
 * and a code sitting on a white card inside a much larger dark screenshot.
 */
export function decodeQrBitmap(data: Uint8ClampedArray, width: number, height: number): string | null {
  if (width < MIN_QR || height < MIN_QR || data.length < width * height * 4) {
    return null;
  }
  const variants = [flattenOn(data, 255)];
  if (hasPartialAlpha(data)) {
    variants.push(flattenOn(unpremultiply(data), 255));
    variants.push(flattenOn(data, 0));
  }
  for (const flat of variants) {
    const direct = scanPrepared(flat, width, height);
    if (direct) {
      return direct;
    }
  }
  for (const flat of variants) {
    for (const bounds of brightCards(flat, width, height)) {
      const region = crop(flat, width, bounds);
      const fromCard = scanPrepared(region, bounds.w, bounds.h);
      if (fromCard) {
        return fromCard;
      }
      const stretched = scanPrepared(contrastStretch(region), bounds.w, bounds.h);
      if (stretched) {
        return stretched;
      }
      const masked = scanPrepared(maskCenterLogo(region, bounds.w, bounds.h), bounds.w, bounds.h);
      if (masked) {
        return masked;
      }
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
