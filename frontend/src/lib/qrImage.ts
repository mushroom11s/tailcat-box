import { decodeQrImageData } from "./qr";

type Size = { w: number; h: number };

function targetSizes(width: number, height: number): Size[] {
  if (width < 1 || height < 1) {
    return [];
  }
  const sizes: Size[] = [{ w: width, h: height }];
  const maxEdge = Math.max(width, height);
  if (maxEdge > 1200) {
    const scale = 1200 / maxEdge;
    sizes.push({ w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) });
  }
  const half = sizes[sizes.length - 1];
  if (half.w > 80 && half.h > 80) {
    sizes.push({ w: Math.round(half.w / 2), h: Math.round(half.h / 2) });
  }
  return sizes;
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
  for (const size of targetSizes(width, height)) {
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return null;
    }
    ctx.drawImage(source, 0, 0, size.w, size.h);
    const image = ctx.getImageData(0, 0, size.w, size.h);
    const text = decodeQrImageData(image.data, image.width, image.height);
    if (text) {
      return text;
    }
  }
  return null;
}

/** Decode the first QR code in an image file. Returns null when none is found. */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    return decodeDrawable(image, image.naturalWidth || image.width, image.naturalHeight || image.height);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
