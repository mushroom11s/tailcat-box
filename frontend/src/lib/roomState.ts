import type { ChatMessage, ChatTransfer } from "../pages/ChatPage";
import type { TailcatEvent } from "./wails";

export type RoomSlice = {
  id: string;
  keyName: string;
  address: string;
  peer: string;
  caps: string[];
  messages: ChatMessage[];
  transfers: ChatTransfer[];
  error: string;
  peerDraft: string;
  composer: string;
  burn: boolean;
};

export function emptyRoom(id: string, peerDraft = ""): RoomSlice {
  return {
    id,
    keyName: "",
    address: "",
    peer: "",
    caps: [],
    messages: [],
    transfers: [],
    error: "",
    peerDraft,
    composer: "",
    burn: false,
  };
}

function asMessage(data: string): ChatMessage | null {
  try {
    const msg = JSON.parse(data) as ChatMessage;
    if (!msg.id || !msg.direction) {
      return null;
    }
    return msg;
  } catch {
    return null;
  }
}

export function applyRoomEvent(room: RoomSlice, ev: TailcatEvent): RoomSlice {
  if (ev.SessionID && ev.SessionID !== room.id) {
    return room;
  }
  if (ev.Kind === "room-ready" && ev.Data) {
    try {
      const data = JSON.parse(ev.Data) as { address?: string };
      if (data.address) {
        return { ...room, address: data.address, error: "" };
      }
    } catch {
      return room;
    }
  } else if (ev.Kind === "peer" && ev.Data) {
    try {
      const data = JSON.parse(ev.Data) as { address?: string; caps?: string[] };
      const next = data.address ?? "";
      let caps = room.caps;
      if (Array.isArray(data.caps)) {
        caps = data.caps;
      } else if (next !== room.peer) {
        caps = [];
      }
      return { ...room, peer: next, caps };
    } catch {
      return room;
    }
  } else if (ev.Kind === "message" && ev.Data) {
    const msg = asMessage(ev.Data);
    if (!msg || room.messages.some((item) => item.id === msg.id)) {
      return room;
    }
    const next: RoomSlice = { ...room, messages: [...room.messages, msg] };
    if (msg.code === "room-restarted") {
      next.peer = "";
      next.caps = [];
    }
    return next;
  } else if (ev.Kind === "transfer" && ev.Data) {
    try {
      const tr = JSON.parse(ev.Data) as ChatTransfer;
      if (!tr.id) {
        return room;
      }
      const index = room.transfers.findIndex((item) => item.id === tr.id);
      if (index < 0) {
        return { ...room, transfers: [...room.transfers, tr] };
      }
      const transfers = room.transfers.slice();
      transfers[index] = tr;
      return { ...room, transfers };
    } catch {
      return room;
    }
  } else if (ev.Kind === "discard" && ev.Data) {
    try {
      const data = JSON.parse(ev.Data) as { id?: string };
      if (!data.id) {
        return room;
      }
      return { ...room, messages: room.messages.filter((item) => item.id !== data.id) };
    } catch {
      return room;
    }
  }
  return room;
}
