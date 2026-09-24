export const ROOM_PINS_KEY = "tailcat-room-pins";

export function readRoomPins(): string[] {
  try {
    const raw = localStorage.getItem(ROOM_PINS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: string[] = [];
    for (const item of parsed) {
      if (typeof item !== "string") {
        continue;
      }
      const id = item.trim();
      if (!id || out.includes(id)) {
        continue;
      }
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

export function writeRoomPins(ids: string[]): void {
  try {
    localStorage.setItem(ROOM_PINS_KEY, JSON.stringify(ids));
  } catch {
    // A full quota or private mode should not break the room list.
  }
}

export function toggleRoomPin(ids: string[], id: string): string[] {
  const key = id.trim();
  if (!key) {
    return ids;
  }
  if (ids.includes(key)) {
    return ids.filter((item) => item !== key);
  }
  return [key, ...ids.filter((item) => item !== key)];
}

export function forgetRoomPin(ids: string[], id: string): string[] {
  return ids.filter((item) => item !== id);
}

export function renameRoomPin(ids: string[], from: string, to: string): string[] {
  const next = to.trim();
  if (!from || !next || from === next) {
    return ids;
  }
  return ids.map((item) => (item === from ? next : item));
}

// orderWithPins keeps pinned rooms first, in pin order, then the other rooms in their current order.
export function orderWithPins(order: string[], pins: string[]): string[] {
  const present = new Set(order);
  const pinned = pins.filter((id) => present.has(id));
  const pinnedSet = new Set(pinned);
  return [...pinned, ...order.filter((id) => !pinnedSet.has(id))];
}
