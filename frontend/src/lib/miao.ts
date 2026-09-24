export const MAX_SHARE_BYTES = 300 * 1024 * 1024;

export type MiaoFileInput = {
  name: string;
  path: string;
  dataBase64: string;
};

export type MiaoFileInfo = {
  name: string;
  size: number;
  sha256?: string;
};

export type MiaoShare = {
  id: string;
  address: string;
  token: string;
  payload: string;
  files: MiaoFileInfo[];
  total: number;
  forever: boolean;
  ttlDays: number;
  expiresAt: string;
  maxDownloads: number;
  downloads: number;
  status: string;
  endReason?: string;
};

export type MiaoSavedFile = {
  name: string;
  size: number;
  path: string;
  sha256?: string;
  dataBase64?: string;
};

export type MiaoReceipt = {
  files: MiaoSavedFile[];
};

export type JoinPayload = {
  v: number;
  kind: string;
  addr: string;
  token: string;
};

const KNOWN_ERRORS: Record<string, "miaoTooBig" | "miaoNeedFile" | "miaoBadCode" | "miaoUnreachable" | "miaoEndedRemote" | "miaoBusyPeer" | "miaoCustomDaysInvalid" | "miaoCustomCountInvalid" | "miaoFolder" | "miaoPickFolder"> = {
  "This share is larger than 300 MiB.": "miaoTooBig",
  "Choose at least one file.": "miaoNeedFile",
  "Choose files, not folders.": "miaoFolder",
  "That share code is not valid.": "miaoBadCode",
  "Could not reach the host. They need to stay online.": "miaoUnreachable",
  "The share has ended.": "miaoEndedRemote",
  "The share is busy. Try again in a moment.": "miaoBusyPeer",
  "Enter a number of days.": "miaoCustomDaysInvalid",
  "Enter a download count.": "miaoCustomCountInvalid",
  "Choose a folder to save into.": "miaoPickFolder",
};

export type MiaoErrorKey = (typeof KNOWN_ERRORS)[string];

export function shareTooLarge(sizes: number[]): boolean {
  let total = 0;
  for (const size of sizes) {
    total += size;
    if (total > MAX_SHARE_BYTES) {
      return true;
    }
  }
  return false;
}

export function parseJoin(raw: string): JoinPayload | null {
  try {
    const value = JSON.parse(raw.trim()) as Partial<JoinPayload>;
    if (value.v !== 1 || value.kind !== "miao") {
      return null;
    }
    const addr = typeof value.addr === "string" ? value.addr.trim() : "";
    const token = typeof value.token === "string" ? value.token.trim() : "";
    if (!addr.startsWith("tc") || !token) {
      return null;
    }
    return { v: 1, kind: "miao", addr, token };
  } catch {
    return null;
  }
}

export function acceptMiaoCode(raw: string): { ok: true; value: string } | { ok: false } {
  const value = raw.trim();
  return parseJoin(value) ? { ok: true, value } : { ok: false };
}

export function miaoErrorKey(err: unknown): MiaoErrorKey | "" {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return KNOWN_ERRORS[message] ?? "";
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return "0 B";
  }
  if (size < 1024) {
    return `${Math.round(size)} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function fileToBase64(file: Blob): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(binary);
  });
}

export function base64ToBlob(data: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes]);
}

export type Remaining =
  | { kind: "forever" }
  | { kind: "expired" }
  | { kind: "left"; days: number; hours: number; minutes: number };

export function remainingTTL(expiresAt: string, forever: boolean, now = Date.now()): Remaining {
  if (forever || !expiresAt) {
    return { kind: "forever" };
  }
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) {
    return { kind: "forever" };
  }
  const ms = end - now;
  if (ms <= 0) {
    return { kind: "expired" };
  }
  const minutesTotal = Math.max(1, Math.ceil(ms / 60000));
  const days = Math.floor(minutesTotal / (60 * 24));
  const hours = Math.floor((minutesTotal - days * 60 * 24) / 60);
  const minutes = minutesTotal - days * 60 * 24 - hours * 60;
  return { kind: "left", days, hours, minutes };
}

export function downloadsLeft(maxDownloads: number, downloads: number): number | null {
  if (maxDownloads <= 0) {
    return null;
  }
  return Math.max(0, maxDownloads - downloads);
}
