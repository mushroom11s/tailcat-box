import { describe, expect, it, vi } from "vitest";
import { copyQrImage, pngBlobFromImageSrc } from "./copyQrImage";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("copyQrImage", () => {
  it("turns a PNG data URL into a PNG blob", async () => {
    const blob = await pngBlobFromImageSrc(PNG);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(8);
  });

  it("writes the PNG to the clipboard before awaiting the image", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const original = navigator.clipboard;
    const OriginalItem = globalThis.ClipboardItem;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    try {
      await copyQrImage(PNG);
      expect(write).toHaveBeenCalledTimes(1);
      const items = write.mock.calls[0][0] as ClipboardItem[];
      expect(items).toHaveLength(1);
      const blob = await items[0].getType("image/png");
      expect(blob.type).toBe("image/png");
      expect(new Uint8Array(await blob.arrayBuffer()).byteLength).toBeGreaterThan(8);
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: original });
      if (OriginalItem) {
        globalThis.ClipboardItem = OriginalItem;
      }
    }
  });

  it("rejects when the clipboard cannot take an image", async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } });
    try {
      await expect(copyQrImage(PNG)).rejects.toThrow("clipboard-image-unsupported");
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: original });
    }
  });
});
