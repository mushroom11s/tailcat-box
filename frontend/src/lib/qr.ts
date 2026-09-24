import * as QRCode from "qrcode";
import jsQR from "jsqr";
import { composeMarkedQrPng } from "./qrMark";

/** A Tailcat address uses the same "starts with tc" check as paste and join. */
export function shareableAddress(value: string): string {
  const text = value.trim();
  return text.startsWith("tc") ? text : "";
}

export function acceptScannedText(raw: string): { ok: true; value: string } | { ok: false } {
  const value = shareableAddress(raw);
  return value ? { ok: true, value } : { ok: false };
}

/** A pasted Tailcat address: the trimmed string, or the first tc token inside it. */
export function extractShareableAddress(raw: string): string {
  const direct = shareableAddress(raw);
  if (direct) {
    return direct;
  }
  for (const part of raw.split(/\s+/)) {
    const value = shareableAddress(part);
    if (value) {
      return value;
    }
  }
  return "";
}

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

export type QrCenterMark = string | HTMLImageElement;

export type QrEncodeOptions = {
  errorCorrectionLevel?: QrErrorCorrection;
  /** Image URL, data URL, or element. Only callers that pass this get a baked-in mark. */
  centerMark?: QrCenterMark;
};

function resolveEncode(arg?: QrErrorCorrection | QrEncodeOptions): { level: QrErrorCorrection; centerMark?: QrCenterMark } {
  if (typeof arg === "string" || arg == null) {
    return { level: arg ?? "M" };
  }
  return {
    level: arg.errorCorrectionLevel ?? (arg.centerMark ? "H" : "M"),
    centerMark: arg.centerMark,
  };
}

/** Encode the raw address or key. No URL scheme is added. A center mark is opt-in and returns one PNG. */
export async function encodeQrDataURL(text: string, errorCorrectionLevelOrOptions?: QrErrorCorrection | QrEncodeOptions): Promise<string> {
  const { level, centerMark } = resolveEncode(errorCorrectionLevelOrOptions);
  if (centerMark) {
    return composeMarkedQrPng(text, level, centerMark);
  }
  const svg = await QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: level,
    margin: 2,
    width: 280,
    color: { dark: "#000000", light: "#ffffff" },
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function decodeQrImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  inversionAttempts: "dontInvert" | "attemptBoth" = "attemptBoth",
): string | null {
  const result = jsQR(data, width, height, { inversionAttempts });
  const text = result?.data?.trim() ?? "";
  return text ? text : null;
}
