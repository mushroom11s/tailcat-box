import { beforeEach, describe, expect, it } from "vitest";
import {
  REMARKS_KEY,
  REMARK_MAX,
  applyRemark,
  labelPeerAddress,
  readRemarks,
  remarkAddress,
  remarkFor,
  writeRemarks,
} from "./remark";

beforeEach(() => {
  localStorage.clear();
});

describe("peer remarks", () => {
  it("trims for display, keeps an internal space, and treats whitespace as empty", () => {
    const editing = applyRemark({}, "tc:peer", "  Mo chi  ", false);
    expect(editing["tc:peer"]).toBe("  Mo chi  ");
    expect(remarkFor(editing, "tc:peer")).toBe("Mo chi");
    const committed = applyRemark(editing, "tc:peer", "  Mo chi  ", true);
    expect(committed["tc:peer"]).toBe("Mo chi");
    expect(applyRemark({ "tc:peer": "Mo chi" }, "tc:peer", " \t\n ", true)).toEqual({});
  });

  it("strips control characters and caps at 32 Unicode code points", () => {
    expect(applyRemark({}, "tc:peer", "Mo\u0000chi\n", true)["tc:peer"]).toBe("Mochi");
    expect(applyRemark({}, "tc:peer", "a\u0007b\u2028c\u2029d", true)["tc:peer"]).toBe("abcd");
    expect(applyRemark({}, "tc:peer", "😀".repeat(40), true)["tc:peer"]).toBe("😀".repeat(REMARK_MAX));
  });

  it("ignores a non-address and persists a cleared map", () => {
    expect(applyRemark({ "tc:peer": "Bob" }, "nope", "Bob", true)).toEqual({ "tc:peer": "Bob" });
    const cleared = applyRemark({ "tc:peer": "Bob" }, "tc:peer", "", true);
    writeRemarks(cleared);
    expect(JSON.parse(localStorage.getItem(REMARKS_KEY) ?? "{}")).toEqual({});
    expect(readRemarks()).toEqual({});
  });

  it("round-trips the map and drops garbage", () => {
    writeRemarks(applyRemark(applyRemark({}, "tc:a", "Ann", true), "tc:b", "Ben", true));
    expect(readRemarks()).toEqual({ "tc:a": "Ann", "tc:b": "Ben" });
    localStorage.setItem(REMARKS_KEY, "not-json");
    expect(readRemarks()).toEqual({});
    localStorage.setItem(
      REMARKS_KEY,
      JSON.stringify({ "tc:ok": "  Pat  ", nope: "X", "tc:blank": "   ", "tc:bad": 4 }),
    );
    expect(readRemarks()).toEqual({ "tc:ok": "Pat" });
  });

  it("edits a pasted address before connect, else the current peer", () => {
    expect(remarkAddress("", "")).toBe("");
    expect(remarkAddress("tc:live", "")).toBe("tc:live");
    expect(remarkAddress("tc:live", "tc:draft")).toBe("tc:draft");
    expect(remarkAddress("tc:live", "nope")).toBe("tc:live");
    expect(labelPeerAddress(undefined, "tc:live")).toBe("tc:live");
    expect(labelPeerAddress("tc:other", "tc:live")).toBe("tc:other");
    expect(labelPeerAddress("nope", "tc:live")).toBe("tc:live");
  });
});
