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

let current: Stored | null = null;
let seq = 0;

function id(): string {
  seq += 1;
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex}${seq.toString(16)}`;
}

function publish(share: Stored, status: string, endReason = ""): MiaoShare {
  const snap: MiaoShare = {
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
  emit({ SessionID: share.id, Kind: "miao", Data: JSON.stringify(snap) });
  return snap;
}

function clearTimer(share: Stored | null): void {
  if (share?.timer) {
    clearTimeout(share.timer);
    share.timer = undefined;
  }
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
  if (current) {
    clearTimer(current);
    publish(current, "ended", "replaced");
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
    blobs,
  };
  if (!forever && ttlDays > 0) {
    stored.timer = setTimeout(() => {
      if (current?.id === shareID) {
        publish(stored, "ended", "ttl");
        clearTimer(stored);
        current = null;
      }
    }, ttlDays * 24 * 60 * 60 * 1000);
  }
  current = stored;
  return publish(stored, "active");
}

export function browserEndMiao(shareID: string): void {
  if (!current || current.id !== shareID) {
    throw new Error("Unknown share.");
  }
  clearTimer(current);
  publish(current, "ended", "manual");
  current = null;
}

export function browserJoinMiao(raw: string): MiaoReceipt {
  const payload = parseJoin(raw);
  if (!payload) {
    throw new Error("That share code is not valid.");
  }
  if (!current || current.token !== payload.token || current.address !== payload.addr) {
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
    dataBase64: current?.blobs[String(index)] ?? "",
  }));
  if (current.maxDownloads > 0 && current.downloads >= current.maxDownloads) {
    clearTimer(current);
    publish(current, "ended", "count");
    current = null;
  } else if (current) {
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
