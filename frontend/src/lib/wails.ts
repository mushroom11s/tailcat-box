import {
  DialPipe as bindDialPipe,
  ListSessions as bindListSessions,
  StartPipeServe as bindStartPipeServe,
  StopSession as bindStopSession,
} from "../../wailsjs/go/main/App";
import { EventsOn } from "../../wailsjs/runtime/runtime";
import { session } from "../../wailsjs/go/models";

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

type FakeState = {
  sessions: Session[];
  listeners: Array<(ev: TailcatEvent) => void>;
  serveStops: Map<string, () => void>;
};

const fake: FakeState = {
  sessions: [],
  listeners: [],
  serveStops: new Map(),
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

async function fakeStartPipeServe(): Promise<Session> {
  const sess: Session = {
    ID: newID(),
    Kind: "pipe_serve",
    Status: "starting",
    Address: "",
    CreatedAt: new Date().toISOString(),
    Err: "",
  };
  upsertFake(sess);
  const timer = window.setTimeout(() => {
    const current = fake.sessions.find((s) => s.ID === sess.ID);
    if (!current || current.Status === "stopped") {
      return;
    }
    current.Status = "running";
    current.Address = "tc:fake-" + current.ID;
    emitFake({ SessionID: current.ID, Kind: "ready", Address: current.Address });
  }, 10);
  fake.serveStops.set(sess.ID, () => window.clearTimeout(timer));
  return { ...sess };
}

async function fakeDialPipe(addr: string, payload: string): Promise<Session> {
  const sess: Session = {
    ID: newID(),
    Kind: "pipe_dial",
    Status: "starting",
    Address: addr,
    CreatedAt: new Date().toISOString(),
    Err: "",
  };
  upsertFake(sess);
  window.setTimeout(() => {
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
  }, 10);
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
