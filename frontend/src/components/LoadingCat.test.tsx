import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LoadingCat from "./LoadingCat";

afterEach(() => {
  cleanup();
});

describe("LoadingCat", () => {
  it("renders the mascot and an optional label", () => {
    render(<LoadingCat label="Packing…" />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Packing…");
    const img = status.querySelector("img");
    expect(img?.getAttribute("src") ?? "").toContain("loading-cat");
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("uses the small gif when size is sm", () => {
    render(<LoadingCat size="sm" label="Working…" />);
    expect(screen.getByRole("status").querySelector("img")?.getAttribute("src") ?? "").toContain("loading-cat-sm");
  });
});
