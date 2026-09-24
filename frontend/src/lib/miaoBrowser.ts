import {
  fileToBase64,
  parseJoin,
  shareTooLarge,
  type MiaoFileInput,
  type MiaoReceipt,
  type MiaoShare,
} from "./miao";

function base64Bytes(data: string): number {
  const clean = data.replace(/\s/g, "").replace(/=+$/, "");
  if (!clean) {
    return 0;
  }
  return Math.floor((clean.length * 3) / 4);
}

type Emit = (ev: { SessionID: string; Kind: string; Data?: string }) => void;

let emit: Emit = () => undefined;

export function setMiaoBrowserEmit(fn: Emit): void {
  emit = fn;
}

type Stored = MiaoShare & {
  blobs: Record<string, string>;
  timer?: ReturnType<typeof setTimeout>;
};

const shares = new Map<string, Stored>();
const order: string[] = [];
let seq = 0;

function id(): string {
  seq += 1;
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex}${seq.toString(16)}`;
}

function publicSnap(share: Stored, status = share.status, endReason = share.endReason): MiaoShare {
  return {
    id: share.id,
    address: share.address,
    token: share.token,
    payload: share.payload,
    files: share.files,
    total: share.total,
    forever: share.forever,
    ttlDays: share.ttlDays,
    expiresAt: share.expiresAt,
    maxDownloads: share.maxDownloads,
    downloads: share.downloads,
    status,
    endReason,
  };
}

function publish(share: Stored, status: string, endReason = ""): MiaoShare {
  share.status = status;
  share.endReason = endReason;
  const snap = publicSnap(share, status, endReason);
  emit({ SessionID: share.id, Kind: "miao", Data: JSON.stringify(snap) });
  return snap;
}

function clearTimer(share: Stored | undefined): void {
  if (share?.timer) {
    clearTimeout(share.timer);
    share.timer = undefined;
  }
}

function remember(share: Stored): void {
  if (!shares.has(share.id)) {
    order.unshift(share.id);
  }
  shares.set(share.id, share);
}

function forget(shareID: string): void {
  const share = shares.get(shareID);
  clearTimer(share);
  shares.delete(shareID);
  const index = order.indexOf(shareID);
  if (index >= 0) {
    order.splice(index, 1);
  }
}

function findByPayload(addr: string, token: string): Stored | undefined {
  for (const shareID of order) {
    const share = shares.get(shareID);
    if (share && share.address === addr && share.token === token) {
      return share;
    }
  }
  return undefined;
}

export function browserListMiao(): MiaoShare[] {
  const out: MiaoShare[] = [];
  for (const shareID of order) {
    const share = shares.get(shareID);
    if (share && share.status === "active") {
      out.push(publicSnap(share));
    }
  }
  return out;
}

export function resetBrowserMiao(): void {
  for (const share of shares.values()) {
    clearTimer(share);
  }
  shares.clear();
  order.splice(0, order.length);
}

export async function browserStartMiao(files: MiaoFileInput[], ttlDays: number, forever: boolean, maxDownloads: number): Promise<MiaoShare> {
  if (!files.length) {
    throw new Error("Choose at least one file.");
  }
  const decoded: Array<{ name: string; size: number; dataBase64: string }> = [];
  let total = 0;
  for (const file of files) {
    const dataBase64 = file.dataBase64 || "";
    const size = base64Bytes(dataBase64);
    total += size;
    decoded.push({ name: file.name || "file", size, dataBase64 });
  }
  if (shareTooLarge(decoded.map((file) => file.size)) || total > 300 * 1024 * 1024) {
    throw new Error("This share is larger than 300 MiB.");
  }
  const shareID = id();
  const token = id();
  const address = `tc:fake-miao-${shareID.slice(0, 8)}`;
  const payload = JSON.stringify({ v: 1, kind: "miao", addr: address, token });
  const blobs: Record<string, string> = {};
  const infos = decoded.map((file, index) => {
    blobs[String(index)] = file.dataBase64;
    return { name: file.name, size: file.size };
  });
  const stored: Stored = {
    id: shareID,
    address,
    token,
    payload,
    files: infos,
    total,
    forever,
    ttlDays: forever ? 0 : ttlDays,
    expiresAt: forever ? "" : new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    maxDownloads,
    downloads: 0,
    status: "active",
    endReason: "",
    blobs,
  };
  if (!forever && ttlDays > 0) {
    stored.timer = setTimeout(() => {
      const live = shares.get(shareID);
      if (!live) {
        return;
      }
      publish(live, "ended", "ttl");
      forget(shareID);
    }, ttlDays * 24 * 60 * 60 * 1000);
  }
  remember(stored);
  return publish(stored, "active");
}

export function browserEndMiao(shareID: string): void {
  const share = shares.get(shareID);
  if (!share) {
    throw new Error("Unknown share.");
  }
  clearTimer(share);
  publish(share, "ended", "manual");
  forget(shareID);
}

export function browserJoinMiao(raw: string): MiaoReceipt {
  const payload = parseJoin(raw);
  if (!payload) {
    throw new Error("That share code is not valid.");
  }
  const current = findByPayload(payload.addr, payload.token);
  if (!current) {
    throw new Error("Could not reach the host. They need to stay online.");
  }
  if (current.maxDownloads > 0 && current.downloads >= current.maxDownloads) {
    throw new Error("The share has ended.");
  }
  current.downloads += 1;
  const files = current.files.map((file, index) => ({
    name: file.name,
    size: file.size,
    path: "",
    dataBase64: current.blobs[String(index)] ?? "",
  }));
  if (current.maxDownloads > 0 && current.downloads >= current.maxDownloads) {
    clearTimer(current);
    publish(current, "ended", "count");
    forget(current.id);
  } else {
    publish(current, "active");
  }
  return { files };
}

export async function browserFilesFrom(list: File[]): Promise<MiaoFileInput[]> {
  return Promise.all(
    list.map(async (file) => ({
      name: file.name,
      path: "",
      dataBase64: await fileToBase64(file),
    })),
  );
}
