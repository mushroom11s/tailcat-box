import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import { ONBOARDING_SEEN_KEY, shouldAutoShowOnboarding, writeOnboardingSeen } from "./onboarding";

describe("first-run onboarding flag", () => {
  it("shows on a real first launch and stays quiet after dismiss", () => {
    localStorage.removeItem(ONBOARDING_SEEN_KEY);
    expect(shouldAutoShowOnboarding("production")).toBe(true);
    expect(shouldAutoShowOnboarding("test")).toBe(false);
    localStorage.setItem(ONBOARDING_SEEN_KEY, "0");
    expect(shouldAutoShowOnboarding("test")).toBe(true);
    writeOnboardingSeen();
    expect(shouldAutoShowOnboarding("production")).toBe(false);
    expect(translate("zh-CN", "onboardingOpen")).toBe("使用引导");
    expect(translate("en", "onboardingDismiss")).toBe("Don't show again");
    expect(translate("zh-CN", "onboardingStep1Body")).not.toMatch(/DERP/i);
    expect(translate("en", "onboardingStep3Body")).not.toMatch(/DERP/i);
  });
});
