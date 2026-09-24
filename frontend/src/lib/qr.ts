import * as QRCode from "qrcode";
import jsQR from "jsqr";

/** A Tailcat address uses the same "starts with tc" check as paste and join. */
export function shareableAddress(value: string): string {
  const text = value.trim();
  return text.startsWith("tc") ? text : "";
}

export function acceptScannedText(raw: string): { ok: true; value: string } | { ok: false } {
  const value = shareableAddress(raw);
  return value ? { ok: true, value } : { ok: false };
}

/** Encode the raw address or key. No URL scheme is added. */
export async function encodeQrDataURL(text: string): Promise<string> {
  const svg = await QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
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
