import {
  CheckForUpdate as bindCheckForUpdate,
  ConnectChatPeer as bindConnectChatPeer,
  CreateKey as bindCreateKey,
  DecodeChatVoice as bindDecodeChatVoice,
  DeleteKey as bindDeleteKey,
  DiscardChatMessage as bindDiscardChatMessage,
  DownloadUpdate as bindDownloadUpdate,
  DialPipe as bindDialPipe,
  GetNetworkSettings as bindGetNetworkSettings,
  ListKeys as bindListKeys,
  ListSessions as bindListSessions,
  ParseAddr as bindParseAddr,
  ResolveAddr as bindResolveAddr,
  RevealDownloadedUpdate as bindRevealDownloadedUpdate,
  StartBrowse as bindStartBrowse,
  StartForward as bindStartForward,
  StartPing as bindStartPing,
  StartPipeServe as bindStartPipeServe,
  StartPortServe as bindStartPortServe,
  StartRecv as bindStartRecv,
  ResendChatFile as bindResendChatFile,
  RestartChatRoom as bindRestartChatRoom,
  SaveChatFile as bindSaveChatFile,
  SendChatFile as bindSendChatFile,
  SendChatSignal as bindSendChatSignal,
  SendChatText as bindSendChatText,
  SendChatVoice as bindSendChatVoice,
  StartChatRoom as bindStartChatRoom,
  StartCopy as bindStartCopy,
  StartFilesServe as bindStartFilesServe,
  ListRemote as bindListRemote,
  SelectDirectory as bindSelectDirectory,
  SelectFiles as bindSelectFiles,
  SetNetworkSettings as bindSetNetworkSettings,
  StartSSHServe as bindStartSSHServe,
  StartSSHClient as bindStartSSHClient,
  StartSOCKS as bindStartSOCKS,
  StartExitNode as bindStartExitNode,
  StartExec as bindStartExec,
  StopChatRoom as bindStopChatRoom,
  StopSession as bindStopSession,
  TailcatVersion as bindTailcatVersion,
  GetClientInfo as bindGetClientInfo,
  GetSystemInfo as bindGetSystemInfo,
  GetUpdateStatus as bindGetUpdateStatus,
  SetLaunchAtLogin as bindSetLaunchAtLogin,
  SetUILocale as bindSetUILocale,
} from "../../wailsjs/go/main/App";
import { BrowserOpenURL, EventsOn } from "../../wailsjs/runtime/runtime";
import { adapter, main, session, store } from "../../wailsjs/go/models";
import { createBrowserHub } from "./chatBrowser";

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

export type NetworkSettings = {
  Region: string;
  DERPMapURL: string;
};

export type FileEntry = {
  Name: string;
  IsDir: boolean;
  Size: number;
  Mode: string;
  ModTime: string;
};

export type ClientInfo = {
  StartedAt: string;
  AppVersion: string;
  TailcatVersion: string;
  LastUpdateCheck: string;
};

export type UpdateStatus = {
  CurrentVersion: string;
  LatestVersion: string;
  LatestTag: string;
  UpdateAvailable: boolean;
  Notes: string;
  ReleaseURL: string;
  AssetName: string;
  DownloadURL: string;
  LastChecked: string;
  Status: string;
  Error: string;
  DownloadedPath: string;
  ProgressPercent: number;
  Platform: string;
};

export type UpdateProgress = {
  Received: number;
  Total: number;
  Percent: number;
};

export type SystemInfo = {
  OSVersion: string;
  LaunchAtLogin: boolean;
  LaunchAtLoginSupported: boolean;
  NetworkOnline: boolean;
  NetworkSummary: string;
};

const TAILCAT_EVENT = "tailcat:event";
export const TRAY_NAVIGATE_EVENT = "tailcat:navigate";
export const UPDATE_EVENT = "tailcat:update";
export const UPDATE_PROGRESS_EVENT = "tailcat:update-progress";

type GoWindow = Window & {
  go?: { main?: { App?: { StartChatRoom?: unknown } } };
  runtime?: unknown;
};

function goWindow(): GoWindow {
  return window as GoWindow;
}

