import { ClipboardGetText } from "../../wailsjs/runtime/runtime";
import { shareableAddress } from "./qr";

export type ClipboardEntry = {
  types: readonly string[];
  getType: (type: string) => Promise<Blob>;
};

export type PasteSource = {
  readItems?: () => Promise<readonly ClipboardEntry[]>;
  readText?: () => Promise<string>;
  readDesktopText?: () => Promise<string>;
};

export type PasteResult =
  | { ok: true; kind: "image"; file: File }
  | { ok: true; kind: "text"; text: string }
  | { ok: false; reason: "empty" | "unusable" | "denied" };

function isDenied(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("name" in err)) {
    return false;
  }
  const name = String((err as { name: unknown }).name);
  return name === "NotAllowedError" || name === "SecurityError";
}

function imageType(types: readonly string[]): string | undefined {
  return types.find((type) => type.toLowerCase().startsWith("image/"));
}

function extensionFor(type: string): string {
  const subtype = type.slice(type.indexOf("/") + 1).split(";")[0].split("+")[0].trim().toLowerCase();
  if (!subtype || subtype === "image") {
    return "png";
  }
  return subtype === "jpeg" ? "jpg" : subtype;
}

async function imageFile(items: readonly ClipboardEntry[]): Promise<File | null> {
  for (const entry of items) {
    const type = imageType(entry.types);
    if (!type) {
      continue;
    }
    const blob = await entry.getType(type);
    const fileType = blob.type || type;
    return new File([blob], `clipboard.${extensionFor(fileType)}`, { type: fileType });
  }
  return null;
}

async function plainText(items: readonly ClipboardEntry[]): Promise<string | null> {
  for (const entry of items) {
    const type = entry.types.find((itemType) => itemType === "text/plain" || itemType.startsWith("text/plain;"));
    if (!type) {
      continue;
    }
    return (await entry.getType(type)).text();
  }
  return null;
}

function classifyText(text: string): PasteResult {
  if (!text.trim()) {
    return { ok: false, reason: "empty" };
  }
  if (!shareableAddress(text)) {
    return { ok: false, reason: "unusable" };
  }
  return { ok: true, kind: "text", text };
}

async function readTextSource(
  read: (() => Promise<string>) | undefined,
): Promise<PasteResult | "skip" | "denied" | "error"> {
  if (!read) {
    return "skip";
  }
  try {
    return classifyText(await read());
  } catch (err) {
    return isDenied(err) ? "denied" : "error";
  }
}

function defaultSource(): PasteSource {
  const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  return {
    readItems: clip && typeof clip.read === "function" ? () => clip.read() : undefined,
    readText: clip && typeof clip.readText === "function" ? () => clip.readText() : undefined,
    readDesktopText: () => ClipboardGetText(),
  };
}

/** Read a QR image or Tailcat address from the system clipboard. */
export async function readQrPaste(source: PasteSource = defaultSource()): Promise<PasteResult> {
  if (source.readItems) {
    try {
      const items = await source.readItems();
      const file = await imageFile(items);
      if (file) {
        return { ok: true, kind: "image", file };
      }
      const text = await plainText(items);
      if (text !== null) {
        return classifyText(text);
      }
      return { ok: false, reason: items.length === 0 ? "empty" : "unusable" };
    } catch {
      // The async Clipboard API can be missing or blocked. Try text, then the desktop clipboard.
    }
  }

  const fromText = await readTextSource(source.readText);
  if (fromText !== "skip" && fromText !== "denied" && fromText !== "error") {
    return fromText;
  }

  const fromDesktop = await readTextSource(source.readDesktopText);
  if (fromDesktop !== "skip" && fromDesktop !== "denied" && fromDesktop !== "error") {
    return fromDesktop;
  }

  return { ok: false, reason: "denied" };
}
