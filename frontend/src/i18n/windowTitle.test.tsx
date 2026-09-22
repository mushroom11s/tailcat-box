import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider, useI18n } from "./LocaleProvider";
import { WINDOW_TITLE } from "./windowTitle";

function Brand() {
  const { t, setLocale } = useI18n();
  return (
    <>
      <h1>{t("productName")}</h1>
      <button type="button" onClick={() => setLocale("zh-CN")}>
        zh
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.title = "";
});

describe("window title", () => {
  it("keeps the document title in English while the brand localizes", async () => {
    localStorage.setItem("tailcat-locale", "en");
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <Brand />
      </LocaleProvider>,
    );

    expect(document.title).toBe(WINDOW_TITLE);
    expect(screen.getByRole("heading", { name: "Tailcat Box" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "zh" }));

    expect(document.title).toBe("Tailcat Box");
    expect(screen.getByRole("heading", { name: "猫砂盆" })).toBeTruthy();
  });
});
