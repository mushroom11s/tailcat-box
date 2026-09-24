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
      // Horizontal nest is the list's shadow padding, not an extra margin that clips names.
      expect(marginLeft).toBe(0);
      expect(marginRight).toBe(0);
      expect(marginTop).toBe(12);
      expect(rooms.contains(chat)).toBe(false);

      await user.click(document.querySelector(".nav-chat > .nav-btn") as HTMLElement);
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

  it("scrolls only the room rows and hides that scrollbar", async () => {
    const listRule = cssBlock(css, ".nav-room-list");
    expect(listRule).toContain("overflow-y: auto");
    expect(listRule).toContain("min-height: 0");
    expect(listRule).toContain("scrollbar-width: none");
    expect(listRule).toContain("-ms-overflow-style: none");
    const webkit = cssBlock(css, ".nav-room-list::-webkit-scrollbar");
    expect(webkit).toContain("display: none");
    expect(webkit).toContain("width: 0");
    expect(webkit).toContain("height: 0");
    expect(cssBlock(css, ".sidebar")).toContain("overflow: hidden");
    expect(cssBlock(css, ".nav")).toContain("min-height: 0");
    expect(cssBlock(css, ".nav-chat")).toContain("min-height: 0");
    expect(cssBlock(css, ".nav-rooms")).toContain("overflow: hidden");
    expect(cssBlock(css, ".brand")).toContain("flex-shrink: 0");
    expect(cssBlock(css, ".sidebar-footer")).toContain("flex-shrink: 0");
    expect(cssBlock(css, ".nav-btn")).toContain("flex-shrink: 0");

    const style = document.createElement("style");
    style.textContent = [
      cssBlock(css, ".nav-rooms"),
      cssBlock(css, ".nav-room-list"),
      cssBlock(css, ".nav-room-list::-webkit-scrollbar"),
    ].join("\n");
    document.head.appendChild(style);

    try {
      localStorage.setItem("tailcat-locale", "en");
      const user = userEvent.setup();
      render(
        <LocaleProvider>
          <App />
        </LocaleProvider>,
      );

      await user.click(document.querySelector(".nav-chat > .nav-btn") as HTMLElement);
      await user.click(screen.getByRole("button", { name: "Create temporary room" }));
      const list = document.querySelector(".nav-room-list") as HTMLElement;
      const rooms = document.querySelector(".nav-rooms") as HTMLElement;
      const room = document.querySelector(".nav-room-row") as HTMLElement;
      const fresh = screen.getByRole("button", { name: "+ New room" });
      const chat = screen.getByRole("button", { name: "Chat" });
      const tunnel = screen.getByRole("button", { name: "Tunnel" });
      const settings = screen.getByRole("button", { name: "Settings" });
      const brand = document.querySelector(".brand") as HTMLElement;
      const footer = document.querySelector(".sidebar-footer") as HTMLElement;

      expect(rooms.contains(list)).toBe(true);
      expect(rooms.contains(fresh)).toBe(true);
      expect(list.contains(room)).toBe(true);
      expect(list.contains(fresh)).toBe(false);
      expect(list.contains(chat)).toBe(false);
      expect(list.contains(tunnel)).toBe(false);
      expect(list.contains(settings)).toBe(false);
      expect(list.contains(brand)).toBe(false);
      expect(footer.contains(settings)).toBe(true);
      expect(document.querySelector(".sidebar")?.contains(tunnel)).toBe(true);

      const listStyle = getComputedStyle(list);
      expect(listStyle.overflowY).toBe("auto");
      expect(listStyle.overflowX).toBe("hidden");
      expect(parseFloat(listStyle.minHeight)).toBe(0);
      // happy-dom does not compute scrollbar-width; the stylesheet text above is the contract.
    } finally {
      style.remove();
    }
  });

  it("pins top-level menu icons left and centers labels separately", () => {
    const menuRule = css.match(
      /\.nav > \.nav-btn,\s*\.nav-chat > \.nav-btn,\s*\.sidebar-footer > \.nav-btn\s*\{[^}]*\}/,
    );
    expect(menuRule?.[0]).toContain("position: relative");
    expect(menuRule?.[0]).toContain("justify-content: flex-start");
    expect(menuRule?.[0]).toContain("width: 100%");
    expect(menuRule?.[0]).not.toContain("justify-content: center");
    expect(menuRule?.[0]).not.toContain("text-align: center");

    const glyphRule = css.match(
      /\.nav > \.nav-btn > \.nav-glyph,\s*\.nav-chat > \.nav-btn > \.nav-glyph,\s*\.sidebar-footer > \.nav-btn > \.nav-glyph\s*\{[^}]*\}/,
    );
    expect(glyphRule?.[0]).toContain("position: absolute");
    expect(glyphRule?.[0]).toContain("left: 12px");
    expect(glyphRule?.[0]).toContain("top: 50%");
    expect(glyphRule?.[0]).toContain("transform: translateY(-50%)");

    const labelRule = css.match(
      /\.nav > \.nav-btn > \.nav-label,\s*\.nav-chat > \.nav-btn > \.nav-label,\s*\.sidebar-footer > \.nav-btn > \.nav-label\s*\{[^}]*\}/,
    );
    expect(labelRule?.[0]).toContain("width: 100%");
    expect(labelRule?.[0]).toContain("text-align: center");
    expect(cssBlock(css, ".nav-btn")).toContain("padding: 10px 12px");
    expect(cssBlock(css, ".nav-btn")).toContain("text-align: left");
    expect(cssBlock(css, ".nav-btn.nav-child")).not.toContain("justify-content: center");

    const style = document.createElement("style");
    style.textContent = [
      cssBlock(css, ".nav-btn"),
      menuRule?.[0] ?? "",
      glyphRule?.[0] ?? "",
      labelRule?.[0] ?? "",
      cssBlock(css, ".nav-glyph"),
      cssBlock(css, ".nav-btn.nav-child"),
    ].join("\n");
    document.head.appendChild(style);

    try {
      localStorage.setItem("tailcat-locale", "zh-CN");
      render(
        <LocaleProvider>
          <App />
        </LocaleProvider>,
      );

      const miao = screen.getByRole("button", { name: "喵传" });
      expect(miao.classList.contains("active")).toBe(true);
      expect(document.querySelector(".miao-page")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "喵传" })).toBeTruthy();
      expect(document.querySelector(".chat-lobby")).toBeNull();

      for (const name of ["喵传", "聊天", "穿透", "设置"]) {
        const button = screen.getByRole("button", { name });
        const glyph = button.querySelector(".nav-glyph") as HTMLElement;
        const label = button.querySelector(".nav-label") as HTMLElement;
        const buttonStyle = getComputedStyle(button);
        const glyphStyle = getComputedStyle(glyph);
        const labelStyle = getComputedStyle(label);
        expect(buttonStyle.justifyContent).toBe("flex-start");
        expect(buttonStyle.textAlign).toBe("left");
        expect(buttonStyle.position).toBe("relative");
        expect(buttonStyle.width).not.toBe("auto");
        expect(buttonStyle.display).toBe("flex");
        expect(buttonStyle.paddingLeft).toBe("12px");
        expect(glyphStyle.position).toBe("absolute");
        expect(glyphStyle.left).toBe("12px");
        expect(label.textContent).toBe(name);
        expect(labelStyle.textAlign).toBe("center");
        expect(labelStyle.width).not.toBe("auto");
        expect(labelStyle.position).not.toBe("absolute");
      }

      const fresh = screen.getByRole("button", { name: "+ 新房间" });
      expect(fresh.querySelector(".nav-glyph")).toBeNull();
      expect(fresh.querySelector(".nav-label")).toBeNull();
      expect(getComputedStyle(fresh).justifyContent).not.toBe("center");
      expect(getComputedStyle(fresh).textAlign).toBe("left");
      expect(getComputedStyle(fresh).position).not.toBe("relative");
    } finally {
      style.remove();
    }
  });

  it("gives sidebar menu buttons and room rows vertical breathing room", () => {
    const navRule = cssBlock(css, ".nav");
    expect(navRule).toContain("gap: 8px");
    expect(navRule).toContain("padding-left: 8px");
    expect(navRule).toContain("padding-right: 8px");
    expect(cssBlock(css, ".nav-rooms")).toContain("gap: 0");
    expect(cssBlock(css, ".nav-room-list")).toContain("gap: 8px");
    expect(cssBlock(css, ".nav-room-list")).toContain("padding: 8px 8px 16px");
    const active = cssBlock(css, ".nav-btn.active");
    expect(active).toContain("0 0 0 1px");
    expect(active).toContain("0 4px 10px");
    expect(active).not.toContain("0 10px 24px");
    expect(cssBlock(css, ":root")).toContain("--sidebar-w: 260px");
  });

  it("widens the sidebar and insets the active pill inside the clip", () => {
    expect(cssBlock(css, ":root")).toContain("--sidebar-w: 260px");
    expect(cssBlock(css, ".shell")).toContain("grid-template-columns: var(--sidebar-w) minmax(0, 1fr)");
    const navRule = cssBlock(css, ".nav");
    expect(navRule).toContain("padding-left: 8px");
    expect(navRule).toContain("padding-right: 8px");
    expect(navRule).toContain("overflow: hidden");
    const chatRule = cssBlock(css, ".nav-chat");
    expect(chatRule).toContain("padding-top: 8px");
    expect(chatRule).toContain("padding-left: 8px");
    expect(chatRule).toContain("padding-right: 8px");
    expect(chatRule).toContain("margin-top: -8px");
    expect(chatRule).toContain("margin-left: -8px");
    expect(chatRule).toContain("margin-right: -8px");
    expect(chatRule).toContain("overflow: hidden");
    expect(navRule).toContain("padding-top: 8px");
    expect(navRule).toContain("padding-bottom: 8px");
    const listRule = cssBlock(css, ".nav-room-list");
    expect(listRule).toContain("padding: 8px 8px 16px");
    expect(listRule).toContain("min-width: 0");
    expect(listRule).toContain("overflow-x: hidden");
    expect(cssBlock(css, ".nav-room-label")).toContain("min-width: 0");
    expect(cssBlock(css, ".nav-room-label")).toContain("flex: 1 1 0%");
    expect(cssBlock(css, ".nav-room-label")).toContain("width: 100%");
    const nameRule = css.match(/\.nav-room-primary,\s*\.nav-room-key\s*\{[^}]*\}/);
    expect(nameRule?.[0]).toContain("min-width: 0");
    expect(nameRule?.[0]).toContain("max-width: 100%");
    expect(nameRule?.[0]).toContain("text-overflow: ellipsis");
    expect(nameRule?.[0]).toContain("white-space: nowrap");
    const footerRule = cssBlock(css, ".sidebar-footer");
    expect(footerRule).toContain("padding-left: 8px");
    expect(footerRule).toContain("padding-right: 8px");
    expect(cssBlock(css, ".sidebar")).toContain("overflow: hidden");

    const style = document.createElement("style");
    style.textContent = [navRule, chatRule, footerRule, cssBlock(css, ".sidebar")].join("\n");
    document.head.appendChild(style);
    try {
      localStorage.setItem("tailcat-locale", "zh-CN");
      render(
        <LocaleProvider>
          <App />
        </LocaleProvider>,
      );
      const nav = document.querySelector(".nav") as HTMLElement;
      const chat = document.querySelector(".nav-chat") as HTMLElement;
      const footer = document.querySelector(".sidebar-footer") as HTMLElement;
      expect(getComputedStyle(nav).paddingTop).toBe("8px");
      expect(getComputedStyle(nav).paddingBottom).toBe("8px");
      expect(getComputedStyle(nav).paddingLeft).toBe("8px");
      expect(getComputedStyle(nav).paddingRight).toBe("8px");
      expect(getComputedStyle(chat).paddingTop).toBe("8px");
      expect(getComputedStyle(chat).paddingLeft).toBe("8px");
      expect(getComputedStyle(chat).paddingRight).toBe("8px");
      expect(getComputedStyle(chat).marginTop).toBe("-8px");
      expect(getComputedStyle(chat).marginLeft).toBe("-8px");
      expect(getComputedStyle(chat).marginRight).toBe("-8px");
      expect(getComputedStyle(footer).paddingTop).toBe("8px");
      expect(getComputedStyle(footer).paddingLeft).toBe("8px");
      expect(getComputedStyle(footer).paddingRight).toBe("8px");
      expect(screen.getByRole("button", { name: "喵传" }).classList.contains("active")).toBe(true);
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
