export const NICKNAME_KEY = "tailcat-nickname";

// readNickname reads the Settings nickname when that store exists.
// The value stays on this computer and is never put on the wire.
export function readNickname(): string {
  try {
    return (localStorage.getItem(NICKNAME_KEY) ?? "").trim();
  } catch {
    return "";
  }
}

export function abbreviateAddress(address: string): string {
  const chars = Array.from(address);
  if (chars.length <= 8) {
    return address;
  }
  return `tc…${chars.slice(-4).join("")}`;
}

export function roomPrimaryLabel(nickname: string, address: string, startingLabel: string, openRooms: number): string {
  const abbrev = address ? abbreviateAddress(address) : startingLabel;
  const nick = nickname.trim();
  if (!nick) {
    return abbrev;
  }
  if (openRooms >= 2) {
    return `${nick} · ${abbrev}`;
  }
  return nick;
}

export function roomTooltip(address: string, keyName: string): string {
  return [address.trim(), keyName.trim()].filter(Boolean).join("\n");
}
