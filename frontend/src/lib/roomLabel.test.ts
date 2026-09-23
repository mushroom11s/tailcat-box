import { describe, expect, it } from "vitest";
import { abbreviateAddress, roomPrimaryLabel, roomTooltip } from "./roomLabel";

describe("room labels", () => {
  it("abbreviates long addresses and keeps short ones", () => {
    expect(abbreviateAddress("tc:abcdef1234")).toBe("tc…1234");
    expect(abbreviateAddress("tc:abcd")).toBe("tc:abcd");
    expect(abbreviateAddress("")).toBe("");
  });

  it("uses the address abbreviation and ignores a self nickname", () => {
    expect(roomPrimaryLabel("tc:abcdef1234", "Starting…")).toBe("tc…1234");
    expect(roomPrimaryLabel("tc:abcd", "Starting…")).toBe("tc:abcd");
    expect(roomPrimaryLabel("", "Starting…")).toBe("Starting…");
  });

  it("puts the address and key name in the tooltip", () => {
    expect(roomTooltip("tc:abcdef1234", "home")).toBe("tc:abcdef1234\nhome");
    expect(roomTooltip("tc:abcdef1234", "")).toBe("tc:abcdef1234");
  });
});
