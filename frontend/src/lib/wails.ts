import {
  CreateKey as bindCreateKey,
  DeleteKey as bindDeleteKey,
  DialPipe as bindDialPipe,
  ListKeys as bindListKeys,
  ListSessions as bindListSessions,
  ParseAddr as bindParseAddr,
  ResolveAddr as bindResolveAddr,
  StartBrowse as bindStartBrowse,
  StartForward as bindStartForward,
  StartPing as bindStartPing,
  StartPipeServe as bindStartPipeServe,
  StartPortServe as bindStartPortServe,
  StartRecv as bindStartRecv,
  StartCopy as bindStartCopy,
  StartFilesServe as bindStartFilesServe,
  ListRemote as bindListRemote,
  SelectDirectory as bindSelectDirectory,
  SelectFiles as bindSelectFiles,
  StartSSHServe as bindStartSSHServe,
  StartSSHClient as bindStartSSHClient,
  StartSOCKS as bindStartSOCKS,
  StartExitNode as bindStartExitNode,
  StartExec as bindStartExec,
  StopSession as bindStopSession,
} from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { adapter, session, store } from "../../wailsjs/go/models";

export type Session = {
  ID: string;
  Kind: string;
  Status: string;
	Address: string;
	CreatedAt: string;
	Err: string;
	Progress: string;
	Dangerous: boolean;
};

export type TailcatEvent = {
  SessionID: string;
  Kind: "ready" | "data" | "error" | "closed" | string;
  Address?: string;
  Data?: string;
  Err?: string;
};

export type PortMapping = {
  LocalPort: number;
  RemoteHost: string;
  RemotePort: number;
};

export type KeyInfo = {
  Name: string;
  Path: string;
  Client: boolean;
  Address: string;
  Source: string;
};

export type FileEntry = {
  Name: string;
  IsDir: boolean;
  Size: number;
  Mode: string;
  ModTime: string;
};

const TAILCAT_EVENT = "tailcat:event";

type GoWindow = Window & {
  go?: { main?: { App?: { StartPipeServe?: unknown } } };
  runtime?: unknown;
};

function goWindow(): GoWindow {
  return window as GoWindow;
}

export function hasWailsBindings(): boolean {
  return typeof window !== "undefined" && typeof goWindow().go?.main?.App?.StartPipeServe === "function";
}

function asSession(s: session.Session): Session {
  const created =
    typeof s.CreatedAt === "string"
      ? s.CreatedAt
      : s.CreatedAt != null
        ? String(s.CreatedAt)
        : "";
  return {
    ID: s.ID,
    Kind: s.Kind,
    Status: s.Status,
    Address: s.Address ?? "",
    CreatedAt: created,
    Err: s.Err ?? "",
    Progress: s.Progress ?? "",
    Dangerous: Boolean(s.Dangerous),
  };
}

function asKey(k: store.KeyInfo): KeyInfo {
  return {
    Name: k.Name,
    Path: k.Path ?? "",
    Client: Boolean(k.Client),
    Address: k.Address ?? "",
    Source: k.Source ?? "",
  };
}

function toMapping(m: PortMapping): adapter.PortMapping {
  return adapter.PortMapping.createFrom({
    LocalPort: m.LocalPort,
    RemoteHost: m.RemoteHost,
    RemotePort: m.RemotePort,
  });
}

type FakeState = {
  sessions: Session[];
  keys: KeyInfo[];
  listeners: Array<(ev: TailcatEvent) => void>;
  serveStops: Map<string, () => void>;
  ports: Map<string, string>;
  files: Map<string, string>;
  peers: Map<string, string>;
};

const fake: FakeState = {
  sessions: [],
  keys: [],
  listeners: [],
  serveStops: new Map(),
  ports: new Map(),
  files: new Map(),
  peers: new Map(),
};

function newID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function emitFake(ev: TailcatEvent): void {
  if (ev.Kind === "data" && ev.Data) {
    const current = fake.sessions.find((s) => s.ID === ev.SessionID);
    if (current) {
      current.Progress = ev.Data;
    }
  }
  for (const listener of fake.listeners) {
    listener(ev);
  }
}

function upsertFake(sess: Session): void {
  const idx = fake.sessions.findIndex((s) => s.ID === sess.ID);
  if (idx >= 0) {
    fake.sessions[idx] = sess;
  } else {
    fake.sessions.push(sess);
  }
}

