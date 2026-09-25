import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { ClipboardSetText, OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
import LoadingCat from "../components/LoadingCat";
import QrCopyButton from "../components/QrCopyButton";
import QrScanButton from "../components/QrScanButton";
import { useToasts } from "../components/toasts";
import { useI18n, type MessageKey } from "../i18n";
import miaoQrMark from "../assets/miao-qr-cat.png?inline";
import runningCatGif from "../assets/running-cat.gif";
import runningCatWebp from "../assets/running-cat.webp";
import { useClipboardFieldPaste, type PasteFailure } from "../lib/clipboardPaste";
import { copyQrImage } from "../lib/copyQrImage";
import { encodeQrDataURL } from "../lib/qr";
import {
  acceptMiaoCode,
  extractShareCode,
  base64ToBlob,
  downloadsLeft,
  fileToBase64,
  formatBytes,
  miaoErrorKey,
  parseReceiveJob,
  parseShare,
  receivePercent,
  receiveTerminal,
  expiresSoon,
  nextRetryDelay,
  remainingTTL,
  shareTooLarge,
  shouldAutoRetryDownload,
  upsertReceiveJob,
  type MiaoShare,
  type ReceiveJob,
  type Remaining,
} from "../lib/miao";
import { cancelMiaoReceive, discardMiaoReceive, endMiaoShare, hasWailsBindings, listMiaoReceives, miaoRestoreNotes, miaoShareStatus, onTailcatEvent, selectDirectory, selectFiles, setMiaoReceiveDest, startMiaoReceive, startMiaoShare } from "../lib/wails";

type TTLMode = "1" | "7" | "15" | "custom" | "forever";
type CountMode = "1" | "3" | "10" | "unlimited" | "custom";
type Mode = "send" | "receive";

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the desktop clipboard.
  }
  try {
    await ClipboardSetText(text);
  } catch {
    // Ignore copy failures outside the desktop app.
  }
}

function ttlLabel(ttl: Remaining | null, t: (key: MessageKey) => string): string {
  if (!ttl || ttl.kind === "forever") {
    return t("miaoNoExpiry");
  }
  if (ttl.kind === "expired") {
    return t("miaoEndedRemote");
  }
  return t("miaoTimeLeft").replace("{d}", String(ttl.days)).replace("{h}", String(ttl.hours)).replace("{m}", String(ttl.minutes));
}

function localizedMiaoError(message: string, t: (key: MessageKey) => string): string {
  const key = miaoErrorKey(new Error(message));
  return key ? t(key) : message;
}

function nativeFileDrop(): boolean {
  const runtime = (window as { runtime?: { OnFileDrop?: unknown; OnFileDropOff?: unknown } }).runtime;
  return typeof runtime?.OnFileDrop === "function" && typeof runtime?.OnFileDropOff === "function";
}

function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function receiveStatusLabel(status: string, t: (key: MessageKey) => string): string {
  switch (status) {
    case "connecting":
      return t("miaoStatusConnecting");
    case "queued":
      return t("miaoStatusQueued");
    case "downloading":
      return t("miaoStatusDownloading");
    case "done":
      return t("miaoSaved");
    case "failed":
      return t("miaoStatusFailed");
    case "cancelled":
      return t("miaoStatusCancelled");
    case "interrupted":
      return t("miaoStatusInterrupted");
    default:
      return t("miaoReceiveJob");
  }
}

function showRunningCat(status: ReceiveJob["status"]): boolean {
  return status === "connecting" || status === "queued" || status === "downloading" || status === "done";
}

function receiveErrorText(job: ReceiveJob, t: (key: MessageKey) => string): string {
  if (!job.error) {
    return "";
  }
  const key = miaoErrorKey(new Error(job.error));
  return key ? t(key) : job.error;
}

function upsertShare(list: MiaoShare[], snap: MiaoShare): MiaoShare[] {
  const nextSnap = parseShare(snap) ?? { ...snap, files: Array.isArray(snap.files) ? snap.files : [] };
  const index = list.findIndex((item) => item.id === nextSnap.id);
  if (index < 0) {
    return [nextSnap, ...list];
  }
  const next = list.slice();
  next[index] = nextSnap;
  return next;
}

