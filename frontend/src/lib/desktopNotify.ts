export const DESKTOP_NOTIFY_KEY = "tailcat-desktop-notify";

export const PEER_NOTIFY_WINDOW_MS = 8000;
export const MIAO_NOTIFY_WINDOW_MS = 24 * 60 * 60 * 1000;

const recent = new Map<string, number>();

export function resetDesktopNotifyCoalesceForTests(): void {
  recent.clear();
}

// readDesktopNotifications defaults to on until the user turns the setting off.
export function readDesktopNotifications(): boolean {
  try {
    const raw = localStorage.getItem(DESKTOP_NOTIFY_KEY);
    return raw !== "0";
  } catch {
    return true;
  }
}

export function writeDesktopNotifications(enabled: boolean): void {
  localStorage.setItem(DESKTOP_NOTIFY_KEY, enabled ? "1" : "0");
}

export function appInBackground(doc: { hasFocus: () => boolean; visibilityState: string }): boolean {
  if (doc.visibilityState === "hidden") {
    return true;
  }
  try {
    return !doc.hasFocus();
  } catch {
    return true;
  }
}

// claimNotifySlot returns true the first time key is seen inside windowMs.
export function claimNotifySlot(key: string, now = Date.now(), windowMs = PEER_NOTIFY_WINDOW_MS): boolean {
  const prev = recent.get(key);
  if (prev !== undefined && now - prev < windowMs) {
    return false;
  }
  recent.set(key, now);
  return true;
}
