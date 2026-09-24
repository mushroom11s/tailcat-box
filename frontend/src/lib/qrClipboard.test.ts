import { describe, expect, it } from "vitest";
import { readQrPaste, type ClipboardEntry } from "./qrClipboard";

function item(types: string[], blobs: Record<string, Blob>): ClipboardEntry {
  return {
    types,
    getType: async (type: string) => {
      const blob = blobs[type];
      if (!blob) {
        throw new Error(`missing ${type}`);
      }
      return blob;
    },
  };
}

function textBlob(text: string): Blob {
  return new Blob([text], { type: "text/plain" });
}

function denied(): Error {
  const err = new Error("denied");
  err.name = "NotAllowedError";
  return err;
}

describe("readQrPaste", () => {
  it("returns an image file when the clipboard holds an image", async () => {
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const result = await readQrPaste({
      readItems: async () => [item(["image/png", "text/plain"], { "image/png": png, "text/plain": textBlob("tc:ignored") })],
    });
    expect(result).toMatchObject({ ok: true, kind: "image" });
    if (result.ok && result.kind === "image") {
      expect(result.file.type).toBe("image/png");
      expect(result.file.name.endsWith(".png")).toBe(true);
      expect(new Uint8Array(await result.file.arrayBuffer())).toEqual(new Uint8Array(await png.arrayBuffer()));
    }
  });

  it("returns plain text when the clipboard holds a Tailcat address", async () => {
    const result = await readQrPaste({
      readItems: async () => [item(["text/plain"], { "text/plain": textBlob("  tc:from-clip  ") })],
    });
    expect(result).toEqual({ ok: true, kind: "text", text: "  tc:from-clip  " });
  });

  it("falls back to readText and then the desktop clipboard", async () => {
    await expect(
      readQrPaste({
        readText: async () => "tc:from-read-text",
      }),
    ).resolves.toEqual({ ok: true, kind: "text", text: "tc:from-read-text" });

    await expect(
      readQrPaste({
        readItems: async () => {
          throw denied();
        },
        readText: async () => {
          throw denied();
        },
        readDesktopText: async () => "tc:from-desktop",
      }),
    ).resolves.toEqual({ ok: true, kind: "text", text: "tc:from-desktop" });
  });

  it("lets a caller accept text that is not a Tailcat address", async () => {
    const result = await readQrPaste(
      {
        readItems: async () => [item(["text/plain"], { "text/plain": textBlob("  mw1.from-clip  ") })],
      },
      () => true,
    );
    expect(result).toEqual({ ok: true, kind: "text", text: "  mw1.from-clip  " });
  });

  it("reports an empty clipboard, unusable contents, and denied access", async () => {
    await expect(readQrPaste({ readItems: async () => [] })).resolves.toEqual({ ok: false, reason: "empty" });
    await expect(
      readQrPaste({
        readText: async () => "   ",
      }),
    ).resolves.toEqual({ ok: false, reason: "empty" });
    await expect(
      readQrPaste({
        readItems: async () => [item(["text/plain"], { "text/plain": textBlob("https://example.invalid") })],
      }),
    ).resolves.toEqual({ ok: false, reason: "unusable" });
    await expect(
      readQrPaste({
        readItems: async () => [item(["text/html"], {})],
      }),
    ).resolves.toEqual({ ok: false, reason: "unusable" });
    await expect(
      readQrPaste({
        readItems: async () => {
          throw denied();
        },
        readText: async () => {
          throw denied();
        },
        readDesktopText: async () => {
          throw new Error("no runtime");
        },
      }),
    ).resolves.toEqual({ ok: false, reason: "denied" });
  });
});
