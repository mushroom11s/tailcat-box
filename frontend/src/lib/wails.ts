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
};

const fake: FakeState = {
  sessions: [],
  keys: [],
  listeners: [],
  serveStops: new Map(),
  ports: new Map(),
};

function newID(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function emitFake(ev: TailcatEvent): void {
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
  return fake.sessions.map((s) => ({ ...s }));
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
  return fake.keys.map((k) => ({ ...k }));
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
