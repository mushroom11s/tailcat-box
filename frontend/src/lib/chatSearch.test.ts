import { describe, expect, it } from "vitest";
import { highlightParts, matchesQuery } from "./chatSearch";

describe("chat search", () => {
  it("matches a blank query and ignores case", () => {
    expect(matchesQuery("Hello Cat", "")).toBe(true);
    expect(matchesQuery("Hello Cat", "  ")).toBe(true);
    expect(matchesQuery("Hello Cat", "cat")).toBe(true);
    expect(matchesQuery("Hello Cat", "dog")).toBe(false);
  });

  it("splits a message around every match", () => {
    expect(highlightParts("Cat food for the cat", "cat")).toEqual([
      { text: "Cat", match: true },
      { text: " food for the ", match: false },
      { text: "cat", match: true },
    ]);
    expect(highlightParts("plain", "zzz")).toEqual([{ text: "plain", match: false }]);
    expect(highlightParts("", "cat")).toEqual([]);
  });
});
