/** Copy the QR image the UI is showing, as a PNG the peer can paste. */

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    throw new Error("bad-image");
  }
  const meta = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const mime = meta.split(";")[0] || "application/octet-stream";
  const binary = meta.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return new Blob([bytes], { type: mime });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof canvas.toBlob === "function") {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("blob"));
      }, "image/png");
    });
  }
  return Promise.resolve(dataUrlToBlob(canvas.toDataURL("image/png")));
}

function rasterizeToPng(src: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) {
        reject(new Error("image"));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      void canvasToPng(canvas).then(resolve, reject);
    };
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });
}

/** PNG data URLs are copied as-is. Other images (such as SVG QR codes) are rasterized to PNG. */
export function pngBlobFromImageSrc(src: string): Promise<Blob> {
  if (src.startsWith("data:image/png")) {
    try {
      const blob = dataUrlToBlob(src);
      if (blob.type === "image/png" && blob.size > 0) {
        return Promise.resolve(blob);
      }
    } catch {
      // Fall through and try to draw it.
    }
  }
  return rasterizeToPng(src);
}

/**
 * Write a PNG of `src` to the clipboard.
 * The ClipboardItem is built before the first await so WebKit still sees the click.
 */
export async function copyQrImage(src: string): Promise<void> {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clip || typeof clip.write !== "function" || typeof ClipboardItem === "undefined") {
    throw new Error("clipboard-image-unsupported");
  }
  const png = pngBlobFromImageSrc(src);
  await clip.write([
    new ClipboardItem({
      "image/png": png,
    }),
  ]);
}
