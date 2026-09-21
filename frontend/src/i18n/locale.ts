import { en, type MessageKey } from "./en";
import { zhCN } from "./zh-CN";

export type Locale = "en" | "zh-CN";
export type { MessageKey };

export const LOCALE_KEY = "tailcat-locale";

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  en,
  "zh-CN": zhCN,
};

export function isLocale(value: string | null): value is Locale {
  return value === "en" || value === "zh-CN";
}

export function detectLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_KEY);
  if (isLocale(stored)) {
    return stored;
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  if (nav.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }
  return "en";
}

export function translate(locale: Locale, key: MessageKey): string {
  return catalogs[locale][key] ?? catalogs.en[key];
}

export function kindMessageKey(kind: string): MessageKey | null {
  switch (kind) {
    case "pipe_serve":
      return "kindPipeServe";
    case "pipe_dial":
      return "kindPipeDial";
    case "port_serve":
      return "kindPortServe";
    case "forward":
      return "kindForward";
    case "browse":
      return "kindBrowse";
    case "ping":
      return "kindPing";
    case "recv":
      return "kindRecv";
    case "copy":
      return "kindCopy";
    case "files_serve":
      return "kindFilesServe";
    case "ssh_serve":
      return "kindSSHServe";
    case "ssh_client":
      return "kindSSHClient";
    case "socks":
      return "kindSOCKS";
    case "exit_node":
      return "kindExitNode";
    case "exec":
      return "kindExec";
    default:
      return null;
  }
}

export function statusMessageKey(status: string): MessageKey | null {
  switch (status) {
    case "starting":
      return "statusStarting";
    case "running":
      return "statusRunning";
    case "error":
      return "statusError";
    case "stopped":
      return "statusStopped";
    default:
      return null;
  }
}
