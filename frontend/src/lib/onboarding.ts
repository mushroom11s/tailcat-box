export const ONBOARDING_SEEN_KEY = "tailcat-onboarding-seen";

// shouldAutoShowOnboarding is true on a real first launch.
// Tests leave the key empty, which stays quiet; "0" forces the guide open.
export function shouldAutoShowOnboarding(mode = import.meta.env.MODE): boolean {
  let raw = "";
  try {
    raw = localStorage.getItem(ONBOARDING_SEEN_KEY) ?? "";
  } catch {
    return false;
  }
  if (raw === "1") {
    return false;
  }
  if (raw === "0") {
    return true;
  }
  return mode !== "test";
}

export function writeOnboardingSeen(): void {
  localStorage.setItem(ONBOARDING_SEEN_KEY, "1");
}
