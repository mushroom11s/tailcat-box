export type PurgeMessage = {
  id: string;
  direction: "in" | "out" | "system";
};

/** Selected bubble ids plus system lines in [minSelectedIndex, maxSelectedIndex]. List order. */
export function purgeDiscardIds(
  messages: readonly PurgeMessage[],
  selectedIds: ReadonlySet<string> | Iterable<string>,
): string[] {
  const selected = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  let min = -1;
  let max = -1;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (msg.direction === "system") {
      continue;
    }
    if (!selected.has(msg.id)) {
      continue;
    }
    if (min < 0 || i < min) {
      min = i;
    }
    if (i > max) {
      max = i;
    }
  }
  if (min < 0) {
    return [];
  }
  const out: string[] = [];
  for (let i = min; i <= max; i++) {
    const msg = messages[i]!;
    if (selected.has(msg.id) || msg.direction === "system") {
      out.push(msg.id);
    }
  }
  return out;
}
