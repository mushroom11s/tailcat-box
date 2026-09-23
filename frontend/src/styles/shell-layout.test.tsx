import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "../App";
import { LocaleProvider } from "../i18n";
import { emitUpdateStatus, resetFakeUpdateState, type UpdateStatus } from "../lib/wails";
import css from "./glass.css?inline";

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetFakeUpdateState();
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
      const marginTop = parseFloat(metrics.marginTop);
      expect(marginLeft).toBeGreaterThanOrEqual(16);
      expect(marginLeft).toBeLessThanOrEqual(20);
      expect(marginRight).toBeGreaterThanOrEqual(8);
      expect(marginRight).toBeLessThanOrEqual(12);
      expect(marginTop).toBe(12);
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

  it("centers the brand stack in the sidebar", () => {
    const style = document.createElement("style");
    style.textContent = [
      cssBlock(css, ".brand"),
      cssBlock(css, ".brand-logo-row"),
      cssBlock(css, ".brand h1"),
      cssBlock(css, ".brand p"),
    ].join("\n");
    document.head.appendChild(style);

    try {
      localStorage.setItem("tailcat-locale", "en");
      render(
        <LocaleProvider>
          <App />
        </LocaleProvider>,
      );

      const brand = document.querySelector(".brand") as HTMLElement;
      const brandStyle = getComputedStyle(brand);
      expect(brandStyle.alignItems).toBe("center");
      expect(brandStyle.textAlign).toBe("center");
      expect(brandStyle.flexDirection).toBe("column");

      const row = document.querySelector(".brand-logo-row") as HTMLElement;
      expect(brand.contains(row)).toBe(true);
      expect(row.querySelector(".brand-mark")?.tagName).toBe("IMG");
      const rowStyle = getComputedStyle(row);
      expect(rowStyle.position).toBe("relative");
      expect(rowStyle.display).toBe("flex");
      expect(rowStyle.justifyContent).toBe("center");
      expect(rowStyle.alignItems).toBe("center");
      expect(rowStyle.width).toBe("fit-content");

      expect(getComputedStyle(brand.querySelector("h1") as HTMLElement).textAlign).toBe("center");
      expect(getComputedStyle(brand.querySelector("p") as HTMLElement).textAlign).toBe("center");
    } finally {
      style.remove();
    }
  });

  it("overlaps NEW! on the logo corner so the mark stays put", async () => {
    const style = document.createElement("style");
    style.textContent = [cssBlock(css, ".brand-logo-row"), cssBlock(css, ".update-new")].join("\n");
    document.head.appendChild(style);

    try {
      localStorage.setItem("tailcat-locale", "en");
      emitUpdateStatus(availableUpdate());
      render(
        <LocaleProvider>
          <App />
        </LocaleProvider>,
      );

      const badge = await screen.findByRole("button", { name: /NEW!/ });
      const row = document.querySelector(".brand-logo-row") as HTMLElement;
      const logo = row.querySelector(".brand-mark") as HTMLElement;
      expect(row.contains(badge)).toBe(true);
      expect(row.contains(logo)).toBe(true);

      const rowStyle = getComputedStyle(row);
      expect(rowStyle.position).toBe("relative");
      expect(rowStyle.justifyContent).toBe("center");

      const badgeStyle = getComputedStyle(badge);
      expect(badgeStyle.position).toBe("absolute");
      expect(badgeStyle.zIndex).toBe("1");
      expect(badgeStyle.marginTop).toBe("0px");
      expect(badgeStyle.marginBottom).toBe("0px");
      // Hangs off the top-right corner, still overlapping a 68px mark.
      expect(parseFloat(badgeStyle.top)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(badgeStyle.top)).toBeLessThan(34);
      const right = parseFloat(badgeStyle.right);
      expect(right).toBeLessThan(0);
      expect(right).toBeGreaterThan(-68);
      expect(logo.parentElement).toBe(row);
    } finally {
      style.remove();
    }
  });
});

function availableUpdate(): UpdateStatus {
  return {
    CurrentVersion: "0.1.0-dev",
    LatestVersion: "0.2.0",
    LatestTag: "v0.2.0",
    UpdateAvailable: true,
    Notes: "",
    ReleaseURL: "https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0",
    AssetName: "tailcat-box.zip",
    DownloadURL: "https://github.com/mushroom11s/tailcat-box/releases/download/v0.2.0/tailcat-box.zip",
    LastChecked: "2026-09-23T00:00:00.000Z",
    Status: "available",
    Error: "",
    DownloadedPath: "",
    ProgressPercent: 0,
    Platform: "darwin",
  };
}

function cssBlock(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`));
  if (!match) {
    throw new Error(`missing ${selector}`);
  }
  return match[0];
}
