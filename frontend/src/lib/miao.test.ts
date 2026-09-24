import { describe, expect, it } from "vitest";
import { acceptMiaoCode, downloadsLeft, MAX_SHARE_BYTES, parseJoin, remainingTTL, shareTooLarge } from "./miao";

describe("miao share helpers", () => {
  it("rejects a total above 300 MiB", () => {
    expect(shareTooLarge([MAX_SHARE_BYTES])).toBe(false);
    expect(shareTooLarge([MAX_SHARE_BYTES + 1])).toBe(true);
    expect(shareTooLarge([200 * 1024 * 1024, 100 * 1024 * 1024 + 1])).toBe(true);
    expect(shareTooLarge([1024, 2048])).toBe(false);
  });

  it("parses a join payload and rejects a bare address", () => {
    const raw = JSON.stringify({ v: 1, kind: "miao", addr: "tc:room", token: "abc" });
    expect(parseJoin(`  ${raw}  `)).toEqual({ v: 1, kind: "miao", addr: "tc:room", token: "abc" });
    expect(acceptMiaoCode(raw)).toEqual({ ok: true, value: raw });
    expect(parseJoin("tc:room")).toBeNull();
    expect(acceptMiaoCode("tc:room")).toEqual({ ok: false });
  });

  it("counts remaining downloads and treats 0 as unlimited", () => {
    expect(downloadsLeft(1, 0)).toBe(1);
    expect(downloadsLeft(1, 1)).toBe(0);
    expect(downloadsLeft(0, 4)).toBeNull();
  });

  it("formats a finite TTL and forever", () => {
    const now = Date.parse("2026-09-24T00:00:00Z");
    expect(remainingTTL("", true, now)).toEqual({ kind: "forever" });
    expect(remainingTTL("2026-09-24T00:00:00Z", false, now)).toEqual({ kind: "expired" });
    expect(remainingTTL("2026-09-25T01:02:00Z", false, now)).toEqual({ kind: "left", days: 1, hours: 1, minutes: 2 });
  });
});
