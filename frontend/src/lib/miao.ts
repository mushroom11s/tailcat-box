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

export type ReceiveStatus = "connecting" | "queued" | "downloading" | "done" | "failed" | "cancelled" | "interrupted";

export type ReceiveJob = {
  id: string;
  status: ReceiveStatus;
  bytesDone: number;
  bytesTotal: number;
  files: MiaoFileInfo[];
  saved?: MiaoSavedFile[];
  error?: string;
  dest: string;
  payload?: string;
  resumable?: boolean;
};

const RECEIVE_RANK: Record<ReceiveStatus, number> = {
  connecting: 0,
  queued: 1,
  downloading: 2,
  done: 3,
  failed: 3,
  cancelled: 3,
  interrupted: 3,
};

export function isReceiveStatus(value: unknown): value is ReceiveStatus {
  return value === "connecting" || value === "queued" || value === "downloading" || value === "done" || value === "failed" || value === "cancelled" || value === "interrupted";
}

function receiveCanRestart(status: ReceiveStatus): boolean {
  return status === "interrupted" || status === "failed" || status === "cancelled";
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

export function parseReceiveJob(raw: unknown): ReceiveJob | null {
  const value = asRecord(raw, (record) => readString(record, "id", "ID") !== "" && isReceiveStatus(readString(record, "status", "Status")));
  if (!value) {
    return null;
  }
  const id = readString(value, "id", "ID");
  const status = readString(value, "status", "Status");
  if (!id || !isReceiveStatus(status)) {
    return null;
  }
  const resumable = readField(value, "resumable", "Resumable");
  return {
    id,
    status,
    bytesDone: asCount(readField(value, "bytesDone", "BytesDone")),
    bytesTotal: asCount(readField(value, "bytesTotal", "BytesTotal")),
    files: asFiles(readField(value, "files", "Files")),
    saved: asSaved(readField(value, "saved", "Saved")),
    error: readString(value, "error", "Error"),
    dest: readString(value, "dest", "Dest"),
    payload: readString(value, "payload", "Payload"),
    resumable: typeof resumable === "boolean" ? resumable : undefined,
  };
}

export function parseShare(raw: unknown): MiaoShare | null {
  const value = asRecord(raw, (record) => readString(record, "id", "ID") !== "");
  if (!value) {
    return null;
  }
  const id = readString(value, "id", "ID");
  if (!id) {
    return null;
  }
  const endReason = readString(value, "endReason", "EndReason");
  return {
    id,
    address: readString(value, "address", "Address"),
    token: readString(value, "token", "Token"),
    payload: readString(value, "payload", "Payload"),
    files: asFiles(readField(value, "files", "Files")),
    total: asCount(readField(value, "total", "Total")),
    forever: readField(value, "forever", "Forever") === true,
    ttlDays: asCount(readField(value, "ttlDays", "TTLDays")),
    expiresAt: readString(value, "expiresAt", "ExpiresAt"),
    maxDownloads: asCount(readField(value, "maxDownloads", "MaxDownloads")),
    downloads: asCount(readField(value, "downloads", "Downloads")),
    status: readString(value, "status", "Status") || "active",
    endReason: endReason || undefined,
  };
}

export function upsertReceiveJob(list: ReceiveJob[], job: ReceiveJob): ReceiveJob[] {
  const incoming = parseReceiveJob(job);
  if (!incoming) {
    return list;
  }
  const index = list.findIndex((item) => item.id === incoming.id);
  if (index < 0) {
    return [incoming, ...list];
  }
  const prev = list[index];
  const restarting = receiveCanRestart(prev.status) && !receiveCanRestart(incoming.status) && incoming.status !== "done";
  const finishing = receiveCanRestart(prev.status) && incoming.status === "done";
  if (!restarting && !finishing && RECEIVE_RANK[incoming.status] < RECEIVE_RANK[prev.status]) {
    return list;
  }
  if (!restarting && !finishing && receiveTerminal(prev.status) && incoming.status !== prev.status) {
    return list;
  }
  const bytesDone = incoming.status === prev.status ? Math.max(prev.bytesDone, incoming.bytesDone) : incoming.bytesDone;
  const next = list.slice();
  next[index] = {
    ...prev,
    ...incoming,
    bytesDone,
    bytesTotal: incoming.bytesTotal > 0 ? incoming.bytesTotal : prev.bytesTotal,
    files: (incoming.files?.length ? incoming.files : prev.files) ?? [],
    saved: (incoming.saved?.length ? incoming.saved : prev.saved) ?? [],
    dest: incoming.dest || prev.dest,
    payload: incoming.payload || prev.payload,
    resumable: incoming.resumable ?? prev.resumable,
    error: incoming.status === "done" || incoming.status === "cancelled" ? "" : incoming.error || prev.error,
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

function asRecord(raw: unknown, ready: (record: Record<string, unknown>) => boolean, depth = 0): Record<string, unknown> | null {
  if (depth > 3 || raw == null) {
    return null;
  }
  if (typeof raw === "string") {
    try {
      return asRecord(JSON.parse(raw), ready, depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (ready(record)) {
    return record;
  }
  for (const key of ["result", "Result", "data", "Data", "job", "Job"]) {
    if (!(key in record)) {
      continue;
    }
    const inner = asRecord(record[key], ready, depth + 1);
    if (inner) {
      return inner;
    }
  }
  return null;
}

function readField(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string {
  const value = readField(record, ...keys);
  return typeof value === "string" ? value : "";
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
    const row = item as Record<string, unknown>;
    const name = readString(row, "name", "Name");
    if (!name) {
      continue;
    }
    const sha256 = readString(row, "sha256", "SHA256");
    files.push({ name, size: asCount(readField(row, "size", "Size")), sha256: sha256 || undefined });
  }
  return files;
}

function asSaved(value: unknown): MiaoSavedFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const saved: MiaoSavedFile[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const name = readString(row, "name", "Name");
    if (!name) {
      continue;
    }
    const sha256 = readString(row, "sha256", "SHA256");
    const dataBase64 = readString(row, "dataBase64", "DataBase64");
    saved.push({
      name,
      size: asCount(readField(row, "size", "Size")),
      path: readString(row, "path", "Path"),
      sha256: sha256 || undefined,
      dataBase64: dataBase64 || undefined,
    });
  }
  return saved;
}

export type JoinPayload = {
  v: number;
  kind: string;
  addr: string;
  token: string;
};

const KNOWN_ERRORS: Record<string, "miaoTooBig" | "miaoNeedFile" | "miaoBadCode" | "miaoUnreachable" | "miaoEndedRemote" | "miaoBusyPeer" | "miaoCustomDaysInvalid" | "miaoCustomCountInvalid" | "miaoFolder" | "miaoPickFolder" | "miaoUnknownReceive" | "miaoReceiveStarted" | "miaoPartialMismatch" | "miaoMissingFile" | "miaoShareUnready"> = {
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
  "The partial file did not match. The download will start over.": "miaoPartialMismatch",
  "A shared file is missing, so that share was not restored.": "miaoMissingFile",
  "A share could not be restored.": "miaoShareUnready",
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

const SHARE_CODE_IN_TEXT = /mw1\.[A-Za-z0-9_-]+/g;

/** Pull a join payload out of pasted text. Trims, then accepts a code or legacy JSON embedded in other text. */
export function extractShareCode(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  const direct = acceptMiaoCode(trimmed);
  if (direct.ok) {
    return direct.value;
  }
  for (const match of trimmed.matchAll(SHARE_CODE_IN_TEXT)) {
    const accepted = acceptMiaoCode(match[0]);
    if (accepted.ok) {
      return accepted.value;
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const accepted = acceptMiaoCode(trimmed.slice(start, end + 1));
    if (accepted.ok) {
      return accepted.value;
    }
  }
  return "";
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