function newSess(kind: string, address = ""): Session {
  const sess: Session = {
    ID: newID(),
    Kind: kind,
    Status: "starting",
    Address: address,
    CreatedAt: new Date().toISOString(),
    Err: "",
    Progress: "",
    Dangerous: false,
  };
  upsertFake(sess);
  return sess;
}

function later(fn: () => void): number {
  return window.setTimeout(fn, 10);
}

async function fakeStartPipeServe(): Promise<Session> {
  const sess = newSess("pipe_serve");
  const timer = later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current || current.Status === "stopped") {
      return;
    }
    current.Status = "running";
    current.Address = "tc:fake-" + current.ID;
    emitFake({ SessionID: current.ID, Kind: "ready", Address: current.Address });
  });
  fake.serveStops.set(sess.ID, () => window.clearTimeout(timer));
  return { ...sess };
}

async function fakeDialPipe(addr: string, payload: string): Promise<Session> {
  const sess = newSess("pipe_dial", addr);
  later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current) {
      return;
    }
    if (!addr.startsWith("tc:fake-")) {
      current.Status = "error";
      current.Err = "invalid address";
      emitFake({ SessionID: current.ID, Kind: "error", Err: current.Err });
      return;
    }
    emitFake({ SessionID: current.ID, Kind: "data", Data: "echo:" + payload });
    current.Status = "stopped";
    emitFake({ SessionID: current.ID, Kind: "closed" });
  });
  return { ...sess };
}

function keepRunning(sess: Session, address: string): void {
  const timer = later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current || current.Status === "stopped") {
      return;
    }
    current.Status = "running";
    current.Address = address;
    emitFake({ SessionID: current.ID, Kind: "ready", Address: address, Data: address });
  });
  fake.serveStops.set(sess.ID, () => window.clearTimeout(timer));
}

async function fakeStartPortServe(): Promise<Session> {
  const sess = newSess("port_serve");
  const addr = "tc:fake-port-" + sess.ID;
  fake.ports.set(sess.ID, addr);
  keepRunning(sess, addr);
  return { ...sess };
}

async function fakeStartForward(addr: string, mappings: PortMapping[]): Promise<Session> {
  const sess = newSess("forward", addr);
  later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current) {
      return;
    }
    if (!addr.startsWith("tc:fake-port-")) {
      current.Status = "error";
      current.Err = "unknown fake serve";
      emitFake({ SessionID: current.ID, Kind: "error", Err: current.Err });
      return;
    }
    const port = mappings[0]?.LocalPort || 0;
    current.Status = "running";
    current.Address = port ? `127.0.0.1:${port}` : "127.0.0.1:0";
    emitFake({ SessionID: current.ID, Kind: "ready", Address: current.Address });
  });
  fake.serveStops.set(sess.ID, () => undefined);
  return { ...sess };
}

async function fakeStartBrowse(addr: string): Promise<Session> {
  const sess = newSess("browse", addr);
  later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current) {
      return;
    }
    if (!addr.startsWith("tc:fake-port-")) {
      current.Status = "error";
      current.Err = "unknown fake serve";
      emitFake({ SessionID: current.ID, Kind: "error", Err: current.Err });
      return;
    }
    const url = "http://127.0.0.1:18080/";
    current.Status = "running";
    current.Address = url;
    emitFake({ SessionID: current.ID, Kind: "ready", Address: url, Data: url });
  });
  fake.serveStops.set(sess.ID, () => undefined);
  return { ...sess };
}

async function fakeStartPing(addr: string): Promise<Session> {
  const sess = newSess("ping", addr);
  later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current) {
      return;
    }
    emitFake({ SessionID: current.ID, Kind: "data", Data: "pong in 12ms via DERP(nyc)" });
    emitFake({ SessionID: current.ID, Kind: "data", Data: "pong in 4ms via direct" });
    current.Status = "stopped";
    emitFake({ SessionID: current.ID, Kind: "closed" });
  });
  return { ...sess };
}

