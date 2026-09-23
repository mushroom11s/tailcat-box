import { describe, expect, it } from "vitest";
import { NICKNAME_MAX, displayNickname, sanitizeNickname } from "./nickname";

describe("nickname", () => {
  it("trims surrounding whitespace for display and keeps an internal space", () => {
    expect(displayNickname("  Mochi  ")).toBe("Mochi");
    expect(displayNickname("  Mo chi  ")).toBe("Mo chi");
    expect(sanitizeNickname("  Mochi  ")).toBe("  Mochi  ");
  });

  it("treats a whitespace-only value as empty", () => {
    expect(displayNickname(" \t\n ")).toBe("");
  });

  it("strips control characters and line separators", () => {
    expect(displayNickname("Mo\u0000chi\n")).toBe("Mochi");
    expect(displayNickname("a\u0007b\u2028c\u2029d")).toBe("abcd");
  });

  it("caps the value at 32 Unicode code points", () => {
    expect(displayNickname("a".repeat(40))).toBe("a".repeat(NICKNAME_MAX));
    expect(displayNickname("😀".repeat(40))).toBe("😀".repeat(NICKNAME_MAX));
    expect(Array.from(displayNickname("😀".repeat(40))).length).toBe(NICKNAME_MAX);
  });
});
