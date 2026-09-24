import * as QRCode from "qrcode";
import type { QrErrorCorrection } from "./qr";

/** Longer side of the trimmed mark, as a fraction of the QR bitmap width. */
const MARK_FRACTION = 0.2;
/** White modules kept around the opaque silhouette. One module stays tight. */
const QUIET_MODULES = 1;
const MODULE_PX = 8;
const MARGIN = 2;
const ALPHA_ON = 128;

export type RgbaImage = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const signed = new Uint8Array(4 + data.length);
  signed.set(typeBytes, 0);
  signed.set(data, 4);
  view.setUint32(8 + data.length, crc32(signed));
  return out;
}

function blobOf(data: Uint8Array): Blob {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return new Blob([buffer]);
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = blobOf(data).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zlibInflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = blobOf(data).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, rgba } = image;
  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + stride);
    raw[row] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), row + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, chunk("IHDR", ihdr), chunk("IDAT", await zlibDeflate(raw)), chunk("IEND", new Uint8Array())];
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((value, index) => bytes[index] !== value)) {
    throw new Error("png");
  }
  let width = 0;
  let height = 0;
  let colorType = -1;
  const idatParts: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = view.getUint32(0);
      height = view.getUint32(4);
      if (data[8] !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error("png");
      }
      colorType = data[9];
    } else if (type === "IDAT") {
      idatParts.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (width < 1 || height < 1 || (colorType !== 2 && colorType !== 6)) {
    throw new Error("png");
  }
  const idat = new Uint8Array(idatParts.reduce((sum, part) => sum + part.length, 0));
  let idatOffset = 0;
  for (const part of idatParts) {
    idat.set(part, idatOffset);
    idatOffset += part.length;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = await zlibInflate(idat);
  const unfiltered = new Uint8Array(height * stride);
  let pos = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[pos];
    pos += 1;
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const dest = unfiltered.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? dest[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let value = row[x];
      if (filter === 1) {
        value = (value + left) & 255;
      } else if (filter === 2) {
        value = (value + up) & 255;
      } else if (filter === 3) {
        value = (value + ((left + up) >> 1)) & 255;
      } else if (filter === 4) {
        value = (value + paeth(left, up, upLeft)) & 255;
      } else if (filter !== 0) {
        throw new Error("png");
      }
      dest[x] = value;
    }
    prev = dest;
  }
  if (colorType === 6) {
    return { width, height, rgba: unfiltered };
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < unfiltered.length; i += 3, j += 4) {
    rgba[j] = unfiltered[i];
    rgba[j + 1] = unfiltered[i + 1];
    rgba[j + 2] = unfiltered[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}

function bytesToBase64(bytes: Uint8Array): string {
  const table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += table[(triple >> 18) & 63];
    out += table[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? table[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? table[triple & 63] : "=";
  }
  return out;
}

function dataUrlBytes(url: string): Uint8Array {
  const comma = url.indexOf(",");
  if (comma < 0) {
    throw new Error("mark");
  }
  const meta = url.slice(0, comma);
  const body = url.slice(comma + 1);
  if (!/;base64/i.test(meta)) {
    return new TextEncoder().encode(decodeURIComponent(body));
  }
  const binary = atob(body);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function loadMark(mark: string | HTMLImageElement): Promise<RgbaImage> {
  const src = typeof mark === "string" ? mark : mark.currentSrc || mark.src;
  if (!src) {
    throw new Error("mark");
  }
  if (src.startsWith("data:")) {
    return decodePng(dataUrlBytes(src));
  }
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error("mark");
  }
  return decodePng(new Uint8Array(await response.arrayBuffer()));
}

function isFinder(row: number, col: number, size: number): boolean {
  const top = row < 7;
  const bottom = row >= size - 7;
  const left = col < 7;
  const right = col >= size - 7;
  return (top && left) || (top && right) || (bottom && left);
}

function trimContent(image: RgbaImage): { minX: number; minY: number; width: number; height: number } {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.rgba[(y * image.width + x) * 4 + 3] < ALPHA_ON) {
        continue;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) {
    throw new Error("mark");
  }
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Draw a level-H (or caller-selected) QR and punch modules only where the
 * mark's opaque silhouette, expanded by one module, covers them. Finders stay.
 */
export async function composeMarkedQrPng(
  text: string,
  errorCorrectionLevel: QrErrorCorrection,
  mark: string | HTMLImageElement,
): Promise<string> {
  const qr = QRCode.create(text, { errorCorrectionLevel });
  const source = await loadMark(mark);
  const trimmed = trimContent(source);
  const modules = qr.modules.size;
  const count = modules + MARGIN * 2;
  const size = count * MODULE_PX;
  const guard = (7 + QUIET_MODULES) * MODULE_PX;
  const maxEdge = Math.max(MODULE_PX, size - guard * 2);
  let destW = Math.max(1, Math.round(size * MARK_FRACTION));
  let destH = Math.max(1, Math.round((destW * trimmed.height) / trimmed.width));
  const edge = Math.max(destW, destH);
  if (edge > maxEdge) {
    const fit = maxEdge / edge;
    destW = Math.max(1, Math.round(destW * fit));
    destH = Math.max(1, Math.round(destH * fit));
  }
  const originX = Math.round((size - destW) / 2);
  const originY = Math.round((size - destH) / 2);

  const hit = new Uint8Array(count * count);
  for (let dy = 0; dy < destH; dy++) {
    const sy = trimmed.minY + Math.min(trimmed.height - 1, Math.floor((dy * trimmed.height) / destH));
    for (let dx = 0; dx < destW; dx++) {
      const sx = trimmed.minX + Math.min(trimmed.width - 1, Math.floor((dx * trimmed.width) / destW));
      if (source.rgba[(sy * source.width + sx) * 4 + 3] < ALPHA_ON) {
        continue;
      }
      const mx = Math.floor((originX + dx) / MODULE_PX);
      const my = Math.floor((originY + dy) / MODULE_PX);
      if (mx >= 0 && my >= 0 && mx < count && my < count) {
        hit[my * count + mx] = 1;
      }
    }
  }

  const clear = new Uint8Array(count * count);
  for (let my = 0; my < count; my++) {
    for (let mx = 0; mx < count; mx++) {
      let covered = false;
      for (let oy = -QUIET_MODULES; oy <= QUIET_MODULES && !covered; oy++) {
        for (let ox = -QUIET_MODULES; ox <= QUIET_MODULES; ox++) {
          const x = mx + ox;
          const y = my + oy;
          if (x >= 0 && y >= 0 && x < count && y < count && hit[y * count + x]) {
            covered = true;
            break;
          }
        }
      }
      if (!covered) {
        continue;
      }
      const col = mx - MARGIN;
      const row = my - MARGIN;
      if (col < 0 || row < 0 || col >= modules || row >= modules || isFinder(row, col, modules)) {
        continue;
      }
      clear[my * count + mx] = 1;
    }
  }

  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 255;
    pixels[i + 1] = 255;
    pixels[i + 2] = 255;
    pixels[i + 3] = 255;
  }
  for (let row = 0; row < modules; row++) {
    for (let col = 0; col < modules; col++) {
      const mx = col + MARGIN;
      const my = row + MARGIN;
      if (clear[my * count + mx] || qr.modules.get(row, col) !== 1) {
        continue;
      }
      const x0 = mx * MODULE_PX;
      const y0 = my * MODULE_PX;
      for (let y = 0; y < MODULE_PX; y++) {
        for (let x = 0; x < MODULE_PX; x++) {
          const i = ((y0 + y) * size + (x0 + x)) * 4;
          pixels[i] = 0;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
        }
      }
    }
  }

  for (let dy = 0; dy < destH; dy++) {
    const sy = trimmed.minY + Math.min(trimmed.height - 1, Math.floor((dy * trimmed.height) / destH));
    for (let dx = 0; dx < destW; dx++) {
      const sx = trimmed.minX + Math.min(trimmed.width - 1, Math.floor((dx * trimmed.width) / destW));
      const si = (sy * source.width + sx) * 4;
      if (source.rgba[si + 3] < ALPHA_ON) {
        continue;
      }
      const px = originX + dx;
      const py = originY + dy;
      const col = Math.floor(px / MODULE_PX) - MARGIN;
      const row = Math.floor(py / MODULE_PX) - MARGIN;
      if (row >= 0 && col >= 0 && row < modules && col < modules && isFinder(row, col, modules)) {
        continue;
      }
      const i = (py * size + px) * 4;
      pixels[i] = source.rgba[si];
      pixels[i + 1] = source.rgba[si + 1];
      pixels[i + 2] = source.rgba[si + 2];
      pixels[i + 3] = 255;
    }
  }

  const png = await encodePng({ width: size, height: size, rgba: pixels });
  return `data:image/png;base64,${bytesToBase64(png)}`;
}
