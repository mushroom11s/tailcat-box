import { useRef, type ClipboardEvent } from "react";
import { readQrPaste } from "./qrClipboard";
import { decodeQrFromFile } from "./qrImage";

/** Text and image carried by a paste event. Image wins, matching the scan dialog. */
export function clipboardPlainText(data: DataTransfer | null): string {
  if (!data) {
    return "";
  }
  return data.getData("text/plain") || data.getData("text") || "";
}

export function clipboardImageFile(data: DataTransfer | null): File | null {
  if (!data) {
    return null;
  }
  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) {
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        return file;
      }
    }
  }
  const files = data.files;
  if (!files) {
    return null;
  }
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (file && file.type.toLowerCase().startsWith("image/")) {
      return file;
    }
  }
  return null;
}

export function clipboardHasOtherPayload(data: DataTransfer | null): boolean {
  if (!data) {
    return false;
  }
  return Array.from(data.types).some((type) => {
    const name = type.toLowerCase();
    return name !== "" && name !== "text/plain" && name !== "text" && !name.startsWith("image/");
  });
}

export type PasteFailure = "empty" | "unusable" | "denied" | "no-qr" | "invalid";

export type PasteResolution = { ok: true; value: string } | { ok: false; reason: PasteFailure };

async function valueFromImage(
  file: File,
  extract: (raw: string) => string,
  decodeFile: (file: File) => Promise<string | null>,
): Promise<PasteResolution> {
  let text: string | null = null;
  try {
    text = await decodeFile(file);
  } catch {
    text = null;
  }
  if (!text) {
    return { ok: false, reason: "no-qr" };
  }
  const value = extract(text);
  return value ? { ok: true, value } : { ok: false, reason: "invalid" };
}

/** Read a paste event, decoding a QR image with the shared file decoder. */
export async function resolveClipboardPaste(
  data: DataTransfer | null,
  extract: (raw: string) => string,
  decodeFile: (file: File) => Promise<string | null> = decodeQrFromFile,
): Promise<PasteResolution> {
  const file = clipboardImageFile(data);
  if (file) {
    return valueFromImage(file, extract, decodeFile);
  }
  const text = clipboardPlainText(data);
  if (text.trim()) {
    const value = extract(text);
    return value ? { ok: true, value } : { ok: false, reason: "invalid" };
  }
  const other = clipboardHasOtherPayload(data);
  try {
    const result = await readQrPaste(undefined, () => true);
    if (result.ok && result.kind === "image") {
      return valueFromImage(result.file, extract, decodeFile);
    }
    if (result.ok && result.kind === "text") {
      const value = extract(result.text);
      return value ? { ok: true, value } : { ok: false, reason: result.text.trim() ? "invalid" : "empty" };
    }
    const reason = result.ok ? "unusable" : result.reason;
    if (other || reason === "unusable") {
      return { ok: false, reason: "unusable" };
    }
    if (reason === "denied") {
      return { ok: false, reason: "denied" };
    }
    return { ok: false, reason: "empty" };
  } catch {
    return { ok: false, reason: other ? "unusable" : "empty" };
  }
}

/** Paste handler for a controlled field. A rejected paste keeps the current value. */
export function useClipboardFieldPaste(
  value: string,
  onAccept: (value: string) => void,
  extract: (raw: string) => string,
  onFailure: (reason: PasteFailure) => void,
): (ev: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void {
  const valueRef = useRef(value);
  valueRef.current = value;
  const serial = useRef(0);
  const acceptRef = useRef(onAccept);
  const failRef = useRef(onFailure);
  const extractRef = useRef(extract);
  acceptRef.current = onAccept;
  failRef.current = onFailure;
  extractRef.current = extract;

  return (ev) => {
    ev.preventDefault();
    const el = ev.currentTarget;
    const ticket = serial.current + 1;
    serial.current = ticket;
    void resolveClipboardPaste(ev.clipboardData, (raw) => extractRef.current(raw))
      .then((result) => {
        if (ticket !== serial.current) {
          return;
        }
        if (result.ok) {
          valueRef.current = result.value;
          acceptRef.current(result.value);
          return;
        }
        failRef.current(result.reason);
      })
      .finally(() => {
        if (ticket !== serial.current) {
          return;
        }
        const restore = () => {
          if (el.isConnected && el.value !== valueRef.current) {
            el.value = valueRef.current;
          }
        };
        queueMicrotask(restore);
        requestAnimationFrame(restore);
      });
  };
}