async function fakeStopSession(id: string): Promise<void> {
  const stop = fake.serveStops.get(id);
  if (stop) {
    stop();
    fake.serveStops.delete(id);
  }
  const current = fake.sessions.find((s) => s.ID === id);
  if (!current) {
    throw new Error("unknown session " + id);
  }
  current.Status = "stopped";
  emitFake({ SessionID: id, Kind: "closed" });
}

async function fakeListSessions(): Promise<Session[]> {
  return fake.sessions
    .slice()
    .sort((a, b) => {
      if (a.CreatedAt !== b.CreatedAt) {
        return a.CreatedAt < b.CreatedAt ? -1 : 1;
      }
      return a.ID < b.ID ? -1 : a.ID > b.ID ? 1 : 0;
    })
    .map((s) => ({ ...s }));
}

async function fakeParseAddr(raw: string): Promise<string> {
  if (!raw.trim()) {
    throw new Error("address is required");
  }
  return JSON.stringify({ fake: true, addr: raw.trim() });
}

async function fakeResolveAddr(raw: string): Promise<string> {
  if (!raw.trim()) {
    throw new Error("address is required");
  }
  return "tc:fake-resolved";
}

async function fakeListKeys(): Promise<KeyInfo[]> {
  return fake.keys
    .slice()
    .sort((a, b) => {
      if (a.Source !== b.Source) {
        return a.Source < b.Source ? -1 : 1;
      }
      return a.Name < b.Name ? -1 : a.Name > b.Name ? 1 : 0;
    })
    .map((k) => ({ ...k }));
}

async function fakeCreateKey(name: string, client: boolean, region: string): Promise<string> {
  if (!name.trim() || name.includes("/") || name.includes("..")) {
    throw new Error("invalid key name");
  }
  if (fake.keys.some((k) => k.Name === name)) {
    throw new Error("key already exists");
  }
  const address = client ? "nodekey:" + name : "tc:local-" + name;
  fake.keys.push({
    Name: name,
    Path: name + ".private.json",
    Client: client,
    Address: address,
    Source: "app",
  });
  void region;
  return address;
}

async function fakeDeleteKey(name: string): Promise<void> {
  const idx = fake.keys.findIndex((k) => k.Name === name);
  if (idx < 0) {
    throw new Error("unknown key " + name);
  }
  fake.keys.splice(idx, 1);
}

async function fakeStartRecv(inboxDir: string): Promise<Session> {
  if (!inboxDir.trim()) {
    throw new Error("inbox directory is required");
  }
  const sess = newSess("recv");
  const addr = "tc:fake-recv-" + sess.ID;
  fake.files.set(sess.ID, addr);
  const timer = later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current || current.Status === "stopped") {
      return;
    }
    current.Status = "running";
    current.Address = addr;
    emitFake({ SessionID: current.ID, Kind: "ready", Address: addr });
    window.setTimeout(() => {
      const live = fake.sessions.find((s) => s.ID === sess.ID);
      if (!live || live.Status === "stopped") {
        return;
      }
      emitFake({ SessionID: live.ID, Kind: "data", Data: "received drop.txt" });
    }, 10);
  });
  fake.serveStops.set(sess.ID, () => window.clearTimeout(timer));
  return { ...sess };
}

async function fakeStartFilesServe(rootDir: string): Promise<Session> {
  if (!rootDir.trim()) {
    throw new Error("directory is required");
  }
  const sess = newSess("files_serve");
  const addr = "tc:fake-files-" + sess.ID;
  fake.files.set(sess.ID, addr);
  keepRunning(sess, addr);
  return { ...sess };
}

function knownFakeFiles(addr: string): boolean {
  return [...fake.files.values()].includes(addr);
}

async function fakeStartCopy(addr: string, localPaths: string[], remotePath: string): Promise<Session> {
  const sess = newSess("copy", addr);
  later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current) {
      return;
    }
    if (!knownFakeFiles(addr)) {
      current.Status = "error";
      current.Err = "unknown fake files serve";
      emitFake({ SessionID: current.ID, Kind: "error", Err: current.Err });
      return;
    }
    if (localPaths.length === 0) {
      current.Status = "error";
      current.Err = "at least one local path is required";
      emitFake({ SessionID: current.ID, Kind: "error", Err: current.Err });
      return;
    }
    current.Status = "running";
    emitFake({
      SessionID: current.ID,
      Kind: "data",
      Data: `copied ${localPaths.length}/${localPaths.length} to ${remotePath || "."}`,
    });
    current.Status = "stopped";
    emitFake({ SessionID: current.ID, Kind: "closed" });
  });
  return { ...sess };
}