function ShareCard({
  share,
  now,
  onEnd,
}: {
  share: MiaoShare;
  now: number;
  onEnd: (id: string) => void;
}) {
  const { t } = useI18n();
  const { push, note } = useToasts();
  const [qrSrc, setQrSrc] = useState("");
  const [qrFailed, setQrFailed] = useState(false);
  const [copyNote, setCopyNote] = useState("");
  const [copyError, setCopyError] = useState("");
  const left = downloadsLeft(share.maxDownloads, share.downloads);
  const ttl = remainingTTL(share.expiresAt, share.forever, now);
  const expiring = expiresSoon(share.expiresAt, share.forever, now);
  const offlineShare = share.listening === false;
  const files = share.files ?? [];
  const label = files.map((file) => file.name).join(", ") || share.id;

  useEffect(() => {
    const payload = share.payload;
    if (!payload) {
      setQrSrc("");
      setQrFailed(false);
      return;
    }
    let live = true;
    setQrFailed(false);
    void encodeQrDataURL(payload, { errorCorrectionLevel: "H", centerMark: miaoQrMark })
      .then((url) => {
        if (live) {
          setQrSrc(url);
        }
      })
      .catch(() => {
        if (live) {
          setQrFailed(true);
        }
      });
    return () => {
      live = false;
    };
  }, [share.payload]);

  return (
    <article className="glass miao-active" aria-label={label}>
      <div className="miao-active-grid">
        <h3>{t("miaoFiles")}</h3>
        <ul className="miao-files">
          {files.map((file) => (
            <li key={`${file.name}:${file.size}`}>
              <span>{file.name}</span>
              <span className="miao-size">{formatBytes(file.size)}</span>
            </li>
          ))}
        </ul>
        <div className="miao-share-meta">
          {offlineShare ? (
            <p className="miao-warn" role="status">
              {t("miaoListenFailed")}
            </p>
          ) : null}
          {expiring ? (
            <p className="miao-warn" role="status">
              {t("miaoExpiringSoon")}
            </p>
          ) : null}
          {share.byRef ? <p className="chat-quiet">{t("miaoByRef")}</p> : null}
          {share.warning ? (
            <p className="err" role="alert">
              {localizedMiaoError(share.warning, t)}
            </p>
          ) : null}
          <p className="chat-quiet">
            {t("miaoTotal")} {formatBytes(share.total)}
          </p>
          <p className="chat-quiet">
            {t("miaoRemaining")} {ttlLabel(ttl, t)}
          </p>
          <p className="chat-quiet">
            {t("miaoDownloadsLeft")} {left === null ? t("miaoUnlimited") : String(left)}
          </p>
          <label className="field" htmlFor={`miao-token-${share.id}`}>
            {t("miaoToken")}
            <textarea id={`miao-token-${share.id}`} readOnly value={share.payload} rows={3} />
          </label>
          <div className="row">
            <button className="btn btn-ghost" type="button" onClick={() => void copyText(share.payload)}>
              {t("miaoCopyCode")}
            </button>
            <button className="btn btn-danger" type="button" onClick={() => onEnd(share.id)}>
              {t("miaoEnd")}
            </button>
          </div>
        </div>
        <div className="miao-qr">
          {qrFailed ? <p className="err">{t("qrEncodeFailed")}</p> : null}
          {qrSrc ? <img src={qrSrc} alt={t("miaoToken")} width={172} height={172} /> : offlineShare ? (
            <p className="miao-warn" role="status">{t("miaoListenFailed")}</p>
          ) : (
            <LoadingCat size="lg" layout="block" label={t("miaoPacking")} />
          )}
          {qrSrc ? (
            <QrCopyButton
              onClick={() => {
                setCopyNote("");
                setCopyError("");
                void copyQrImage(qrSrc)
                  .then(() => {
                    setCopyNote(t("qrCopied"));
                    note(t("qrCopied"));
                  })
                  .catch(() => {
                    setCopyError(t("qrCopyFailed"));
                    push(t("qrCopyFailed"));
                  });
              }}
            />
          ) : null}
          {copyNote ? <p className="chat-quiet" role="status">{copyNote}</p> : null}
          {copyError ? <p className="err" role="alert">{copyError}</p> : null}
        </div>
      </div>
    </article>
  );
}

