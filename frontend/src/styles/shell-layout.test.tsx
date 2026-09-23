import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "../App";
import { LocaleProvider } from "../i18n";
import css from "./glass.css?inline";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("shell scroll", () => {
  it("resets the main pane when switching pages", async () => {
    localStorage.setItem("tailcat-locale", "en");
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );

    const shell = document.querySelector(".shell") as HTMLElement;
    const main = document.querySelector("main.main") as HTMLElement;
    expect(shell.contains(main)).toBe(true);

    main.scrollTop = 240;
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(main.scrollTop).toBe(0);

    main.scrollTop = 180;
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    expect(screen.getByRole("heading", { name: "Tunnel" })).toBeTruthy();
    expect(main.scrollTop).toBe(0);

    main.scrollTop = 90;
    await user.click(screen.getByRole("button", { name: "Chat" }));
    expect(document.querySelector(".chat-lobby")).toBeTruthy();
    expect(main.scrollTop).toBe(0);
  });

  it("nests room rows narrower than the Chat button", async () => {
    const style = document.createElement("style");
    style.textContent = `${cssBlock(css, ".nav-rooms")}\n${cssBlock(css, ".nav-btn.nav-child")}`;
    document.head.appendChild(style);

    try {
      localStorage.setItem("tailcat-locale", "en");
      const user = userEvent.setup();
      render(
        <LocaleProvider>
          <App />
        </LocaleProvider>,
      );

      const rooms = document.querySelector(".nav-rooms") as HTMLElement;
      const chat = screen.getByRole("button", { name: "Chat" });
      const metrics = getComputedStyle(rooms);
      const marginLeft = parseFloat(metrics.marginLeft);
      const marginRight = parseFloat(metrics.marginRight);
      expect(marginLeft).toBeGreaterThanOrEqual(16);
      expect(marginLeft).toBeLessThanOrEqual(20);
      expect(marginRight).toBeGreaterThanOrEqual(8);
      expect(marginRight).toBeLessThanOrEqual(12);
      expect(rooms.contains(chat)).toBe(false);

      await user.click(screen.getByRole("button", { name: "Create temporary room" }));
      const room = document.querySelector(".nav-btn.nav-child:not(.nav-new)") as HTMLElement;
      const fresh = screen.getByRole("button", { name: "+ New room" });
      expect(rooms.contains(room)).toBe(true);
      expect(rooms.contains(fresh)).toBe(true);
      for (const child of [room, fresh]) {
        const childStyle = getComputedStyle(child);
        expect(childStyle.fontSize).toBe("13px");
        expect(childStyle.paddingTop).toBe("8px");
        expect(childStyle.paddingRight).toBe("10px");
      }
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
