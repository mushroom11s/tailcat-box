import type { MessageKey } from "../i18n/en";

export function systemText(code: string | undefined, body: string, t: (key: MessageKey) => string): string {
  switch (code) {
    case "hear-meow":
      return "they're hear meow";
    case "peer-changed":
      return t("chatPeerChanged");
    case "room-restarted":
      return t("chatRoomRestarted");
    case "bad-frame":
      return t("chatBadFrame");
    case "file-verify":
      return t("chatFileVerify");
    default:
      return body;
  }
}

export function localizeChatError(message: string, t: (key: MessageKey) => string): string {
  switch (message) {
    case "Paste a Tailcat address that starts with tc.":
      return t("chatAddrError");
    case "Could not reach peer. Check the address and that they are online.":
      return t("chatUnreachable");
    case "Microphone access was denied.":
      return t("chatMicDenied");
    case "room is starting":
      return "";
    default:
      return message;
  }
}
