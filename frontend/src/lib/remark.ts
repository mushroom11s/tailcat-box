import { NICKNAME_MAX, displayNickname, sanitizeNickname } from "./nickname";

export const REMARKS_KEY = "tailcat-peer-remarks";
export const REMARK_MAX = NICKNAME_MAX;

export type RemarkMap = Record<string, string>;

// A Tailcat address, using the same "starts with tc" check as Connect.
export function isRemarkAddress(address: string): boolean {
  return address.trim().startsWith("tc");
}

// Address the remark field edits: a pasted tc… draft, otherwise the connected peer.
export function remarkAddress(peer: string, draft: string): string {
  const typed = draft.trim();
  if (isRemarkAddress(typed)) {
    return typed;
  }
  const connected = peer.trim();
  if (isRemarkAddress(connected)) {
    return connected;
  }
  return "";
}

// Inbound bubbles use the message peer when one is present, otherwise the current peer.
export function labelPeerAddress(messagePeer: string | undefined, currentPeer: string): string {
  const fromMessage = (messagePeer ?? "").trim();
  if (isRemarkAddress(fromMessage)) {
    return fromMessage;
  }
  const current = currentPeer.trim();
  return isRemarkAddress(current) ? current : "";
}

export function readRemarks(): RemarkMap {
  try {
    const raw = localStorage.getItem(REMARKS_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: RemarkMap = {};
    for (const [addr, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string" || !isRemarkAddress(addr)) {
        continue;
      }
      const shown = displayNickname(value);
      if (!shown) {
        continue;
      }
      out[addr.trim()] = shown;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRemarks(map: RemarkMap): void {
  try {
    localStorage.setItem(REMARKS_KEY, JSON.stringify(map));
  } catch {
    // Private mode or a full quota should not break chat.
  }
}

// commit trims and drops an empty remark. While editing, surrounding spaces stay
// so a field can still accept a space between words.
export function applyRemark(map: RemarkMap, address: string, raw: string, commit: boolean): RemarkMap {
  const key = address.trim();
  if (!isRemarkAddress(key)) {
    return map;
  }
  const next: RemarkMap = { ...map };
  if (commit) {
    const value = displayNickname(raw);
    if (!value) {
      delete next[key];
    } else {
      next[key] = value;
    }
    return next;
  }
  const editing = sanitizeNickname(raw);
  if (!editing) {
    delete next[key];
    return next;
  }
  next[key] = editing;
  return next;
}

export function remarkFor(map: RemarkMap, address: string): string {
  const key = address.trim();
  if (!isRemarkAddress(key)) {
    return "";
  }
  return displayNickname(map[key] ?? "");
}