export function hasWailsBindings(): boolean {
  return typeof window !== "undefined" && typeof goWindow().go?.main?.App?.StartChatRoom === "function";
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
  navListeners: Array<(page: string) => void>;
  updateListeners: Array<(status: UpdateStatus) => void>;
  progressListeners: Array<(progress: UpdateProgress) => void>;
  serveStops: Map<string, () => void>;
  ports: Map<string, string>;
  files: Map<string, string>;
  peers: Map<string, string>;
  startedAt: string;
  lastUpdateCheck: string;
  launchAtLogin: boolean;
  update: UpdateStatus;
  updateChecks: number;
};

function emptyUpdateStatus(): UpdateStatus {
  return {
    CurrentVersion: "0.1.0-dev",
    LatestVersion: "",
    LatestTag: "",
    UpdateAvailable: false,
    Notes: "",
    ReleaseURL: "",
    AssetName: "",
    DownloadURL: "",
    LastChecked: "",
    Status: "",
    Error: "",
    DownloadedPath: "",
    ProgressPercent: 0,
    Platform: "linux",
  };
}

const fake: FakeState = {
  sessions: [],
  keys: [],
  listeners: [],
  navListeners: [],
  updateListeners: [],
  progressListeners: [],
  serveStops: new Map(),
  ports: new Map(),
  files: new Map(),
  peers: new Map(),
  startedAt: new Date().toISOString(),
  lastUpdateCheck: "",
  launchAtLogin: false,
  update: emptyUpdateStatus(),
  updateChecks: 0,
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

async function fakeStartForward(addr: string, mappings: PortMapping[], openBrowser = false): Promise<Session> {
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
    const listen = port ? `127.0.0.1:${port}` : "127.0.0.1:0";
    current.Status = "running";
    current.Address = openBrowser ? `http://${listen}/` : listen;
    emitFake({ SessionID: current.ID, Kind: "ready", Address: current.Address, Data: current.Address });
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
  browserKeyJSON.set(
    name,
    JSON.stringify({ Name: name, Client: client, Region: region, Address: address, PrivateKey: { fake: name } }),
  );
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
    if (
      ![...fake.peers.values()].includes(addr) &&
      !addr.startsWith("tc:fake-port-") &&
      !addr.startsWith("tc:fake-exit-")
    ) {
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

export async function startChatRoom(keyName = ""): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartChatRoom(keyName));
  }
  return fakeStartChatRoom(keyName);
}

export async function connectChatPeer(roomID: string, addr: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindConnectChatPeer(roomID, addr);
    return;
  }
  await fakeConnectChatPeer(roomID, addr);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function sendChatVoice(
  roomID: string,
  mime: string,
  durationSec: number,
  audio: Uint8Array,
  burn = false,
  ttlSec = 0,
): Promise<void> {
  if (hasWailsBindings()) {
    await bindSendChatVoice(roomID, mime, durationSec, bytesToBase64(audio), burn, ttlSec);
    return;
  }
  await requireRoom(roomID).hub.sendVoice(mime, durationSec, audio, burn, ttlSec);
}

export async function decodeChatVoice(mime: string, audioBase64: string): Promise<string> {
  if (hasWailsBindings()) {
    return (await bindDecodeChatVoice(mime, audioBase64)) ?? "";
  }
  if (mime.includes("wav")) {
    return audioBase64;
  }
  throw new Error("Cannot play this voice message.");
}

export async function sendChatSignal(roomID: string, metaJSON: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindSendChatSignal(roomID, metaJSON);
    return;
  }
  requireRoom(roomID).hub.sendSignal(metaJSON);
}

export async function sendChatText(roomID: string, body: string, burn = false, ttlSec = 0): Promise<void> {
  if (hasWailsBindings()) {
    await bindSendChatText(roomID, body, burn, ttlSec);
    return;
  }
  await requireRoom(roomID).hub.sendText(body, burn, ttlSec);
}

export async function sendChatFile(roomID: string, path: string, burn = false, ttlSec = 0): Promise<string> {
  if (hasWailsBindings()) {
    return (await bindSendChatFile(roomID, path, burn, ttlSec)) ?? "";
  }
  throw new Error("file picker requires a running window");
}

export async function sendChatFileBytes(roomID: string, file: File, burn = false, ttlSec = 0): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return requireRoom(roomID).hub.sendFile(
    { name: file.name, mime: file.type || "application/octet-stream", bytes },
    burn,
    ttlSec,
  );
}

export async function discardChatMessage(roomID: string, id: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindDiscardChatMessage(roomID, id);
    return;
  }
  requireRoom(roomID).hub.discard(id);
}

