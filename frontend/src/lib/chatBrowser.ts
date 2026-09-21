export type BrowserMessage = {
  id: string;
  direction: "in" | "out" | "system";
  type: "text" | "system";
  code?: string;
  body: string;
  at: string;
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

export function createBrowserHub() {
  let sessionID = "";
  let address = "";
  let peer = "";
  let running = false;
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
      if (trimmed !== "tc:fake-echo" && !trimmed.startsWith("tc:fake-room-")) {
        throw new Error("Could not reach peer. Check the address and that they are online.");
      }
      peer = trimmed;
      emit({ Kind: "peer", SessionID: sessionID, Data: JSON.stringify({ address: peer }) });
    },
    async sendText(body: string) {
      if (!body.trim()) {
        return;
      }
      if (!peer) {
        throw new Error("no peer");
      }
      if (peer !== "tc:fake-echo") {
        throw new Error("Could not reach peer. Check the address and that they are online.");
      }
      const out = message("out", "text", body);
      emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(out) });
      const inbound = message("in", "text", "echo");
      emit({ Kind: "message", SessionID: sessionID, Data: JSON.stringify(inbound) });
    },
    stop() {
      running = false;
      peer = "";
    },
    onEvent(cb: Listener) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
