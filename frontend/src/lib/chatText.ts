import type { MessageKey } from "../i18n/en";
import {
  cameraDeniedError,
  liveMediaError,
  micDeniedError,
  screenDeniedError,
  screenUnavailableError,
} from "./liveCall";

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
    case "You can keep 8 rooms open. Close one to start another.":
    case "You can keep 8 rooms open. Quit the app to close rooms.":
      return t("roomCap");
    case "Unknown room.":
      return t("chatUnknownRoom");
    case "That key is already listening in another room.":
      return t("chatKeyInUse");
    case "There is no room to restart.":
      return t("chatNoRoomRestart");
    case "Could not reach peer. Check the address and that they are online.":
      return t("chatUnreachable");
    case micDeniedError:
      return t("chatMicDenied");
    case cameraDeniedError:
      return t("chatCamDenied");
    case screenDeniedError:
      return t("chatScreenDenied");
    case screenUnavailableError:
      return t("chatScreenUnavailable");
    case liveMediaError:
      return t("chatLiveFailed");
    case "room is starting":
      return "";
    default:
      return message;
  }
}
