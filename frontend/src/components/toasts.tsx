import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";

export const ERROR_TOAST_MS = 7000;
export const OK_TOAST_MS = 3200;

type ToastTone = "error" | "ok";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastApi = {
  push: (message: string) => void;
  note: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const noopToast: ToastApi = { push: () => undefined, note: () => undefined };

let toastSeq = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const add = useCallback((message: string, tone: ToastTone) => {
    const text = message.trim();
    if (!text) {
      return;
    }
    const id = toastSeq++;
    setToasts((prev) => {
      if (prev.some((item) => item.message === text)) {
        return prev;
      }
      return [...prev, { id, message: text, tone }].slice(-4);
    });
  }, []);

  const push = useCallback((message: string) => add(message, "error"), [add]);
  const note = useCallback((message: string) => add(message, "ok"), [add]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => ({ push, note }), [push, note]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastApi {
  return useContext(ToastContext) ?? noopToast;
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const { t } = useI18n();
  const stack = (
    <div className="toast-stack">
      {toasts.map((item) => (
        <ToastCard
          key={item.id}
          item={item}
          label={item.tone === "ok" ? t("toastOk") : t("toastError")}
          dismissLabel={t("toastDismiss")}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
  if (typeof document === "undefined") {
    return stack;
  }
  return createPortal(stack, document.body);
}

function ToastCard({
  item,
  label,
  dismissLabel,
  onDismiss,
}: {
  item: ToastItem;
  label: string;
  dismissLabel: string;
  onDismiss: (id: number) => void;
}) {
  const duration = item.tone === "ok" ? OK_TOAST_MS : ERROR_TOAST_MS;
  const endsAt = useRef(0);
  const leftMs = useRef(duration);
  const timer = useRef<number | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const schedule = useCallback(
    (ms: number) => {
      clearTimer();
      const wait = Math.max(0, ms);
      endsAt.current = Date.now() + wait;
      timer.current = window.setTimeout(() => onDismissRef.current(item.id), wait);
    },
    [clearTimer, item.id],
  );

  useEffect(() => {
    schedule(duration);
    return clearTimer;
  }, [schedule, duration, clearTimer]);

  return (
    <div
      className={item.tone === "ok" ? "toast toast-ok" : "toast"}
      role={item.tone === "ok" ? "status" : "alert"}
      onMouseEnter={() => {
        leftMs.current = Math.max(0, endsAt.current - Date.now());
        clearTimer();
      }}
      onMouseLeave={() => {
        schedule(leftMs.current);
      }}
    >
      <span className="toast-badge" aria-hidden="true">
        {item.tone === "ok" ? "✓" : "!"}
      </span>
      <div className="toast-copy">
        <p className="toast-label">{label}</p>
        <p className="toast-message">{item.message}</p>
      </div>
      <button className="toast-dismiss" type="button" aria-label={dismissLabel} onClick={() => onDismiss(item.id)}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}
