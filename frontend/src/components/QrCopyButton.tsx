import type { MouseEvent } from "react";
import { useI18n } from "../i18n";

type Props = {
  disabled?: boolean;
  onClick: (ev: MouseEvent<HTMLButtonElement>) => void;
};

/** Compact copy control that sits with a QR image, not in the main action row. */
export default function QrCopyButton({ disabled = false, onClick }: Props) {
  const { t } = useI18n();
  return (
    <button className="qr-copy" type="button" disabled={disabled} title={t("copy")} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"
        />
      </svg>
      <span>{t("copy")}</span>
    </button>
  );
}
