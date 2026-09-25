import { useRef, useState } from "react";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { useI18n } from "../i18n";
import { copyQrImage } from "../lib/copyQrImage";
import { encodeQrDataURL } from "../lib/qr";
import { useToasts } from "./toasts";
import QrDialog from "./QrDialog";

type Props = {
  value: string;
  disabled?: boolean;
  /** PNG data URL or image URL baked into the QR bitmap. */
  centerMark?: string;
};

async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the desktop clipboard
  }
  try {
    await ClipboardSetText(text);
  } catch {
    // ignore copy failures in environments without a clipboard
  }
}

export default function QrShareButton({ value, disabled = false, centerMark }: Props) {
  const { t } = useI18n();
  const { push, note } = useToasts();
  const text = value.trim();
  const [open, setOpen] = useState(false);
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [copyNote, setCopyNote] = useState("");
  const [copyError, setCopyError] = useState("");
  const ticket = useRef(0);

  async function openDialog(): Promise<void> {
    if (!text) {
      return;
    }
    const id = ++ticket.current;
    setOpen(true);
    setSrc("");
    setFailed(false);
    setCopyNote("");
    setCopyError("");
    try {
      const url = await encodeQrDataURL(text, centerMark ? { centerMark } : undefined);
      if (id === ticket.current) {
        setSrc(url);
      }
    } catch {
      if (id === ticket.current) {
        setFailed(true);
      }
    }
  }

  async function copyImage(): Promise<void> {
    if (!src) {
      return;
    }
    setCopyNote("");
    setCopyError("");
    try {
      await copyQrImage(src);
      setCopyNote(t("qrCopied"));
      note(t("qrCopied"));
    } catch {
      setCopyError(t("qrCopyFailed"));
      push(t("qrCopyFailed"));
    }
  }

  return (
    <>
      <button
        className="btn btn-ghost"
        type="button"
        disabled={disabled || !text}
        aria-label={t("qrShowLabel")}
        onClick={(ev) => {
          ev.stopPropagation();
          void openDialog();
        }}
      >
        {t("qrShow")}
      </button>
      {open ? (
        <QrDialog titleId="qr-share-title" title={t("qrTitle")} onClose={() => setOpen(false)}>
          {failed ? <p className="err">{t("qrEncodeFailed")}</p> : null}
          {src ? (
            <div className="qr-modal-figure">
              <img src={src} alt={text} width={240} height={240} />
            </div>
          ) : null}
          <code className="qr-payload">{text}</code>
          {copyNote ? <p className="chat-quiet" role="status">{copyNote}</p> : null}
          {copyError ? <p className="err" role="alert">{copyError}</p> : null}
          <div className="row">
            <button className="btn btn-ghost" type="button" onClick={() => void copyText(text)}>
              {t("copy")}
            </button>
            <button className="btn btn-ghost" type="button" disabled={!src} onClick={() => void copyImage()}>
              {t("qrCopyImage")}
            </button>
            <button className="btn" type="button" onClick={() => setOpen(false)}>
              {t("qrClose")}
            </button>
          </div>
        </QrDialog>
      ) : null}
    </>
  );
}
