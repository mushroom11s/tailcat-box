import { describe, expect, it } from "vitest";
import { NICKNAME_KEY } from "./nickname";
import { abbreviateAddress, remarkIsShared, roomPrimaryLabel, roomTooltip } from "./roomLabel";

describe("room labels", () => {
  it("abbreviates long addresses and keeps short ones", () => {
    expect(abbreviateAddress("tc:abcdef1234")).toBe("tc…1234");
    expect(abbreviateAddress("tc:abcd")).toBe("tc:abcd");
    expect(abbreviateAddress("")).toBe("");
  });

  it("uses the address abbreviation and ignores a self nickname", () => {
    localStorage.setItem(NICKNAME_KEY, "Alice");
    expect(roomPrimaryLabel("tc:abcdef1234", "Starting…")).toBe("tc…1234");
    expect(roomPrimaryLabel("tc:abcd", "Starting…")).toBe("tc:abcd");
    expect(roomPrimaryLabel("", "Starting…")).toBe("Starting…");
    expect(roomPrimaryLabel("tc:abcdef1234", "Starting…", "", { "tc:peer": "Bob" })).toBe("tc…1234");
  });

  it("prefers the peer remark and suffixes it when two rooms would match", () => {
    const remarks = { "tc:peer": "Bob", "tc:other": "Bob" };
    expect(roomPrimaryLabel("tc:abcdef1234", "Starting…", "tc:peer", remarks)).toBe("Bob");
    expect(roomPrimaryLabel("tc:abcdef1234", "Starting…", "tc:missing", remarks)).toBe("tc…1234");
    expect(remarkIsShared("tc:peer", ["tc:peer", "tc:other"], remarks)).toBe(true);
    expect(remarkIsShared("tc:peer", ["tc:peer"], remarks)).toBe(false);
    expect(roomPrimaryLabel("tc:abcdef1234", "Starting…", "tc:peer", remarks, true)).toBe("Bob · tc…1234");
    expect(roomPrimaryLabel("", "Starting…", "tc:peer", { "tc:peer": "Bob" }, true)).toBe("Bob");
  });

  it("puts the address and key name in the tooltip", () => {
    expect(roomTooltip("tc:abcdef1234", "home")).toBe("tc:abcdef1234\nhome");
    expect(roomTooltip("tc:abcdef1234", "")).toBe("tc:abcdef1234");
  });
});
