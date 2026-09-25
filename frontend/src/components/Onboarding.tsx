import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";

const STEPS: Array<{ title: MessageKey; body: MessageKey }> = [
  { title: "onboardingStep1Title", body: "onboardingStep1Body" },
  { title: "onboardingStep2Title", body: "onboardingStep2Body" },
  { title: "onboardingStep3Title", body: "onboardingStep3Body" },
];

type Props = {
  open: boolean;
  onSkip: () => void;
  onDismiss: () => void;
};

export default function Onboarding({ open, onSkip, onDismiss }: Props) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) {
      setStep(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key === "Escape") {
        onSkip();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onSkip]);

  if (!open) {
    return null;
  }

  const current = STEPS[step] ?? STEPS[0];
  const last = step >= STEPS.length - 1;
  const progress = t("onboardingProgress").replace("{n}", String(step + 1)).replace("{total}", String(STEPS.length));

  return (
    <div className="modal-backdrop" role="presentation" onClick={onSkip}>
      <div
        className="glass modal onboarding"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <p className="chat-quiet onboarding-progress">{progress}</p>
        <h3 id="onboarding-title">{t(current.title)}</h3>
        <p>{t(current.body)}</p>
        <div className="row">
          {step > 0 ? (
            <button className="btn btn-ghost" type="button" onClick={() => setStep((n) => Math.max(0, n - 1))}>
              {t("onboardingBack")}
            </button>
          ) : null}
          {last ? (
            <button className="btn" type="button" onClick={onDismiss}>
              {t("onboardingDone")}
            </button>
          ) : (
            <button className="btn" type="button" onClick={() => setStep((n) => Math.min(STEPS.length - 1, n + 1))}>
              {t("onboardingNext")}
            </button>
          )}
          <button className="btn btn-ghost" type="button" onClick={onSkip}>
            {t("onboardingSkip")}
          </button>
          <button className="btn-link" type="button" onClick={onDismiss}>
            {t("onboardingDismiss")}
          </button>
        </div>
      </div>
    </div>
  );
}