async function fakeListRemote(addr: string): Promise<FileEntry[]> {
  if (!knownFakeFiles(addr)) {
    throw new Error("unknown fake files serve");
  }
  return [
    { Name: "hello.txt", IsDir: false, Size: 12, Mode: "-rw-r--r--", ModTime: "1970-01-01T00:00:00Z" },
    { Name: "photos", IsDir: true, Size: 0, Mode: "drwxr-xr-x", ModTime: "1970-01-01T00:00:00Z" },
  ];
}

async function fakeStartSSHServe(noAuth: boolean, authorizedKeys: string): Promise<Session> {
  if (!noAuth && !authorizedKeys.trim()) {
    throw new Error("authorized keys are required for keyed SSH (or use no-auth with confirmation)");
  }
  const sess = newSess("ssh_serve");
  sess.Dangerous = noAuth;
  upsertFake(sess);
  const addr = noAuth ? "tc:fake-noauth-ssh-" + sess.ID : "tc:fake-ssh-" + sess.ID;
  fake.peers.set(sess.ID, addr);
  keepRunning(sess, addr);
  return { ...sess };
}

async function fakeStartSSHClient(addr: string, command: string, user: string): Promise<Session> {
  const sess = newSess("ssh_client", addr);
  later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current) {
      return;
    }
    if (![...fake.peers.values()].includes(addr) || (!addr.startsWith("tc:fake-ssh-") && !addr.startsWith("tc:fake-noauth-ssh-"))) {
      current.Status = "error";
      current.Err = "unknown fake ssh serve";
      emitFake({ SessionID: current.ID, Kind: "error", Err: current.Err });
      return;
    }
    const cmd = command.trim() || "whoami";
    emitFake({ SessionID: current.ID, Kind: "data", Data: `ssh ${user || "tailcat"}@${addr}: ${cmd}` });
    current.Status = "stopped";
    emitFake({ SessionID: current.ID, Kind: "closed" });
  });
  return { ...sess };
}

async function fakeStartExitNode(): Promise<Session> {
  const sess = newSess("exit_node");
  const addr = "tc:fake-exit-" + sess.ID;
  fake.peers.set(sess.ID, addr);
  keepRunning(sess, addr);
  return { ...sess };
}

async function fakeStartSOCKS(addr: string, listen: string): Promise<Session> {
  const sess = newSess("socks", addr);
  later(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current) {
      return;
    }
    if (![...fake.peers.values()].includes(addr) && !addr.startsWith("tc:fake-port-")) {
      current.Status = "error";
      current.Err = "unknown fake serve";
      emitFake({ SessionID: current.ID, Kind: "error", Err: current.Err });
      return;
    }
    current.Status = "running";
    current.Address = listen.trim() && !listen.endsWith(":0") ? `socks5h://${listen}` : "socks5h://127.0.0.1:1080";
    emitFake({ SessionID: current.ID, Kind: "ready", Address: current.Address, Data: current.Address });
  });
  fake.serveStops.set(sess.ID, () => undefined);
  return { ...sess };
}

async function fakeStartExec(command: string): Promise<Session> {
  if (!command.trim()) {
    throw new Error("command is required");
  }
  const sess = newSess("exec");
  const addr = "tc:fake-exec-" + sess.ID;
  fake.peers.set(sess.ID, addr);
  keepRunning(sess, addr);
  return { ...sess };
}

function asFileEntry(e: adapter.FileEntry): FileEntry {
  const mod =
    typeof e.ModTime === "string"
      ? e.ModTime
      : e.ModTime != null
        ? String(e.ModTime)
        : "";
  return {
    Name: e.Name,
    IsDir: Boolean(e.IsDir),
    Size: e.Size ?? 0,
    Mode: e.Mode ?? "",
    ModTime: mod,
  };
}

export async function startPipeServe(): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartPipeServe());
  }
  return fakeStartPipeServe();
}

export async function dialPipe(addr: string, payload: string): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindDialPipe(addr, payload));
  }
  return fakeDialPipe(addr, payload);
}

