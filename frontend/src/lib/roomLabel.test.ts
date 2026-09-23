import { describe, expect, it } from "vitest";
import { abbreviateAddress, readNickname, roomPrimaryLabel, roomTooltip, NICKNAME_KEY } from "./roomLabel";

describe("room labels", () => {
  it("abbreviates long addresses and keeps short ones", () => {
    expect(abbreviateAddress("tc:abcdef1234")).toBe("tc…1234");
    expect(abbreviateAddress("tc:abcd")).toBe("tc:abcd");
    expect(abbreviateAddress("")).toBe("");
  });

  it("prefers a nickname and disambiguates when several rooms share it", () => {
    expect(roomPrimaryLabel("Alice", "tc:abcdef1234", "Starting…", 1)).toBe("Alice");
    expect(roomPrimaryLabel("Alice", "tc:abcdef1234", "Starting…", 2)).toBe("Alice · tc…1234");
    expect(roomPrimaryLabel("  ", "tc:abcdef1234", "Starting…", 2)).toBe("tc…1234");
    expect(roomPrimaryLabel("", "", "Starting…", 1)).toBe("Starting…");
  });

  it("reads the settings nickname from local storage", () => {
    localStorage.setItem(NICKNAME_KEY, "  Alice  ");
    expect(readNickname()).toBe("Alice");
    localStorage.removeItem(NICKNAME_KEY);
    expect(readNickname()).toBe("");
  });

  it("puts the address and key name in the tooltip", () => {
    expect(roomTooltip("tc:abcdef1234", "home")).toBe("tc:abcdef1234\nhome");
    expect(roomTooltip("tc:abcdef1234", "")).toBe("tc:abcdef1234");
  });
});
