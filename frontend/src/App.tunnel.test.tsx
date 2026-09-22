import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
});

describe("tunnel page", () => {
  it("serves a port and keeps SSH and exit-node off the sidebar", async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Tunnel" }));
    expect(screen.getByRole("heading", { name: "Tunnel" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Port serve" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Local forward" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Browse" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start SSH serve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start exit node" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Start port serve" }));
    await waitFor(() => {
      expect(screen.getByText(/tc:fake-port-/)).toBeTruthy();
    });
  });

  it("uses 穿透 in zh-CN", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "穿透" }));
    expect(screen.getByRole("heading", { name: "穿透" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始端口监听" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始转发" })).toBeTruthy();
  });
});
