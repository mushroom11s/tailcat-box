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

export async function startPipeServe(): Promise<Session> {
  return asSession(await bindStartPipeServe());
}

export async function dialPipe(addr: string, payload: string): Promise<Session> {
  return asSession(await bindDialPipe(addr, payload));
}

export async function stopSession(id: string): Promise<void> {
  await bindStopSession(id);
}

export async function listSessions(): Promise<Session[]> {
  const list = await bindListSessions();
  return (list ?? []).map(asSession);
}

export function onTailcatEvent(callback: (ev: TailcatEvent) => void): () => void {
  const runtime = (window as unknown as { runtime?: unknown }).runtime;
  if (!runtime) {
    return () => {};
  }
  return EventsOn(TAILCAT_EVENT, (ev: TailcatEvent) => {
    callback(ev);
  });
}
