import type { MessageKey } from "../i18n/en";

const PREVIEW_MAX = 80;
const LABEL_MAX = 24;

type AlertMessage = {
  direction?: string;
  type?: string;
  body?: string;
};

type Translator = (key: MessageKey) => string;

export function isInboundAlert(msg: AlertMessage): boolean {
  return msg.direction === "in" && (msg.type === "text" || msg.type === "file" || msg.type === "voice");
}

// readingOpenTranscript is true only while this window is in front and
// viewingThisRoom is the transcript on screen. Other rooms, the lobby,
// other pages, and a hidden or unfocused window still notify.
export function readingOpenTranscript(
  doc: { hasFocus: () => boolean; visibilityState: string },
  viewingThisRoom: boolean,
): boolean {
  if (!viewingThisRoom || doc.visibilityState === "hidden") {
    return false;
  }
  try {
    return doc.hasFocus();
  } catch {
    return false;
  }
}

export function abbrevPeerLabel(addr: string): string {
  const label = addr.trim();
  if (label.length <= LABEL_MAX) {
    return label;
  }
  return `${label.slice(0, 12)}…${label.slice(-6)}`;
}

export function inboundAlertTitle(peer: string, appName: string): string {
  return abbrevPeerLabel(peer) || appName.trim();
}

export function inboundAlertBody(msg: AlertMessage, t: Translator): string {
  if (msg.type === "file") {
    return t("chatNotifyFile");
  }
  if (msg.type === "voice") {
    return t("chatNotifyVoice");
  }
  const preview = textPreview(msg.body ?? "");
  if (!preview || looksSensitive(preview)) {
    return t("chatNotifyMessage");
  }
  return preview;
}

function textPreview(body: string): string {
  const line = body.replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (line.length <= PREVIEW_MAX) {
    return line;
  }
  return `${line.slice(0, PREVIEW_MAX - 1)}…`;
}

function looksSensitive(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("-----begin") ||
    lower.includes("private key") ||
    lower.includes("secret key") ||
    /\bnodekey:/i.test(text) ||
    /\bapi[_-]?key\b/i.test(text)
  );
}
