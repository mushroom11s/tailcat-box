export type BrowserMessage = {
  id: string;
  direction: "in" | "out" | "system";
  type: string;
  code?: string;
  body?: string;
  at: string;
  name?: string;
  mime?: string;
  size?: number;
  burn?: boolean;
  ttlSec?: number;
  preview?: string;
  fileId?: string;
  duration?: number;
  audio?: string;
};

export type BrowserFile = {
  name: string;
  mime: string;
  bytes: Uint8Array;
};

type Listener = (ev: { Kind: string; Data?: string; Address?: string; SessionID: string }) => void;

function id(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function addressFor(sessionID: string, keyJSON: string): Promise<string> {
  if (!keyJSON.trim()) {
    return "tc:fake-room-" + sessionID;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyJSON));
  const hex = Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
  return "tc:fake-room-key-" + hex;
}

function message(
  direction: BrowserMessage["direction"],
  type: BrowserMessage["type"],
  body: string,
  code?: string,
): BrowserMessage {
  return { id: id(), direction, type, code, body, at: new Date().toISOString() };
}

function peerCaps(addr: string): string[] {
  if (addr === "tc:fake-box") {
    return ["burn", "resume"];
  }
  if (addr === "tc:fake-resume") {
    return ["resume"];
  }
  return [];
}

function dataURL(mime: string, bytes: Uint8Array): string {
  if (!mime.startsWith("image/") || bytes.length === 0) {
    return "";
  }
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `data:${mime};base64,${btoa(binary)}`;
}

