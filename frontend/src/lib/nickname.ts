export const NICKNAME_KEY = "tailcat-nickname";
export const NICKNAME_MAX = 32;

const stripped = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

// sanitizeNickname drops control and line-separator characters and keeps at most
// NICKNAME_MAX Unicode code points. Surrounding spaces stay so a field can still
// accept a space between words; displayNickname trims those for labels.
export function sanitizeNickname(raw: string): string {
  return Array.from(raw.replace(stripped, "")).slice(0, NICKNAME_MAX).join("");
}

export function displayNickname(raw: string): string {
  return sanitizeNickname(raw).trim();
}

export function readNickname(): string {
  try {
    return displayNickname(localStorage.getItem(NICKNAME_KEY) ?? "");
  } catch {
    return "";
  }
}
