export type { MessageKey } from "./en";
export type { Locale } from "./locale";
export {
  LOCALE_KEY,
  detectLocale,
  isLocale,
  kindMessageKey,
  statusMessageKey,
  translate,
} from "./locale";
export { LocaleProvider, useI18n } from "./LocaleProvider";
