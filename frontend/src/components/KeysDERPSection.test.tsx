import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "../i18n";
import css from "../styles/glass.css?inline";
import KeysDERPSection from "./KeysDERPSection";

const longLabel = `tc:${"W".repeat(180)} · home`;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderSection(): void {
  localStorage.setItem("tailcat-locale", "en");
  render(
    <LocaleProvider>
      <KeysDERPSection
        keys={[]}
        busy={false}
        error=""
        region=""
        derpMapURL=""
        roomKey=""
        appliedKey=""
        appliedRegion=""
        appliedDERP=""
        onRoomKey={() => undefined}
        onCreate={() => undefined}
        onDelete={() => undefined}
        onSaveNetwork={() => undefined}
        onRestart={() => undefined}
        canRestart
        restartLabel={longLabel}
      />
    </LocaleProvider>,
  );
}

describe("restart target hint", () => {
  it("keeps the sentence short and ellipsizes the room identity", () => {
    const style = document.createElement("style");
    style.textContent = [
      ":root { --mono: ui-monospace, Menlo, monospace; }",
      cssBlock(css, ".restart-target"),
      cssBlock(css, ".restart-target-label"),
    ].join("\n");
    document.head.appendChild(style);
    try {
      renderSection();
      expect(screen.getByText("Restarts this room only:")).toBeTruthy();
      expect(screen.getByText("Other rooms stay connected.")).toBeTruthy();
      const label = document.querySelector(".restart-target-label") as HTMLElement;
      expect(label.textContent).toBe(longLabel);
      expect(label.getAttribute("title")).toBe(longLabel);
      expect(label.parentElement?.classList.contains("restart-target")).toBe(true);
      const computed = getComputedStyle(label);
      expect(computed.overflow).toBe("hidden");
      expect(computed.textOverflow).toBe("ellipsis");
      expect(computed.whiteSpace).toBe("nowrap");
      expect(computed.minWidth).toBe("0");
      expect(computed.maxWidth).toBe("100%");
      expect(computed.fontFamily.toLowerCase()).toContain("monospace");
      const target = getComputedStyle(label.parentElement as HTMLElement);
      expect(target.display).toBe("flex");
      expect(target.flexDirection).toBe("column");
      expect(target.minWidth).toBe("0");
      expect(target.maxWidth).toBe("100%");
    } finally {
      style.remove();
    }
  });
});

function cssBlock(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
  if (!match) {
    throw new Error(`missing ${selector}`);
  }
  return match[0];
}
