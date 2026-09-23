import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { emitTrayNavigate, emitUpdateStatus, resetFakeUpdateState, updateCheckCount, type UpdateStatus } from "./lib/wails";

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
  resetFakeUpdateState();
});

afterEach(() => {
  cleanup();
  resetFakeUpdateState();
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

function status(partial: Partial<UpdateStatus>): UpdateStatus {
  return {
    CurrentVersion: "0.1.0-dev",
    LatestVersion: "0.2.0",
    LatestTag: "v0.2.0",
    UpdateAvailable: false,
    Notes: "Ships the cat.",
    ReleaseURL: "https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0",
    AssetName: "tailcat-box-macos-arm64-v0.2.0.zip",
    DownloadURL: "https://github.com/mushroom11s/tailcat-box/releases/download/v0.2.0/tailcat-box-macos-arm64-v0.2.0.zip",
    LastChecked: "2026-09-23T00:00:00.000Z",
    Status: "available",
    Error: "",
    DownloadedPath: "",
    ProgressPercent: 0,
    Platform: "darwin",
    ...partial,
  };
}

describe("in-app update", () => {
  it("shows NEW! when an update is available and opens the update card", async () => {
    const user = userEvent.setup();
    emitUpdateStatus(status({ UpdateAvailable: true }));
    renderApp();

    const badge = await screen.findByRole("button", { name: /NEW!/ });
    expect(badge.classList.contains("update-new")).toBe(true);

    await user.click(badge);
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    const card = document.getElementById("settings-update");
    expect(card?.classList.contains("update-focus")).toBe(true);
    expect(await screen.findByRole("button", { name: "Download" })).toBeTruthy();
    expect(screen.getByText("Ships the cat.")).toBeTruthy();
    expect(card?.textContent ?? "").not.toMatch(/GitHub Releases|does not replace the running app/);
  });

  it("does not show the phase-1 update explainer in zh-CN", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    renderApp();
    emitTrayNavigate("settings");
    const card = await waitFor(() => {
      const el = document.getElementById("settings-update");
      expect(el).toBeTruthy();
      return el;
    });
    const text = card?.textContent ?? "";
    expect(text).not.toContain("猫砂盆会到 GitHub Releases");
    expect(text).not.toContain("还不能一键替换正在运行的程序");
    expect(text).not.toContain("也不会自动重启");
  });

  it("renders release notes as sanitized markdown and opens https links", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const notes = [
      "## What's new",
      "",
      "- **Pixel** cats",
      "- See [the release](https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0)",
      "",
      "Use `meow`.",
      "",
      "<script>alert(1)</script>",
      "[bad](javascript:alert(1))",
    ].join("\n");
    emitUpdateStatus(status({ UpdateAvailable: true, Notes: notes }));
    renderApp();
    emitTrayNavigate("settings");

    const heading = await screen.findByRole("heading", { name: "What's new" });
    expect(heading.tagName).toBe("H2");
    expect(screen.getByText("Pixel").tagName).toBe("STRONG");
    const link = screen.getByRole("link", { name: "the release" });
    expect(link.getAttribute("href")).toContain("https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0");
    expect(screen.getByText("meow").tagName).toBe("CODE");

    const card = document.getElementById("settings-update");
    const html = card?.innerHTML ?? "";
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("javascript:");

    await user.click(link);
    expect(open).toHaveBeenCalledWith(
      "https://github.com/mushroom11s/tailcat-box/releases/tag/v0.2.0",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("hides NEW! until a successful check says an update is available", async () => {
    renderApp();
    expect(screen.queryByRole("button", { name: /NEW!/ })).toBeNull();

    emitUpdateStatus(status({ UpdateAvailable: true, Status: "error", Error: "network" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /NEW!/ })).toBeNull();
    });

    emitUpdateStatus(status({ UpdateAvailable: true, Status: "available", Error: "" }));
    expect(await screen.findByRole("button", { name: /NEW!/ })).toBeTruthy();
  });

  it("calls the update check when Check now is pressed", async () => {
    const user = userEvent.setup();
    renderApp();
    emitTrayNavigate("settings");
    const before = updateCheckCount();
    await user.click(await screen.findByRole("button", { name: "Check now" }));
    await waitFor(() => {
      expect(updateCheckCount()).toBe(before + 1);
    });
  });
});