function ReceiveCard({
  job,
  now,
  retrying,
  onCancel,
  onChangeFolder,
  onResume,
  onRetry,
  onDiscard,
}: {
  job: ReceiveJob;
  now: number;
  retrying: boolean;
  onCancel: (id: string) => void;
  onChangeFolder: (job: ReceiveJob) => void;
  onResume: (job: ReceiveJob) => void;
  onRetry: (job: ReceiveJob) => void;
  onDiscard: (id: string) => void;
}) {
  const { t } = useI18n();
  const files = job.files ?? [];
  const names = files.map((file) => file.name).join(", ");
  const label = names || t("miaoReceiveJob");
  const status = receiveStatusLabel(job.status, t);
  const pct = receivePercent(job);
  const active = !receiveTerminal(job.status);
  const canChangeFolder = hasWailsBindings() && (job.status === "connecting" || job.status === "queued");
  const canResume = job.status === "interrupted";
  const canRetry = job.status === "failed";
  const error = receiveErrorText(job, t);
  const expiring = expiresSoon(job.expiresAt ?? "", false, now);
  return (
    <article className="glass miao-active miao-receive-card" aria-label={label}>
      <h3>{names || t("miaoFiles")}</h3>
      <p className="miao-receive-status">{status}</p>
      {files.length ? (
        <ul className="miao-files">
          {files.map((file) => (
            <li key={`${file.name}:${file.size}`}>
              <span>{file.name}</span>
              <span className="miao-size">{formatBytes(file.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="miao-progress-wrap">
        <div
          className="miao-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={status}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        {showRunningCat(job.status) ? (
          <picture className="miao-progress-cat" style={{ "--miao-pct": `${pct}%` } as CSSProperties}>
            <source srcSet={runningCatWebp} type="image/webp" />
            <img src={runningCatGif} alt="" />
          </picture>
        ) : null}
      </div>
      <p className="chat-quiet miao-receive-bytes">
        {formatBytes(job.bytesDone)} / {formatBytes(job.bytesTotal)}
      </p>
      {job.dest ? (
        <p className="chat-quiet">
          {t("miaoSaveTo")} {job.dest}
        </p>
      ) : null}
      {expiring ? (
        <p className="miao-warn" role="status">
          {t("miaoExpiringSoon")}
        </p>
      ) : null}
      {retrying ? <p className="chat-quiet">{t("miaoRetrying")}</p> : null}
      {error ? <p className="err">{error}</p> : null}
      {active ? (
        <div className="row">
          {canChangeFolder ? (
            <button className="btn btn-ghost" type="button" onClick={() => onChangeFolder(job)}>
              {t("miaoChangeFolder")}
            </button>
          ) : null}
          <button className="btn btn-ghost" type="button" onClick={() => onCancel(job.id)}>
            {t("miaoCancel")}
          </button>
        </div>
      ) : null}
      {canResume || canRetry ? (
        <div className="row">
          {canResume ? (
            <button className="btn" type="button" onClick={() => onResume(job)}>
              {t("miaoResume")}
            </button>
          ) : null}
          {canRetry ? (
            <button className="btn" type="button" onClick={() => onRetry(job)}>
              {t("miaoRetry")}
            </button>
          ) : null}
          <button className="btn btn-ghost" type="button" onClick={() => onDiscard(job.id)}>
            {t("miaoDiscard")}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function MiaoPage() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("send");
  const [ttlMode, setTTLMode] = useState<TTLMode>("1");
  const [customDays, setCustomDays] = useState("30");
  const [countMode, setCountMode] = useState<CountMode>("1");
  const [customCount, setCustomCount] = useState("5");
  const [shares, setShares] = useState<MiaoShare[]>([]);
  const [busy, setBusy] = useState<"" | "pack" | "join">("");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  const [jobs, setJobs] = useState<ReceiveJob[]>([]);
  const [lastDest, setLastDest] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const jobsRef = useRef(jobs);
  const retryAttempts = useRef<Record<string, number>>({});
  const retryTimers = useRef<Record<string, number>>({});
  jobsRef.current = jobs;
  const endedRef = useRef(new Set<string>());
  const savedRef = useRef(new Set<string>());
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const beginRef = useRef<(files: Array<{ name: string; path: string; dataBase64: string }>) => Promise<void>>(async () => undefined);
  const ticking = shares.some((share) => !share.forever) || jobs.some((job) => Boolean(job.expiresAt));

  function sharePasteFailure(reason: PasteFailure): MessageKey {
    if (reason === "empty") {
      return "qrPasteEmpty";
    }
    if (reason === "unusable") {
      return "miaoPasteUnusable";
    }
    if (reason === "denied") {
      return "qrPasteDenied";
    }
    if (reason === "no-qr") {
      return "qrNotFound";
    }
    return "miaoBadCode";
  }

  const onCodePasteEvent = useClipboardFieldPaste(
    code,
    (value) => {
      setError("");
      setCode(value);
    },
    extractShareCode,
    (reason) => setError(t(sharePasteFailure(reason))),
  );

  useEffect(() => {
    let live = true;
    void listMiaoReceives()
      .then((listed) => {
        if (!live) {
          return;
        }
        setJobs((current) => listed.reduce((list, job) => upsertReceiveJob(list, job), current));
      })
      .catch(() => undefined);
    void miaoShareStatus()
      .then((list) => {
        if (!live) {
          return;
        }
        const incoming = list.filter((share) => share.id && share.status === "active" && !endedRef.current.has(share.id));
        setShares((current) => {
          const seen = new Set(current.map((share) => share.id));
          const extra = incoming.filter((share) => !seen.has(share.id));
          return extra.length ? [...current, ...extra] : current;
        });
      })
      .catch(() => undefined);
    void miaoRestoreNotes()
      .then((notes) => {
        if (!live || notes.length === 0) {
          return;
        }
        const lines = notes
          .map((note) => {
            const key = miaoErrorKey(new Error(note));
            return key ? t(key) : note;
          })
          .filter((line, index, all) => line !== "" && all.indexOf(line) === index);
        if (lines.length) {
          setError(lines.join(" "));
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [t]);

  useEffect(() => {
    return onTailcatEvent((ev) => {
      if (ev.Kind === "miao-receive" && ev.Data) {
        const job = parseReceiveJob(ev.Data);
        if (!job) {
          return;
        }
        setJobs((list) => upsertReceiveJob(list, job));
        if (job.status === "done" && !hasWailsBindings() && !savedRef.current.has(job.id)) {
          savedRef.current.add(job.id);
          for (const file of job.saved ?? []) {
            if (!file.dataBase64 || typeof URL.createObjectURL !== "function") {
              continue;
            }
            const url = URL.createObjectURL(base64ToBlob(file.dataBase64));
            const link = document.createElement("a");
            link.href = url;
            link.download = file.name;
            link.click();
            URL.revokeObjectURL(url);
          }
        }
        return;
      }
      if (ev.Kind !== "miao" || !ev.Data) {
        return;
      }
      const snap = parseShare(ev.Data);
      if (!snap) {
        return;
      }
      if (snap.status === "ended") {
        endedRef.current.add(snap.id);
        setShares((list) => list.filter((item) => item.id !== snap.id));
        setNotice(t(snap.byRef ? "miaoEndedByRef" : "miaoEnded"));
        return;
      }
      if (snap.status === "active" && snap.id) {
        setShares((list) => upsertShare(list, snap));
      }
    });
  }, [t]);

  useEffect(() => {
    function sync() {
      setOnline(navigator.onLine);
    }
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!ticking) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);

  function limits(): { ttlDays: number; forever: boolean; maxDownloads: number } | { error: MessageKey } {
    let forever = false;
    let ttlDays = 1;
    if (ttlMode === "forever") {
      forever = true;
    } else if (ttlMode === "custom") {
      const days = Number(customDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        return { error: "miaoCustomDaysInvalid" };
      }
      ttlDays = days;
    } else {
      ttlDays = Number(ttlMode);
    }
    let maxDownloads = 1;
    if (countMode === "unlimited") {
      maxDownloads = 0;
    } else if (countMode === "custom") {
      const count = Number(customCount);
      if (!Number.isInteger(count) || count < 1) {
        return { error: "miaoCustomCountInvalid" };
      }
      maxDownloads = count;
    } else {
      maxDownloads = Number(countMode);
    }
    return { ttlDays, forever, maxDownloads };
  }

  function showError(err: unknown, fallback: MessageKey): void {
    const key = miaoErrorKey(err);
    setError(key ? t(key) : err instanceof Error && err.message ? err.message : t(fallback));
  }

  async function begin(files: Array<{ name: string; path: string; dataBase64: string }>): Promise<void> {
    const chosen = limits();
    if ("error" in chosen) {
      setError(t(chosen.error));
      return;
    }
    setBusy("pack");
    setError("");
    setNotice("");
    try {
      const snap = await startMiaoShare(files, chosen.ttlDays, chosen.forever, chosen.maxDownloads);
      setShares((list) => upsertShare(list, snap));
    } catch (err) {
      showError(err, "miaoNeedFile");
    } finally {
      setBusy("");
    }
  }
  beginRef.current = begin;

  useEffect(() => {
    if (!hasWailsBindings() || !nativeFileDrop()) {
      return;
    }
    OnFileDrop((_x, _y, paths) => {
      if (!paths?.length || busyRef.current) {
        return;
      }
      void beginRef.current(paths.map((path) => ({ name: baseName(path), path, dataBase64: "" })));
    }, true);
    return () => OnFileDropOff();
  }, []);

  async function acceptFileList(list: File[]): Promise<void> {
    if (!list.length || busy) {
      return;
    }
    if (shareTooLarge(list.map((file) => file.size))) {
      setError(t("miaoTooBig"));
      return;
    }
    const chosen = limits();
    if ("error" in chosen) {
      setError(t(chosen.error));
      return;
    }
    setBusy("pack");
    setError("");
    setNotice("");
    try {
      const inputs = await Promise.all(
        list.map(async (file) => ({
          name: file.name,
          path: "",
          dataBase64: await fileToBase64(file),
        })),
      );
      const snap = await startMiaoShare(inputs, chosen.ttlDays, chosen.forever, chosen.maxDownloads);
      setShares((list) => upsertShare(list, snap));
    } catch (err) {
      showError(err, "miaoNeedFile");
    } finally {
      setBusy("");
    }
  }

  async function pickNative(): Promise<void> {
    if (busy) {
      return;
    }
    const chosen = limits();
    if ("error" in chosen) {
      setError(t(chosen.error));
      return;
    }
    try {
      const paths = await selectFiles(t("miaoPickFiles"));
      if (!paths.length) {
        return;
      }
      await begin(paths.map((path) => ({ name: baseName(path), path, dataBase64: "" })));
    } catch (err) {
      showError(err, "miaoNeedFile");
    }
  }

  function onDrop(ev: DragEvent<HTMLButtonElement>): void {
    ev.preventDefault();
    setDragOver(false);
    if (hasWailsBindings() && nativeFileDrop()) {
      return;
    }
    void acceptFileList(Array.from(ev.dataTransfer.files ?? []));
  }

  async function endShare(id: string): Promise<void> {
    const byRef = shares.some((item) => item.id === id && item.byRef);
    endedRef.current.add(id);
    setError("");
    try {
      await endMiaoShare(id);
      setShares((list) => list.filter((item) => item.id !== id));
      setNotice(t(byRef ? "miaoEndedByRef" : "miaoEnded"));
    } catch (err) {
      showError(err, "miaoEndedRemote");
    }
  }

  async function ensureDest(): Promise<string | null> {
    if (lastDest) {
      return lastDest;
    }
    if (!hasWailsBindings()) {
      return "";
    }
    const dest = await selectDirectory(t("miaoPickFolder"));
    if (!dest) {
      return null;
    }
    setLastDest(dest);
    return dest;
  }

  async function changeDefaultFolder(): Promise<void> {
    if (!hasWailsBindings()) {
      return;
    }
    const dest = await selectDirectory(t("miaoPickFolder"));
    if (!dest) {
      return;
    }
    setLastDest(dest);
  }

  async function changeJobFolder(job: ReceiveJob): Promise<void> {
    if (!hasWailsBindings()) {
      return;
    }
    const dest = await selectDirectory(t("miaoPickFolder"));
    if (!dest) {
      return;
    }
    setLastDest(dest);
    if (job.status !== "connecting" && job.status !== "queued") {
      return;
    }
    try {
      await setMiaoReceiveDest(job.id, dest);
      setJobs((list) => list.map((item) => (item.id === job.id ? { ...item, dest } : item)));
    } catch (err) {
      showError(err, "miaoPickFolder");
    }
  }

  async function cancelJob(id: string): Promise<void> {
    setError("");
    try {
      await cancelMiaoReceive(id);
    } catch (err) {
      showError(err, "miaoUnknownReceive");
    }
  }

  async function retryJob(job: ReceiveJob): Promise<void> {
    const pending = retryTimers.current[job.id];
    if (pending) {
      window.clearTimeout(pending);
      delete retryTimers.current[job.id];
    }
    retryAttempts.current[job.id] = 0;
    setRetrying((current) => ({ ...current, [job.id]: false }));
    await resumeJob(job);
  }

  async function resumeJob(job: ReceiveJob): Promise<void> {
    const raw = (job.payload || "").trim();
    if (!raw) {
      setError(t("miaoBadCode"));
      return;
    }
    setError("");
    try {
      const next = await startMiaoReceive(raw, job.dest);
      setJobs((list) => upsertReceiveJob(list, next));
    } catch (err) {
      showError(err, "miaoUnreachable");
    }
  }

  const resumeRef = useRef(resumeJob);
  resumeRef.current = resumeJob;

  // Connecting/downloading must not reset the attempt count: a retry goes
  // through those states before it can fail again, and the next wait is longer.
  const scheduleRetryRef = useRef<(job: ReceiveJob) => void>(() => undefined);
  scheduleRetryRef.current = (job: ReceiveJob) => {
    if (!shouldAutoRetryDownload(job.status, job.error ?? "") || retryTimers.current[job.id]) {
      return;
    }
    const attempt = retryAttempts.current[job.id] ?? 0;
    const delay = nextRetryDelay(attempt);
    if (delay == null) {
      return;
    }
    setRetrying((current) => ({ ...current, [job.id]: true }));
    retryTimers.current[job.id] = window.setTimeout(() => {
      delete retryTimers.current[job.id];
      const latest = jobsRef.current.find((item) => item.id === job.id);
      setRetrying((current) => ({ ...current, [job.id]: false }));
      if (!latest || !shouldAutoRetryDownload(latest.status, latest.error ?? "")) {
        return;
      }
      retryAttempts.current[job.id] = attempt + 1;
      void resumeRef.current(latest).catch(() => {
        const after = jobsRef.current.find((item) => item.id === job.id);
        if (after) {
          scheduleRetryRef.current(after);
        }
      });
    }, delay);
  };

  useEffect(() => {
    for (const job of jobs) {
      if (!shouldAutoRetryDownload(job.status, job.error ?? "")) {
        const pending = retryTimers.current[job.id];
        if (pending) {
          window.clearTimeout(pending);
          delete retryTimers.current[job.id];
        }
        if (job.status === "done" || job.status === "cancelled" || job.status === "interrupted") {
          retryAttempts.current[job.id] = 0;
        }
        continue;
      }
      scheduleRetryRef.current(job);
    }
  }, [jobs]);

  useEffect(() => {
    const timers = retryTimers.current;
    return () => {
      for (const id of Object.keys(timers)) {
        window.clearTimeout(timers[id]);
      }
    };
  }, []);

  async function discardJob(id: string): Promise<void> {
    setError("");
    try {
      await discardMiaoReceive(id);
      setJobs((list) => list.filter((item) => item.id !== id));
    } catch (err) {
      showError(err, "miaoUnknownReceive");
    }
  }

  async function join(): Promise<void> {
    const raw = extractShareCode(code);
    if (!raw) {
      setError(t("miaoBadCode"));
      return;
    }
    setError("");
    try {
      const dest = await ensureDest();
      if (dest === null) {
        return;
      }
      const job = await startMiaoReceive(raw, dest);
      setJobs((list) => upsertReceiveJob(list, job));
      setCode("");
    } catch (err) {
      showError(err, "miaoUnreachable");
    }
  }

  return (
    <section className="page miao-page">
      <header className="chat-lobby-head">
        <h2>{t("miaoTitle")}</h2>
        <p className="lede">{t("miaoLede")}</p>
      </header>
      {online ? null : (
        <p className="err" role="alert">
          {t("miaoOffline")}
        </p>
      )}
      <div className="row miao-modes" role="tablist">
        <button
          className={mode === "send" ? "btn" : "btn btn-ghost"}
          type="button"
          role="tab"
          aria-selected={mode === "send"}
          onClick={() => setMode("send")}
        >
          {t("miaoSend")}
        </button>
        <button
          className={mode === "receive" ? "btn" : "btn btn-ghost"}
          type="button"
          role="tab"
          aria-selected={mode === "receive"}
          onClick={() => setMode("receive")}
        >
          {t("miaoReceive")}
        </button>
      </div>
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="chat-quiet">{notice}</p> : null}

      {mode === "send" ? (
        <div className="miao-send">
          <div className="miao-limits">
            <label className="field">
              {t("miaoTTL")}
              <select value={ttlMode} onChange={(ev) => setTTLMode(ev.target.value as TTLMode)}>
                <option value="1">{t("miaoDay1")}</option>
                <option value="7">{t("miaoDay7")}</option>
                <option value="15">{t("miaoDay15")}</option>
                <option value="custom">{t("miaoCustomDays")}</option>
                <option value="forever">{t("miaoForever")}</option>
              </select>
            </label>
            {ttlMode === "custom" ? (
              <label className="field">
                {t("miaoDays")}
                <input
                  inputMode="numeric"
                  value={customDays}
                  onChange={(ev) => setCustomDays(ev.target.value)}
                  aria-label={t("miaoDays")}
                />
              </label>
            ) : null}
            <label className="field">
              {t("miaoDownloads")}
              <select value={countMode} onChange={(ev) => setCountMode(ev.target.value as CountMode)}>
                <option value="1">{t("miaoOnce")}</option>
                <option value="3">{t("miaoCount3")}</option>
                <option value="10">{t("miaoCount10")}</option>
                <option value="unlimited">{t("miaoUnlimited")}</option>
                <option value="custom">{t("miaoCustomCount")}</option>
              </select>
            </label>
            {countMode === "custom" ? (
              <label className="field">
                {t("miaoCount")}
                <input
                  inputMode="numeric"
                  value={customCount}
                  onChange={(ev) => setCustomCount(ev.target.value)}
                  aria-label={t("miaoCount")}
                />
              </label>
            ) : null}
          </div>
          <button
            type="button"
            className={`miao-drop${dragOver ? " drag" : ""}`}
            disabled={busy !== ""}
            onClick={() => {
              if (hasWailsBindings()) {
                void pickNative();
              } else {
                inputRef.current?.click();
              }
            }}
            onDragEnter={(ev) => {
              ev.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(ev) => {
              ev.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {busy === "pack" ? (
              <LoadingCat size="lg" layout="block" label={t("miaoPacking")} />
            ) : (
              <span>
                <strong>{t("miaoDrop")}</strong>
                <span className="chat-quiet">{t("miaoDropHint")}</span>
              </span>
            )}
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            multiple
            aria-label={t("miaoPickFiles")}
            onChange={(ev) => {
              const list = Array.from(ev.target.files ?? []);
              ev.target.value = "";
              void acceptFileList(list);
            }}
          />
          {shares.length ? (
            <div className="miao-share-list">
              <h3>{t("miaoActive")}</h3>
              <div className="miao-share-cards">
                {shares.map((share) => (
                  <ShareCard key={share.id} share={share} now={now} onEnd={(id) => void endShare(id)} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="miao-receive">
          <div className="glass miao-join">
            <p className="lede">{t("miaoJoinHelp")}</p>
            <div className="field">
              <label htmlFor="miao-join-code">{t("miaoToken")}</label>
              <div className="qr-field">
                <textarea
                  id="miao-join-code"
                  rows={3}
                  value={code}
                  placeholder={t("miaoJoinPlaceholder")}
                  onChange={(ev) => setCode(ev.target.value)}
                  onPaste={onCodePasteEvent}
                />
                <QrScanButton
                  accept={acceptMiaoCode}
                  invalidKey="miaoBadCode"
                  normalizePastedText={extractShareCode}
                  onAccept={setCode}
                />
              </div>
            </div>
            <p className="chat-quiet miao-dest-line">{lastDest ? `${t("miaoSaveTo")} ${lastDest}` : t("miaoFolderLater")}</p>
            <div className="row">
              <button className="btn" type="button" disabled={!code.trim()} onClick={() => void join()}>
                {t("miaoJoin")}
              </button>
              {hasWailsBindings() ? (
                <button className="btn btn-ghost" type="button" onClick={() => void changeDefaultFolder()}>
                  {t("miaoChangeFolder")}
                </button>
              ) : null}
            </div>
          </div>
          {jobs.length ? (
            <div className="miao-share-list">
              <h3>{t("miaoReceiveJobs")}</h3>
              <div className="miao-share-cards">
                {jobs.map((job) => (
                  <ReceiveCard
                    key={job.id}
                    job={job}
                    now={now}
                    retrying={Boolean(retrying[job.id])}
                    onCancel={(id) => void cancelJob(id)}
                    onChangeFolder={(item) => void changeJobFolder(item)}
                    onResume={(item) => void resumeJob(item)}
                    onRetry={(item) => void retryJob(item)}
                    onDiscard={(id) => void discardJob(id)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
