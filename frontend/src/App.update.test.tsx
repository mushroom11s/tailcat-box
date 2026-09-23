import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
