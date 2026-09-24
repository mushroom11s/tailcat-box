import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";
import css from "../styles/glass.css?inline";
import { ERROR_TOAST_MS, ToastProvider, useToasts } from "./toasts";

function Probe() {
  const { push } = useToasts();
  return (
    <>
      <button type="button" onClick={() => push('fetching DERPMap for region -1: Get "https://tailcat.dev/derpmap.json": EOF')}>
        push error
      </button>
      <button type="button" onClick={() => push("saved locally", "warn")}>
        push warn
      </button>
    </>
  );
}

function renderToasts() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <Probe />
      </ToastProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
  const style = document.createElement("style");
  style.setAttribute("data-toast-test", "1");
  style.textContent = css;
  document.head.appendChild(style);
});

afterEach(() => {
  cleanup();
  document.querySelector("[data-toast-test]")?.remove();
  vi.useRealTimers();
});

describe("toast stack", () => {
  it("renders an error toast with role=alert in the top-right container", () => {
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push error" }));

    const stack = document.querySelector(".toast-stack") as HTMLElement;
    expect(stack).toBeTruthy();
    expect(stack.parentElement).toBe(document.body);
    const alert = stack.querySelector("[role=alert]") as HTMLElement;
    expect(alert).toBeTruthy();
    expect(alert.classList.contains("toast-error")).toBe(true);
    expect(alert.querySelector(".toast-badge")?.textContent?.trim()).toBe("!");
    expect(alert.querySelector(".toast-label")?.textContent).toBe("Error");
    expect(alert.querySelector(".toast-message")?.textContent).toContain("derpmap.json");

    const style = getComputedStyle(stack);
    expect(style.position).toBe("fixed");
    expect(style.top).toBe("16px");
    expect(style.right).toBe("16px");
    expect(Number.parseInt(style.zIndex, 10)).toBeGreaterThan(40);
    expect(style.pointerEvents).toBe("none");
    const rule = document.querySelector("[data-toast-test]")?.textContent ?? "";
    const stackRule = rule.slice(rule.indexOf(".toast-stack"));
    expect(stackRule.startsWith(".toast-stack")).toBe(true);
    expect(stackRule).toContain("width: min(372px, calc(100vw - 32px))");
    expect(stackRule).toContain("border-radius: 14px");
    expect(stackRule).toContain("background: var(--glass-bg-strong)");
    expect(stackRule).toContain("right: 16px");
    expect(getComputedStyle(alert).pointerEvents).toBe("auto");
  });

  it("auto-dismisses an error toast and pauses the timer while hovered", () => {
    vi.useFakeTimers();
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push error" }));
    const alert = screen.getByRole("alert");
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(ERROR_TOAST_MS - 1000);
    });
    expect(screen.getByRole("alert")).toBe(alert);

    fireEvent.mouseEnter(alert);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("alert")).toBe(alert);

    fireEvent.mouseLeave(alert);
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByRole("alert")).toBe(alert);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a warn toast with the softer label", () => {
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push warn" }));
    const alert = screen.getByRole("alert");
    expect(alert.classList.contains("toast-warn")).toBe(true);
    expect(alert.querySelector(".toast-label")?.textContent).toBe("Warning");
    expect(alert.querySelector(".toast-message")?.textContent).toBe("saved locally");
  });

  it("uses 关闭 for the dismiss control in zh-CN", () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    renderToasts();
    fireEvent.click(screen.getByRole("button", { name: "push error" }));
    expect(screen.getByText("错误")).toBeTruthy();
    expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
