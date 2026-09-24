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

export type ReceiveStatus = "connecting" | "queued" | "downloading" | "done" | "failed" | "cancelled";

export type ReceiveJob = {
  id: string;
  status: ReceiveStatus;
  bytesDone: number;
  bytesTotal: number;
  files: MiaoFileInfo[];
  saved?: MiaoSavedFile[];
  error?: string;
  dest: string;
};

const RECEIVE_RANK: Record<ReceiveStatus, number> = {
  connecting: 0,
  queued: 1,
  downloading: 2,
  done: 3,
  failed: 3,
  cancelled: 3,
};

export function isReceiveStatus(value: unknown): value is ReceiveStatus {
  return value === "connecting" || value === "queued" || value === "downloading" || value === "done" || value === "failed" || value === "cancelled";
}

export function receiveTerminal(status: ReceiveStatus): boolean {
  return RECEIVE_RANK[status] >= 3;
}

export function receivePercent(job: ReceiveJob): number {
  if (job.status === "done") {
    return 100;
  }
  if (!Number.isFinite(job.bytesTotal) || job.bytesTotal <= 0) {
    return 0;
  }
  const ratio = job.bytesDone / job.bytesTotal;
  if (!Number.isFinite(ratio)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

export function parseReceiveJob(raw: string): ReceiveJob | null {
  try {
    const value = JSON.parse(raw) as Partial<ReceiveJob>;
    if (!value || typeof value.id !== "string" || !value.id || !isReceiveStatus(value.status)) {
      return null;
    }
    return {
      id: value.id,
      status: value.status,
      bytesDone: asCount(value.bytesDone),
      bytesTotal: asCount(value.bytesTotal),
      files: asFiles(value.files),
      saved: Array.isArray(value.saved) ? value.saved : undefined,
      error: typeof value.error === "string" ? value.error : "",
      dest: typeof value.dest === "string" ? value.dest : "",
    };
  } catch {
    return null;
  }
}

export function upsertReceiveJob(list: ReceiveJob[], job: ReceiveJob): ReceiveJob[] {
  const index = list.findIndex((item) => item.id === job.id);
  if (index < 0) {
    return [job, ...list];
  }
  const prev = list[index];
  if (RECEIVE_RANK[job.status] < RECEIVE_RANK[prev.status]) {
    return list;
  }
  if (receiveTerminal(prev.status) && job.status !== prev.status) {
    return list;
  }
  const bytesDone = job.status === prev.status ? Math.max(prev.bytesDone, job.bytesDone) : job.bytesDone;
  const next = list.slice();
  next[index] = {
    ...prev,
    ...job,
    bytesDone,
    bytesTotal: job.bytesTotal > 0 ? job.bytesTotal : prev.bytesTotal,
    files: job.files.length ? job.files : prev.files,
    saved: job.saved?.length ? job.saved : prev.saved,
    dest: job.dest || prev.dest,
    error: job.status === "done" || job.status === "cancelled" ? "" : job.error || prev.error,
  };
  return next;
}

function asCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return n;
}

function asFiles(value: unknown): MiaoFileInfo[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const files: MiaoFileInfo[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Partial<MiaoFileInfo>;
    if (typeof row.name !== "string" || !row.name) {
      continue;
    }
    files.push({ name: row.name, size: asCount(row.size), sha256: row.sha256 });
  }
  return files;
}

export type JoinPayload = {
  v: number;
  kind: string;
  addr: string;
  token: string;
};

const KNOWN_ERRORS: Record<string, "miaoTooBig" | "miaoNeedFile" | "miaoBadCode" | "miaoUnreachable" | "miaoEndedRemote" | "miaoBusyPeer" | "miaoCustomDaysInvalid" | "miaoCustomCountInvalid" | "miaoFolder" | "miaoPickFolder" | "miaoUnknownReceive" | "miaoReceiveStarted"> = {
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
  "Unknown download.": "miaoUnknownReceive",
  "That download has already started.": "miaoReceiveStarted",
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

const SHARE_CODE_PREFIX = "mw1.";

export function encodeJoin(addr: string, token: string): string | null {
  const cleanAddr = addr.trim();
  const cleanToken = token.trim();
  if (!cleanAddr.startsWith("tc") || !cleanToken) {
    return null;
  }
  const packed = packShare(cleanAddr, cleanToken);
  if (!packed) {
    return null;
  }
  return SHARE_CODE_PREFIX + bytesToBase64Url(packed);
}

export function parseJoin(raw: string): JoinPayload | null {
  const value = raw.trim();
  if (value.startsWith(SHARE_CODE_PREFIX)) {
    return parseCompact(value);
  }
  return parseLegacy(value);
}

function parseLegacy(raw: string): JoinPayload | null {
  try {
    const value = JSON.parse(raw) as Partial<JoinPayload>;
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

function parseCompact(raw: string): JoinPayload | null {
  const encoded = raw.slice(SHARE_CODE_PREFIX.length);
  const buf = base64UrlToBytes(encoded);
  if (!buf || buf.length < 5) {
    return null;
  }
  const kind = buf[0];
  let offset = 1;
  const addrField = takeField(buf, offset);
  if (!addrField) {
    return null;
  }
  offset = addrField.next;
  const tokenField = takeField(buf, offset);
  if (!tokenField || tokenField.next !== buf.length) {
    return null;
  }
  const addr = unpackAddr(kind, addrField.bytes);
  const token = decodeUtf8(tokenField.bytes);
  if (!addr || !token || !addr.startsWith("tc")) {
    return null;
  }
  return { v: 1, kind: "miao", addr, token };
}

function packShare(addr: string, token: string): Uint8Array | null {
  const [kind, addrBody] = packAddr(addr);
  const tokenBody = new TextEncoder().encode(token);
  if (addrBody.length > 0xffff || tokenBody.length > 0xffff) {
    return null;
  }
  const out = new Uint8Array(1 + 2 + addrBody.length + 2 + tokenBody.length);
  out[0] = kind;
  writeU16(out, 1, addrBody.length);
  out.set(addrBody, 3);
  const tokenAt = 3 + addrBody.length;
  writeU16(out, tokenAt, tokenBody.length);
  out.set(tokenBody, tokenAt + 2);
  return out;
}

function packAddr(addr: string): [number, Uint8Array] {
  const raw = compressedAddr(addr);
  if (raw) {
    return [1, raw];
  }
  return [0, new TextEncoder().encode(addr)];
}

function compressedAddr(addr: string): Uint8Array | null {
  if (!addr.startsWith("tc") || addr.length < 3) {
    return null;
  }
  const raw = base64UrlToBytes(addr.slice(2));
  if (!raw || `tc${bytesToBase64Url(raw)}` !== addr) {
    return null;
  }
  return raw;
}

function unpackAddr(kind: number, body: Uint8Array): string | null {
  if (kind === 0) {
    return decodeUtf8(body);
  }
  if (kind === 1) {
    return `tc${bytesToBase64Url(body)}`;
  }
  return null;
}

function writeU16(buf: Uint8Array, offset: number, n: number): void {
  buf[offset] = n >> 8;
  buf[offset + 1] = n & 0xff;
}

function takeField(buf: Uint8Array, offset: number): { bytes: Uint8Array; next: number } | null {
  if (offset + 2 > buf.length) {
    return null;
  }
  const n = (buf[offset] << 8) | buf[offset + 1];
  const start = offset + 2;
  if (n > buf.length - start) {
    return null;
  }
  return { bytes: buf.subarray(start, start + n), next: start + n };
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(text: string): Uint8Array | null {
  if (!text || text.length % 4 === 1 || /[^A-Za-z0-9_-]/.test(text)) {
    return null;
  }
  const pad = text.length % 4 === 0 ? "" : "=".repeat(4 - (text.length % 4));
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/") + pad);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
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
