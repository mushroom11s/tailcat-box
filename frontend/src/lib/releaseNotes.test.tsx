import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ReleaseNotes from "../components/ReleaseNotes";

describe("release notes markdown", () => {
  it("renders common GitHub release markdown", () => {
    const { container } = render(
      <ReleaseNotes
        markdown={[
          "## What's new",
          "",
          "- **Pixel** cats and *glass*",
          "- See [the release](https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0)",
          "",
          "Use `meow`.",
          "",
          "```",
          "tailcat-box",
          "```",
          "",
          "> quiet note",
          "",
          "- [x] shipped",
          "",
          "Line one",
          "Line two",
        ].join("\n")}
      />,
    );
    expect(screen.getByRole("heading", { name: "What's new" }).tagName).toBe("H2");
    expect(screen.getByText("Pixel").tagName).toBe("STRONG");
    expect(screen.getByText("glass").tagName).toBe("EM");
    const link = screen.getByRole("link", { name: "the release" });
    expect(link.getAttribute("href")).toBe("https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("meow").tagName).toBe("CODE");
    expect(container.querySelector("pre code")?.textContent).toContain("tailcat-box");
    expect(container.querySelector("blockquote")?.textContent).toContain("quiet note");
    const box = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(box?.disabled).toBe(true);
    expect(box?.checked).toBe(true);
    expect(container.querySelector("br")).toBeTruthy();
  });

  it("does not render raw HTML, event handlers, or unsafe URLs", () => {
    const { container } = render(
      <ReleaseNotes
        markdown={[
          "<script>alert(1)</script>",
          '<img src="x" onerror="alert(1)">',
          "[bad](javascript:alert(1))",
          "![pixel](data:image/svg+xml;base64,PHN2Zy8+)",
          "[ok](https://example.com/notes)",
          "![shot](https://example.com/cat.png)",
        ].join("\n\n")}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML.toLowerCase()).not.toContain("<script");
    expect(container.innerHTML.toLowerCase()).not.toContain("onerror");
    expect(container.innerHTML.toLowerCase()).not.toContain("javascript:");
    expect(container.innerHTML.toLowerCase()).not.toContain("data:image");
    expect(screen.getByRole("link", { name: "ok" }).getAttribute("href")).toBe("https://example.com/notes");
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.com/cat.png");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
  });

  it("opens https links outside the webview", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<ReleaseNotes markdown="[notes](https://example.com/notes)" />);
    await user.click(screen.getByRole("link", { name: "notes" }));
    expect(open).toHaveBeenCalledWith("https://example.com/notes", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});