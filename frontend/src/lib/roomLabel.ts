import { remarkFor, type RemarkMap } from "./remark";

// Room list labels prefer the local peer remark for that room's current
// peer address, then the short address. The Settings self nickname is
// for outgoing bubbles, not the room list. A remark is never sent.
export function abbreviateAddress(address: string): string {
  const chars = Array.from(address);
  if (chars.length <= 8) {
    return address;
  }
  return `tc…${chars.slice(-4).join("")}`;
}

export function remarkIsShared(peer: string, peers: readonly string[], remarks: RemarkMap): boolean {
  const remark = remarkFor(remarks, peer);
  if (!remark) {
    return false;
  }
  let count = 0;
  for (const item of peers) {
    if (remarkFor(remarks, item) === remark) {
      count += 1;
      if (count > 1) {
        return true;
      }
    }
  }
  return false;
}

export function roomPrimaryLabel(
  address: string,
  startingLabel: string,
  peer = "",
  remarks: RemarkMap = {},
  duplicate = false,
): string {
  const remark = remarkFor(remarks, peer);
  if (remark) {
    if (duplicate && address) {
      return `${remark} · ${abbreviateAddress(address)}`;
    }
    return remark;
  }
  return address ? abbreviateAddress(address) : startingLabel;
}

export function roomTooltip(address: string, keyName: string): string {
  return [address.trim(), keyName.trim()].filter(Boolean).join("\n");
}
