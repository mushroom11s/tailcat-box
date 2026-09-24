import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import {
  DESKTOP_NOTIFY_KEY,
  MIAO_NOTIFY_WINDOW_MS,
  appInBackground,
  claimNotifySlot,
  readDesktopNotifications,
  resetDesktopNotifyCoalesceForTests,
  writeDesktopNotifications,
} from "./desktopNotify";

describe("desktop notification preference", () => {
  it("defaults on and remembers an explicit off", () => {
    localStorage.removeItem(DESKTOP_NOTIFY_KEY);
    expect(readDesktopNotifications()).toBe(true);
    writeDesktopNotifications(false);
    expect(readDesktopNotifications()).toBe(false);
    writeDesktopNotifications(true);
    expect(localStorage.getItem(DESKTOP_NOTIFY_KEY)).toBe("1");
    expect(translate("en", "desktopNotifications")).toBe("Desktop notifications");
    expect(translate("zh-CN", "desktopNotifications")).toBe("桌面通知");
    expect(translate("zh-CN", "notifyPeerJoined")).toContain("{peer}");
    expect(translate("en", "notifyMiaoDone")).toContain("{name}");
  });
});

describe("background and coalesce", () => {
  it("treats a hidden or unfocused window as background", () => {
    expect(appInBackground({ hasFocus: () => true, visibilityState: "hidden" })).toBe(true);
    expect(appInBackground({ hasFocus: () => false, visibilityState: "visible" })).toBe(true);
    expect(appInBackground({ hasFocus: () => true, visibilityState: "visible" })).toBe(false);
    expect(appInBackground({ hasFocus: () => { throw new Error("no"); }, visibilityState: "visible" })).toBe(true);
  });

  it("coalesces the same key inside the window and allows a later one", () => {
    resetDesktopNotifyCoalesceForTests();
    expect(claimNotifySlot("peer:room:tc", 1_000, 8_000)).toBe(true);
    expect(claimNotifySlot("peer:room:tc", 2_000, 8_000)).toBe(false);
    expect(claimNotifySlot("peer:room:tc", 9_000, 8_000)).toBe(true);
    expect(claimNotifySlot("miao-start:job", 0, MIAO_NOTIFY_WINDOW_MS)).toBe(true);
    expect(claimNotifySlot("miao-start:job", 5_000, MIAO_NOTIFY_WINDOW_MS)).toBe(false);
    expect(claimNotifySlot("miao-done:job", 5_000, MIAO_NOTIFY_WINDOW_MS)).toBe(true);
  });
});