export function createBrowserHub() {
  let sessionID = "";
  let address = "";
  let peer = "";
  let running = false;
  let sending = false;
  let queued: { file: BrowserFile; burn: boolean; ttl: number } | null = null;
  const listeners = new Set<Listener>();

  function emit(ev: { Kind: string; Data?: string; Address?: string; SessionID: string }) {
    for (const listener of listeners) {
      listener(ev);
    }
  }

  async function open(nextID: string, keyJSON: string, restarted: boolean): Promise<{ address: string }> {
    sessionID = nextID;
    address = await addressFor(nextID, keyJSON);
    peer = "";
    running = true;
    emit({ Kind: "room-ready", SessionID: sessionID, Address: address, Data: JSON.stringify({ address }) });
    if (restarted) {
      const msg = message("system", "system", "Room restarted. Send the new address.", "room-restarted");
      emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(msg) });
      emit({ Kind: "peer", SessionID: sessionID, Data: JSON.stringify({ address: "" }) });
    }
    return { address };
  }

  async function deliverFile(file: BrowserFile, burn: boolean, ttl: number): Promise<void> {
    const transferID = id();
    const caps = peerCaps(peer);
    const mode = caps.includes("resume") ? "resume" : "full";
    const ttlSec = burn ? Math.max(0, Math.min(30, ttl)) : 0;
    const preview = dataURL(file.mime, file.bytes);
    if (mode === "resume") {
      emit({
        Kind: "transfer",
        SessionID: sessionID,
        Data: JSON.stringify({ id: transferID, offset: 0, size: file.bytes.length, mode, status: "active", name: file.name }),
      });
    }
    emit({
      Kind: "transfer",
      SessionID: sessionID,
      Data: JSON.stringify({
        id: transferID,
        offset: file.bytes.length,
        size: file.bytes.length,
        mode,
        status: "done",
        name: file.name,
      }),
    });
    const msg = message("out", "file", "");
    msg.name = file.name;
    msg.mime = file.mime;
    msg.size = file.bytes.length;
    msg.fileId = transferID;
    msg.preview = preview;
    if (burn) {
      msg.burn = true;
      msg.ttlSec = ttlSec;
    }
    emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(msg) });
    sending = false;
    const next = queued;
    queued = null;
    if (next) {
      sending = true;
      await deliverFile(next.file, next.burn, next.ttl);
    }
  }

  return {
    start(nextID: string, keyJSON: string) {
      if (running && address) {
        return Promise.resolve({ address });
      }
      return open(nextID, keyJSON, false);
    },
    restart(nextID: string, keyJSON: string) {
      running = false;
      peer = "";
      return open(nextID, keyJSON, true);
    },
    async connect(addr: string) {
      const trimmed = addr.trim();
      if (!trimmed.startsWith("tc")) {
        throw new Error("Paste a Tailcat address that starts with tc.");
      }
      if (!running) {
        throw new Error("room is not listening");
      }
      const known =
        trimmed === "tc:fake-echo" ||
        trimmed === "tc:fake-official" ||
        trimmed === "tc:fake-resume" ||
        trimmed === "tc:fake-box" ||
        trimmed.startsWith("tc:fake-room-");
      if (!known) {
        throw new Error("Could not reach peer. Check the address and that they are online.");
      }
      peer = trimmed;
      const caps = peerCaps(trimmed);
      const payload: { address: string; caps?: string[] } = { address: peer };
      if (caps.length > 0) {
        payload.caps = caps;
      }
      emit({ Kind: "peer", SessionID: sessionID, Data: JSON.stringify(payload) });
    },
    async sendText(body: string, burn = false, ttl = 0) {
      if (!body.trim()) {
        return;
      }
      if (!peer) {
        throw new Error("no peer");
      }
      if (peer !== "tc:fake-echo" && peer !== "tc:fake-official" && peer !== "tc:fake-box" && peer !== "tc:fake-resume") {
        throw new Error("Could not reach peer. Check the address and that they are online.");
      }
      const ttlSec = burn ? Math.max(0, Math.min(30, ttl)) : 0;
      const out = message("out", "text", body);
      if (burn) {
        out.burn = true;
        out.ttlSec = ttlSec;
      }
      emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(out) });
      if (peer === "tc:fake-echo") {
        const inbound = message("in", "text", "echo");
        emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(inbound) });
      }
    },
    async sendVoice(mime: string, duration: number, audio: Uint8Array, burn = false, ttl = 0) {
      if (!peer) {
        throw new Error("no peer");
      }
      if (peer !== "tc:fake-echo" && peer !== "tc:fake-official" && peer !== "tc:fake-box" && peer !== "tc:fake-resume") {
        throw new Error("Could not reach peer. Check the address and that they are online.");
      }
      const ttlSec = burn ? Math.max(0, Math.min(30, ttl)) : 0;
      const dur = Math.max(1, Math.round(duration) || 1);
      let binary = "";
      audio.forEach((b) => {
        binary += String.fromCharCode(b);
      });
      const encoded = btoa(binary);
      const out = message("out", "voice", "");
      out.mime = mime;
      out.duration = dur;
      out.audio = encoded;
      if (burn) {
        out.burn = true;
        out.ttlSec = ttlSec;
      }
      emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(out) });
      if (peer === "tc:fake-echo") {
        const inbound = message("in", "voice", "");
        inbound.mime = mime;
        inbound.duration = dur;
        inbound.audio = encoded;
        if (burn) {
          inbound.burn = true;
          inbound.ttlSec = ttlSec;
        }
        emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(inbound) });
      }
    },
    sendFile(file: BrowserFile, burn: boolean, ttl: number): string {
      if (!peer) {
        throw new Error("no peer");
      }
      if (sending) {
        const replaced = queued != null;
        queued = { file, burn, ttl };
        return replaced ? "replaced" : "";
      }
      sending = true;
      void deliverFile(file, burn, ttl);
      return "";
    },
    discard(messageID: string) {
      emit({ Kind: "discard", SessionID: sessionID, Data: JSON.stringify({ id: messageID }) });
    },
    async resend(transferID: string) {
      emit({
        Kind: "transfer",
        SessionID: sessionID,
        Data: JSON.stringify({ id: transferID, offset: 0, size: 0, mode: "resume", status: "active" }),
      });
    },
    stop() {
      running = false;
      peer = "";
      sending = false;
      queued = null;
    },
    onEvent(cb: Listener) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
