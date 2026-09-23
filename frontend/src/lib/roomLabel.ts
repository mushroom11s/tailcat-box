// Room list labels are the short address until a local peer-remark
// map (current peer address → display name) exists. The Settings
// self nickname is for outgoing bubbles, not the room list.
export function abbreviateAddress(address: string): string {
  const chars = Array.from(address);
  if (chars.length <= 8) {
    return address;
  }
  return `tc…${chars.slice(-4).join("")}`;
}

export function roomPrimaryLabel(address: string, startingLabel: string): string {
  return address ? abbreviateAddress(address) : startingLabel;
}

export function roomTooltip(address: string, keyName: string): string {
  return [address.trim(), keyName.trim()].filter(Boolean).join("\n");
}
