import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { ONBOARDING_SEEN_KEY } from "./lib/onboarding";

afterEach(() => {
  cleanup();
  localStorage.removeItem(ONBOARDING_SEEN_KEY);
  localStorage.removeItem("tailcat-locale");
});

function renderApp() {
  return render(
    <LocaleProvider>
      <App />
    </LocaleProvider>,
  );
}

describe("first-run onboarding", () => {
  it("walks three steps, and Skip leaves it for the next launch", async () => {
    localStorage.setItem("tailcat-locale", "en");
    localStorage.setItem(ONBOARDING_SEEN_KEY, "0");
    const user = userEvent.setup();
    const view = renderApp();
    const dialog = await screen.findByRole("dialog", { name: "Share your address" });
    expect(dialog.textContent).toContain("1 / 3");
    expect(dialog.textContent).not.toMatch(/DERP/i);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Join or create a room" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: "Mew Share pickup codes" }).textContent).toContain("pickup code");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Join or create a room" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(ONBOARDING_SEEN_KEY)).toBe("0");
    view.unmount();
    renderApp();
    expect(await screen.findByRole("dialog", { name: "Share your address" })).toBeTruthy();
  });

  it("hides for good after Don't show again, and Settings can open it again", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    localStorage.setItem(ONBOARDING_SEEN_KEY, "0");
    const user = userEvent.setup();
    const view = renderApp();
    expect((await screen.findByRole("dialog")).textContent).toContain("把我的地址发给对方");
    await user.click(screen.getByRole("button", { name: "不再显示" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(ONBOARDING_SEEN_KEY)).toBe("1");
    view.unmount();
    renderApp();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "使用引导" }));
    expect(screen.getByRole("dialog", { name: "把我的地址发给对方" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("dialog").textContent).toContain("取件码");
    await user.click(screen.getByRole("button", { name: "知道了" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
