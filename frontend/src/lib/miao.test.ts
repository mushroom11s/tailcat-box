import { afterEach, describe, expect, it } from "vitest";
import { browserJoinMiao, browserStartMiao, resetBrowserMiao } from "./miaoBrowser";
import { acceptMiaoCode, downloadsLeft, encodeJoin, MAX_SHARE_BYTES, parseJoin, remainingTTL, shareTooLarge } from "./miao";

afterEach(() => {
  resetBrowserMiao();
});

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

  it("round-trips a compact share code and rejects garbage", () => {
    expect(encodeJoin("tc:room", "abc")).toBe("mw1.AAAHdGM6cm9vbQADYWJj");
    expect(parseJoin("  mw1.AAAHdGM6cm9vbQADYWJj\n")).toEqual({ v: 1, kind: "miao", addr: "tc:room", token: "abc" });
    expect(encodeJoin("tcEREREQ", "abcd")).toBe("mw1.AQAEEREREQAEYWJjZA");
    expect(parseJoin("mw1.AQAEEREREQAEYWJjZA")).toEqual({ v: 1, kind: "miao", addr: "tcEREREQ", token: "abcd" });
    const addr = `tc${bytesToBase64Url(new Uint8Array(80).fill(0x11))}`;
    const token = "0123456789abcdef0123456789abcdef";
    const compact = encodeJoin(addr, token);
    expect(compact?.startsWith("mw1.")).toBe(true);
    expect(parseJoin(compact ?? "")).toEqual({ v: 1, kind: "miao", addr, token });
    const legacy = JSON.stringify({ v: 1, kind: "miao", addr, token });
    expect((compact ?? "").length).toBeLessThan(legacy.length);
    expect(encodeJoin("room", "abc")).toBeNull();
    for (const bad of ["", "mw1.", "mw1.!!!!", "mw1.YQ", "nope"]) {
      expect(parseJoin(bad)).toBeNull();
      expect(acceptMiaoCode(bad)).toEqual({ ok: false });
    }
  });

  it("joins a legacy JSON code and a compact code", async () => {
    const share = await browserStartMiao([{ name: "a.txt", path: "", dataBase64: btoa("hi") }], 1, false, 2);
    expect(share.payload.startsWith("mw1.")).toBe(true);
    expect(parseJoin(share.payload)).toEqual({ v: 1, kind: "miao", addr: share.address, token: share.token });
    const legacy = JSON.stringify({ v: 1, kind: "miao", addr: share.address, token: share.token });
    expect(browserJoinMiao(legacy).files[0]?.name).toBe("a.txt");
    expect(browserJoinMiao(share.payload).files[0]?.name).toBe("a.txt");
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

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
