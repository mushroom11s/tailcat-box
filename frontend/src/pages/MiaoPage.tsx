import { useEffect, useRef, useState, type DragEvent } from "react";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import LoadingCat from "../components/LoadingCat";
import QrScanButton from "../components/QrScanButton";
import { useI18n, type MessageKey } from "../i18n";
import iconUrl from "../assets/icon.png";
import { encodeQrDataURL } from "../lib/qr";
import {
  acceptMiaoCode,
  base64ToBlob,
  downloadsLeft,
  fileToBase64,
  formatBytes,
  miaoErrorKey,
  remainingTTL,
  shareTooLarge,
  type MiaoReceipt,
  type MiaoShare,
  type Remaining,
} from "../lib/miao";
import { endMiaoShare, hasWailsBindings, joinMiaoShare, miaoShareStatus, onTailcatEvent, selectDirectory, selectFiles, startMiaoShare } from "../lib/wails";

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

function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function upsertShare(list: MiaoShare[], snap: MiaoShare): MiaoShare[] {
  const index = list.findIndex((item) => item.id === snap.id);
  if (index < 0) {
    return [snap, ...list];
  }
  const next = list.slice();
  next[index] = snap;
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
  const [qrSrc, setQrSrc] = useState("");
  const [qrFailed, setQrFailed] = useState(false);
  const left = downloadsLeft(share.maxDownloads, share.downloads);
  const ttl = remainingTTL(share.expiresAt, share.forever, now);
  const label = share.files.map((file) => file.name).join(", ") || share.id;

  useEffect(() => {
    const payload = share.payload;
    if (!payload) {
      setQrSrc("");
      setQrFailed(false);
      return;
    }
    let live = true;
    setQrFailed(false);
    void encodeQrDataURL(payload, "H")
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
          {share.files.map((file) => (
            <li key={`${file.name}:${file.size}`}>
              <span>{file.name}</span>
              <span className="miao-size">{formatBytes(file.size)}</span>
            </li>
          ))}
        </ul>
        <div className="miao-share-meta">
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
          {qrSrc ? (
            <div className="miao-qr-frame">
              <img src={qrSrc} alt={t("miaoToken")} width={172} height={172} />
              <span className="miao-qr-mark">
                <img src={iconUrl} alt="" />
              </span>
            </div>
          ) : (
            <LoadingCat size="lg" layout="block" label={t("miaoPacking")} />
          )}
        </div>
      </div>
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
  const [saved, setSaved] = useState<MiaoReceipt | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const endedRef = useRef(new Set<string>());
  const ticking = shares.some((share) => !share.forever);

  useEffect(() => {
    let live = true;
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
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    return onTailcatEvent((ev) => {
      if (ev.Kind !== "miao" || !ev.Data) {
        return;
      }
      let snap: MiaoShare;
      try {
        snap = JSON.parse(ev.Data) as MiaoShare;
      } catch {
        return;
      }
      if (snap.status === "ended") {
        endedRef.current.add(snap.id);
        setShares((list) => list.filter((item) => item.id !== snap.id));
        setNotice(t("miaoEnded"));
        return;
      }
      if (snap.status === "active" && snap.id) {
        setShares((list) => upsertShare(list, snap));
      }
    });
  }, [t]);

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
    void acceptFileList(Array.from(ev.dataTransfer.files ?? []));
  }

  async function endShare(id: string): Promise<void> {
    endedRef.current.add(id);
    setError("");
    try {
      await endMiaoShare(id);
      setShares((list) => list.filter((item) => item.id !== id));
      setNotice(t("miaoEnded"));
    } catch (err) {
      showError(err, "miaoEndedRemote");
    }
  }

  async function join(): Promise<void> {
    const raw = code.trim();
    if (!acceptMiaoCode(raw).ok) {
      setError(t("miaoBadCode"));
      return;
    }
    setBusy("join");
    setError("");
    setSaved(null);
    try {
      let dest = "";
      if (hasWailsBindings()) {
        dest = await selectDirectory(t("miaoPickFolder"));
        if (!dest) {
          return;
        }
      }
      const receipt = await joinMiaoShare(raw, dest);
      setSaved(receipt);
      if (!hasWailsBindings() && typeof URL.createObjectURL === "function") {
        for (const file of receipt.files) {
          if (!file.dataBase64) {
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
    } catch (err) {
      showError(err, "miaoUnreachable");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="page miao-page">
      <header className="chat-lobby-head">
        <h2>{t("miaoTitle")}</h2>
        <p className="lede">{t("miaoLede")}</p>
      </header>
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
          {shares.length ? (
            <div className="miao-share-list">
              <h3>{t("miaoActive")}</h3>
              {shares.map((share) => (
                <ShareCard key={share.id} share={share} now={now} onEnd={(id) => void endShare(id)} />
              ))}
            </div>
          ) : null}
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
        </div>
      ) : (
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
              />
              <QrScanButton disabled={busy !== ""} accept={acceptMiaoCode} invalidKey="miaoBadCode" onAccept={setCode} />
            </div>
          </div>
          <div className="row">
            <button className="btn" type="button" disabled={busy !== "" || !code.trim()} onClick={() => void join()}>
              {busy === "join" ? <LoadingCat size="sm" label={t("miaoJoining")} /> : t("miaoJoin")}
            </button>
          </div>
          {saved ? (
            <div>
              <h3>{t("miaoSaved")}</h3>
              <ul className="miao-files">
                {saved.files.map((file) => (
                  <li key={`${file.name}:${file.path}`}>
                    <span>{file.name}</span>
                    <span className="miao-size">{file.path || formatBytes(file.size)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