export async function resendChatFile(roomID: string, id: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindResendChatFile(roomID, id);
    return;
  }
  await requireRoom(roomID).hub.resend(id);
}

export async function saveChatFile(roomID: string, id: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindSaveChatFile(roomID, id);
  }
}

export async function restartChatRoom(roomID: string, keyName: string): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindRestartChatRoom(roomID, keyName));
  }
  return fakeRestartChatRoom(roomID, keyName);
}

export async function stopChatRoom(roomID: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindStopChatRoom(roomID);
    return;
  }
  await fakeStopChatRoom(roomID);
}

export function emitBrowserEvent(ev: TailcatEvent): void {
  emitFake(ev);
}

export function resetBrowserRooms(): void {
  for (const [id, room] of browserRooms) {
    room.stopListen();
    room.hub.stop();
    fake.serveStops.delete(id);
  }
  browserRooms.clear();
  fake.sessions = fake.sessions.filter((item) => item.Kind !== "chat");
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

export async function startForward(addr: string, mappings: PortMapping[], openBrowser = false): Promise<Session> {
  if (hasWailsBindings()) {
    return asSession(await bindStartForward(addr, mappings.map(toMapping), openBrowser));
  }
  return fakeStartForward(addr, mappings, openBrowser);
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

let fakeSettings: NetworkSettings = { Region: "", DERPMapURL: "" };
const ROOM_CAP = 8;
type BrowserRoom = {
  session: Session;
  hub: ReturnType<typeof createBrowserHub>;
  stopListen: () => void;
  keyName: string;
};
const browserRooms = new Map<string, BrowserRoom>();
const browserKeyJSON = new Map<string, string>();

function requireRoom(roomID: string): BrowserRoom {
  const room = browserRooms.get(roomID);
  if (!room) {
    throw new Error("Unknown room.");
  }
  return room;
}

function emitBrowser(ev: { Kind: string; Data?: string; Address?: string; SessionID: string }): void {
  emitFake({ SessionID: ev.SessionID, Kind: ev.Kind, Address: ev.Address, Data: ev.Data });
}

function listenRoom(entry: BrowserRoom): void {
  entry.stopListen();
  const off = entry.hub.onEvent((ev) => {
    if (ev.Kind === "room-ready" && ev.Address && ev.SessionID === entry.session.ID) {
      entry.session.Status = "running";
      entry.session.Address = ev.Address;
    }
    emitBrowser(ev);
  });
  entry.stopListen = off;
  fake.serveStops.set(entry.session.ID, () => {
    off();
    entry.hub.stop();
    browserRooms.delete(entry.session.ID);
  });
}

async function fakeStartChatRoom(keyName: string): Promise<Session> {
  const name = keyName.trim();
  if (browserRooms.size >= ROOM_CAP) {
    throw new Error("You can keep 8 rooms open. Close one to start another.");
  }
  if (name && [...browserRooms.values()].some((room) => room.keyName === name)) {
    throw new Error("That key is already listening in another room.");
  }
  const material = name ? (browserKeyJSON.get(name) ?? "") : "";
  if (name && !material) {
    throw new Error("saved key is not a Tailcat private key");
  }
  const sess = newSess("chat");
  const entry: BrowserRoom = { session: sess, hub: createBrowserHub(), stopListen: () => undefined, keyName: name };
  browserRooms.set(sess.ID, entry);
  listenRoom(entry);
  await entry.hub.start(sess.ID, material);
  return { ...entry.session };
}

async function fakeConnectChatPeer(roomID: string, addr: string): Promise<void> {
  await requireRoom(roomID).hub.connect(addr);
}

async function fakeRestartChatRoom(roomID: string, keyName: string): Promise<Session> {
  const current = browserRooms.get(roomID);
  if (!current) {
    throw new Error("Unknown room.");
  }
  const name = keyName.trim();
  if (name && [...browserRooms.values()].some((room) => room !== current && room.keyName === name)) {
    throw new Error("That key is already listening in another room.");
  }
  const material = name ? (browserKeyJSON.get(name) ?? "") : "";
  if (name && !material) {
    throw new Error("saved key is not a Tailcat private key");
  }
  current.stopListen();
  fake.serveStops.delete(roomID);
  browserRooms.delete(roomID);
  fake.sessions = fake.sessions.filter((item) => item.ID !== roomID);
  const sess = newSess("chat");
  current.session = sess;
  current.keyName = name;
  browserRooms.set(sess.ID, current);
  listenRoom(current);
  await current.hub.restart(sess.ID, material);
  return { ...current.session };
}

async function fakeStopChatRoom(roomID: string): Promise<void> {
  const entry = browserRooms.get(roomID);
  if (!entry) {
    throw new Error("Unknown room.");
  }
  entry.stopListen();
  entry.hub.stop();
  browserRooms.delete(roomID);
  fake.serveStops.delete(roomID);
  fake.sessions = fake.sessions.filter((item) => item.ID !== roomID);
}

export async function getNetworkSettings(): Promise<NetworkSettings> {
  if (hasWailsBindings()) {
    const s = await bindGetNetworkSettings();
    return { Region: s.region ?? "", DERPMapURL: s.derpMapUrl ?? "" };
  }
  return { ...fakeSettings };
}

export async function setNetworkSettings(region: string, derpMapURL: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindSetNetworkSettings(region, derpMapURL);
    return;
  }
  fakeSettings = { Region: region, DERPMapURL: derpMapURL };
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

export async function tailcatVersion(): Promise<string> {
  if (hasWailsBindings()) {
    return bindTailcatVersion();
  }
  return "fake";
}

function asClientInfo(info: main.ClientInfo): ClientInfo {
  return {
    StartedAt: info.StartedAt ?? "",
    AppVersion: info.AppVersion ?? "",
    TailcatVersion: info.TailcatVersion ?? "",
    LastUpdateCheck: info.LastUpdateCheck ?? "",
  };
}

export function normalizeUpdateStatus(source: Partial<UpdateStatus> | null | undefined): UpdateStatus {
  const status = source ?? {};
  return {
    CurrentVersion: status.CurrentVersion ?? "",
    LatestVersion: status.LatestVersion ?? "",
    LatestTag: status.LatestTag ?? "",
    UpdateAvailable: Boolean(status.UpdateAvailable),
    Notes: status.Notes ?? "",
    ReleaseURL: status.ReleaseURL ?? "",
    AssetName: status.AssetName ?? "",
    DownloadURL: status.DownloadURL ?? "",
    LastChecked: status.LastChecked ?? "",
    Status: status.Status ?? "",
    Error: status.Error ?? "",
    DownloadedPath: status.DownloadedPath ?? "",
    ProgressPercent: Number(status.ProgressPercent ?? 0),
    Platform: status.Platform ?? "",
  };
}

function publishUpdate(status: UpdateStatus): void {
  fake.update = status;
  fake.lastUpdateCheck = status.LastChecked;
  for (const listener of [...fake.updateListeners]) {
    listener(status);
  }
}

function asSystemInfo(info: main.SystemInfo): SystemInfo {
  return {
    OSVersion: info.OSVersion ?? "",
    LaunchAtLogin: Boolean(info.LaunchAtLogin),
    LaunchAtLoginSupported: Boolean(info.LaunchAtLoginSupported),
    NetworkOnline: Boolean(info.NetworkOnline),
    NetworkSummary: info.NetworkSummary ?? "",
  };
}

function fakeClientInfo(): ClientInfo {
  return {
    StartedAt: fake.startedAt,
    AppVersion: "0.1.0-dev",
    TailcatVersion: "v0.7.0",
    LastUpdateCheck: fake.lastUpdateCheck,
  };
}

function fakeSystemInfo(): SystemInfo {
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  return {
    OSVersion: typeof navigator !== "undefined" ? navigator.platform || "browser" : "browser",
    LaunchAtLogin: fake.launchAtLogin,
    LaunchAtLoginSupported: false,
    NetworkOnline: online,
    NetworkSummary: online ? "browser" : "offline",
  };
}

export async function getClientInfo(): Promise<ClientInfo> {
  if (hasWailsBindings()) {
    return asClientInfo(await bindGetClientInfo());
  }
  return fakeClientInfo();
}

export async function getSystemInfo(): Promise<SystemInfo> {
  if (hasWailsBindings()) {
    return asSystemInfo(await bindGetSystemInfo());
  }
  return fakeSystemInfo();
}

export async function recordUpdateCheck(): Promise<ClientInfo> {
  await checkForUpdate();
  return getClientInfo();
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  if (hasWailsBindings()) {
    return normalizeUpdateStatus(await bindGetUpdateStatus());
  }
  return normalizeUpdateStatus(fake.update);
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (hasWailsBindings()) {
    return normalizeUpdateStatus(await bindCheckForUpdate());
  }
  fake.updateChecks += 1;
  // The browser preview has no Go checker. Keep whatever status a test
  // already published, and only move the last-checked clock.
  const next = normalizeUpdateStatus({
    ...fake.update,
    LastChecked: new Date().toISOString(),
  });
  publishUpdate(next);
  return next;
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (hasWailsBindings()) {
    return normalizeUpdateStatus(await bindDownloadUpdate());
  }
  if (!fake.update.UpdateAvailable || !fake.update.DownloadURL) {
    throw new Error("no update to download");
  }
  const name = fake.update.AssetName || "tailcat-box.zip";
  for (const listener of [...fake.progressListeners]) {
    listener({ Received: 4, Total: 4, Percent: 100 });
  }
  const next = normalizeUpdateStatus({
    ...fake.update,
    Status: "downloaded",
    DownloadedPath: `Downloads/${name}`,
    ProgressPercent: 100,
    Error: "",
    UpdateAvailable: true,
  });
  publishUpdate(next);
  return next;
}

export async function revealDownloadedUpdate(): Promise<void> {
  if (hasWailsBindings()) {
    await bindRevealDownloadedUpdate();
    return;
  }
  if (!fake.update.DownloadedPath) {
    throw new Error("no downloaded update");
  }
}

export function openReleasePage(url: string): void {
  if (!url.startsWith("https://github.com/mushroom11s/tailcat-box/")) {
    return;
  }
  openHttpURL(url);
}

export function openHttpURL(url: string): void {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return;
  }
  const safe = parsed.href;
  if (hasWailsBindings() && goWindow().runtime) {
    BrowserOpenURL(safe);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(safe, "_blank", "noopener,noreferrer");
  }
}

export function onUpdateStatus(callback: (status: UpdateStatus) => void): () => void {
  if (hasWailsBindings() && goWindow().runtime) {
    return EventsOn(UPDATE_EVENT, (status: UpdateStatus) => {
      callback(normalizeUpdateStatus(status));
    });
  }
  fake.updateListeners.push(callback);
  return () => {
    fake.updateListeners = fake.updateListeners.filter((listener) => listener !== callback);
  };
}

export function onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void {
  if (hasWailsBindings() && goWindow().runtime) {
    return EventsOn(UPDATE_PROGRESS_EVENT, (progress: UpdateProgress) => {
      callback({
        Received: Number(progress?.Received ?? 0),
        Total: Number(progress?.Total ?? 0),
        Percent: Number(progress?.Percent ?? 0),
      });
    });
  }
  fake.progressListeners.push(callback);
  return () => {
    fake.progressListeners = fake.progressListeners.filter((listener) => listener !== callback);
  };
}

export function emitUpdateStatus(status: UpdateStatus): void {
  publishUpdate(normalizeUpdateStatus(status));
}

export function updateCheckCount(): number {
  return fake.updateChecks;
}

export function resetFakeUpdateState(): void {
  fake.update = emptyUpdateStatus();
  fake.updateChecks = 0;
  fake.updateListeners = [];
  fake.progressListeners = [];
  fake.lastUpdateCheck = "";
}

export async function setUILocale(locale: string): Promise<void> {
  if (hasWailsBindings()) {
    await bindSetUILocale(locale);
  }
}

export async function setLaunchAtLogin(enabled: boolean): Promise<SystemInfo> {
  if (hasWailsBindings()) {
    return asSystemInfo(await bindSetLaunchAtLogin(enabled));
  }
  fake.launchAtLogin = enabled;
  return fakeSystemInfo();
}

export function onTrayNavigate(callback: (page: string) => void): () => void {
  if (hasWailsBindings() && goWindow().runtime) {
    return EventsOn(TRAY_NAVIGATE_EVENT, (page: unknown) => {
      if (typeof page === "string") {
        callback(page);
      }
    });
  }
  fake.navListeners.push(callback);
  return () => {
    fake.navListeners = fake.navListeners.filter((l) => l !== callback);
  };
}

// emitTrayNavigate delivers a tray page change to listeners registered
// without the Wails runtime (browser preview and tests).
export function emitTrayNavigate(page: string): void {
  for (const listener of [...fake.navListeners]) {
    listener(page);
  }
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
