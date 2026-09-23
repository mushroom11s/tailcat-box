import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { emitTrayNavigate, TRAY_NAVIGATE_EVENT } from "./lib/wails";

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

describe("tray navigation", () => {
  it("opens Chat, Tunnel, or Settings when the tray event fires", async () => {
    expect(TRAY_NAVIGATE_EVENT).toBe("tailcat:navigate");
    renderApp();
    expect(document.querySelector(".chat-page")).toBeTruthy();

    emitTrayNavigate("settings");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();

    emitTrayNavigate("tunnel");
    expect(await screen.findByRole("heading", { name: "Tunnel" })).toBeTruthy();

    emitTrayNavigate("chat");
    await waitFor(() => {
      expect(document.querySelector(".chat-page")).toBeTruthy();
    });

    emitTrayNavigate("nope");
    expect(document.querySelector(".chat-page")).toBeTruthy();
  });
});
