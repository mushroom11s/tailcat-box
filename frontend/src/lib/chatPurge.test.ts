import { describe, expect, it } from "vitest";
import { purgeDiscardIds, type PurgeMessage } from "./chatPurge";

const msgs: PurgeMessage[] = [
  { id: "sys-a", direction: "system" },
  { id: "b", direction: "in" },
  { id: "sys-c", direction: "system" },
  { id: "d", direction: "out" },
  { id: "sys-e", direction: "system" },
  { id: "f", direction: "in" },
];

describe("purgeDiscardIds", () => {
  it("returns empty when nothing is selected", () => {
    expect(purgeDiscardIds(msgs, new Set())).toEqual([]);
  });

  it("discards one bubble and no systems when alone in range", () => {
    expect(purgeDiscardIds(msgs, new Set(["f"]))).toEqual(["f"]);
  });

  it("includes in-range system lines between earliest and latest selected", () => {
    expect(purgeDiscardIds(msgs, new Set(["b", "d"]))).toEqual(["b", "sys-c", "d"]);
  });

  it("leaves non-selected non-system messages inside the index range", () => {
    expect(purgeDiscardIds(msgs, new Set(["b", "f"]))).toEqual(["b", "sys-c", "sys-e", "f"]);
  });

  it("ignores selected ids that are not in the list", () => {
    expect(purgeDiscardIds(msgs, new Set(["missing"]))).toEqual([]);
  });

  it("does not treat a system id in selectedIds as a selectable anchor", () => {
    expect(purgeDiscardIds(msgs, new Set(["sys-c"]))).toEqual([]);
  });
});