export async function startPortServe(mappings: PortMapping[]): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartPortServe(mappings.map(toMapping)));
  }
  return fakeStartPortServe();
}

export async function startForward(addr: string, mappings: PortMapping[]): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartForward(addr, mappings.map(toMapping)));
  }
  return fakeStartForward(addr, mappings);
}

export async function startBrowse(addr: string): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartBrowse(addr));
  }
  return fakeStartBrowse(addr);
}

export async function startPing(addr: string, untilDirect: boolean): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartPing(addr, untilDirect));
  }
  return fakeStartPing(addr);
}

export async function parseAddr(raw: string): Promise<string> {
  if (hasWailsBindings()) {
    return bindParseAddr(raw);
  }
  return fakeParseAddr(raw);
}

export async function resolveAddr(raw: string): Promise<string> {
  if (hasWailsBindings()) {
    return bindResolveAddr(raw);
  }
  return fakeResolveAddr(raw);
}

export async function listKeys(): Promise<KeyInfo[]> {
  if (hasWailsBindings()) {
    const list = await bindListKeys();
    return (list ?? []).map(asKey);
  }
  return fakeListKeys();
}

export async function createKey(name: string, client: boolean, region: string): Promise<string> {
  if (hasWailsBindings()) {
    return bindCreateKey(name, client, region);
  }
  return fakeCreateKey(name, client, region);
}

export async function deleteKey(name: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindDeleteKey(name);
    return;
  }
  await fakeDeleteKey(name);
}

export async function startRecv(inboxDir: string, acceptDirs: boolean): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartRecv(inboxDir, acceptDirs));
  }
  return fakeStartRecv(inboxDir);
}

export async function startCopy(addr: string, localPaths: string[], remotePath: string): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartCopy(addr, localPaths, remotePath));
  }
  return fakeStartCopy(addr, localPaths, remotePath);
}

export async function startFilesServe(rootDir: string, mode: string): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartFilesServe(rootDir, mode));
  }
  return fakeStartFilesServe(rootDir);
}

export async function listRemote(addr: string, path: string): Promise<FileEntry[]> {
  if (hasWailsBindings()) {
    const list = await bindListRemote(addr, path);
    return (list ?? []).map(asFileEntry);
  }
  return fakeListRemote(addr);
}

export async function startSSHServe(noAuth: boolean, authorizedKeys: string, confirmDangerous: boolean): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartSSHServe(noAuth, authorizedKeys, confirmDangerous));
  }
  if (noAuth && !confirmDangerous) {
    throw new Error("no-auth SSH requires explicit confirmation: anyone with the address gets a shell");
  }
  return fakeStartSSHServe(noAuth, authorizedKeys);
}

export async function startSSHClient(addr: string, command: string, user: string, identity: string): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartSSHClient(addr, command, user, identity));
  }
  return fakeStartSSHClient(addr, command, user);
}

export async function startSOCKS(addr: string, listen: string): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartSOCKS(addr, listen));
  }
  return fakeStartSOCKS(addr, listen);
}

export async function startExitNode(): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartExitNode());
  }
  return fakeStartExitNode();
}

export async function startExec(command: string): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartExec(command));
  }
  return fakeStartExec(command);
}

export async function selectDirectory(title: string): Promise<string> {
  if (hasWailsBindings()) {
    return bindSelectDirectory(title);
  }
  throw new Error("directory picker requires a running window");
}

export async function selectFiles(title: string): Promise<string[]> {
  if (hasWailsBindings()) {
    const list = await bindSelectFiles(title);
    return list ?? [];
  }
  throw new Error("file picker requires a running window");
}

export async function stopSession(id: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindStopSession(id);
    return;
  }
  await fakeStopSession(id);
}

export async function listSessions(): Promise<Session[]> {
  if (hasWailsBindings()) {
    const list = await bindListSessions();
    return (list ?? []).map(asSession);
  }
  return fakeListSessions();
}

export function onTailcatEvent(callback: (ev: TailcatEvent) => void): () => void {
  if (hasWailsBindings() && goWindow().runtime) {
    return EventsOn(TAILCAT_EVENT, (ev: TailcatEvent) => {
      callback(ev);
    });
  }
  fake.listeners.push(callback);
  return () => {
    fake.listeners = fake.listeners.filter((l) => l !== callback);
  };
}
