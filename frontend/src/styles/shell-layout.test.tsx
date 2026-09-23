import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "../App";
import { LocaleProvider } from "../i18n";

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
});
