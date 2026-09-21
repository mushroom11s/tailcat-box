import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ClipboardSetText, OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
import { useI18n } from "../i18n";
import { localizeChatError, systemText } from "../lib/chatText";
import { hasWailsBindings, selectFiles } from "../lib/wails";

export type ChatMessage = {
  id: string;
  direction: "in" | "out" | "system";
  type: string;
  code?: string;
  body?: string;
  at: string;
  name?: string;
  mime?: string;
  size?: number;
  burn?: boolean;
  ttlSec?: number;
  preview?: string;
  fileId?: string;
};

export type ChatTransfer = {
  id: string;
  offset: number;
  size: number;
  mode: string;
  status?: string;
  name?: string;
  error?: string;
};

type Props = {
  address: string;
  peer: string;
  caps?: string[];
  messages: ChatMessage[];
  transfers?: ChatTransfer[];
  roomError: string;
  onConnect: (addr: string) => Promise<void>;
  onSend: (body: string, burn: boolean, ttlSec: number) => Promise<void>;
  onSendPath?: (path: string, burn: boolean, ttlSec: number) => Promise<string>;
  onSendBrowserFile?: (file: File, burn: boolean, ttlSec: number) => Promise<string>;
  onDiscard?: (id: string) => Promise<void>;
  onResend?: (id: string) => Promise<void>;
  onSave?: (id: string) => Promise<void>;
  onRetry: () => Promise<void>;
};

async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through
  }
  await ClipboardSetText(text);
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleTimeString();
}

function burnChoice(mode: string): { burn: boolean; ttl: number } {
  if (mode === "0" || mode === "5" || mode === "30") {
    return { burn: true, ttl: Number(mode) };
  }
  return { burn: false, ttl: 0 };
}

export default function ChatPage({
  address,
  peer,
  caps = [],
  messages,
  transfers = [],
  roomError,
  onConnect,
  onSend,
  onSendPath,
  onSendBrowserFile,
  onDiscard,
  onResend,
  onSave,
  onRetry,
}: Props) {
  const { t } = useI18n();
  const peerRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const burnRef = useRef("off");
  const [draftPeer, setDraftPeer] = useState("");
  const [draft, setDraft] = useState("");
  const [inline, setInline] = useState("");
  const [notice, setNotice] = useState("");
  const [burnMode, setBurnMode] = useState("off");
  const [viewer, setViewer] = useState<{ id: string; left: number | null } | null>(null);
  burnRef.current = burnMode;

  async function reportStatus(status: string): Promise<void> {
    if (status === "replaced") {
      setNotice(t("chatReplacedQueue"));
    }
  }

  async function sendPath(path: string): Promise<void> {
    if (!onSendPath || !path) {
      return;
    }
    const choice = burnChoice(burnRef.current);
    const status = await onSendPath(path, choice.burn, choice.ttl);
    await reportStatus(status);
  }

  async function sendBrowserFile(file: File): Promise<void> {
    if (!onSendBrowserFile) {
      return;
    }
    const choice = burnChoice(burnRef.current);
    const status = await onSendBrowserFile(file, choice.burn, choice.ttl);
    await reportStatus(status);
  }

  useEffect(() => {
    if (hasWailsBindings()) {
      OnFileDrop((_x, _y, paths) => {
        paths.forEach((path) => {
          void sendPath(path).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setInline(localizeChatError(message, t) || message);
          });
        });
      }, true);
      return () => OnFileDropOff();
    }
    const over = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
      }
    };
    const drop = (event: globalThis.DragEvent) => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) {
        return;
      }
      event.preventDefault();
      Array.from(files).forEach((file) => {
        void sendBrowserFile(file).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          setInline(localizeChatError(message, t) || message);
        });
      });
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [onSendBrowserFile, onSendPath, t]);

  useEffect(() => {
    if (!viewer) {
      return;
    }
    if (!messages.some((msg) => msg.id === viewer.id)) {
      setViewer(null);
    }
  }, [messages, viewer]);

  const countdownID = viewer && viewer.left != null ? viewer.id : "";
  useEffect(() => {
    if (!countdownID || !viewer || viewer.left == null) {
      return;
    }
    const messageID = countdownID;
    let left = viewer.left;
    const timer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(timer);
        void onDiscard?.(messageID);
        setViewer(null);
        return;
      }
      setViewer({ id: messageID, left });
    }, 1000);
    return () => window.clearInterval(timer);
    // Restart only when a different burned item is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownID, onDiscard]);

  useEffect(() => {
    if (!viewer) {
      return;
    }
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      void onDiscard?.(viewer.id);
      setViewer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, onDiscard]);

  async function connect(): Promise<void> {
    const addr = draftPeer.trim();
    if (!addr.startsWith("tc")) {
      setInline(t("chatAddrError"));
      peerRef.current?.focus();
      return;
    }
    setInline("");
    try {
      await onConnect(addr);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInline(localizeChatError(message, t) || message);
      peerRef.current?.focus();
    }
  }

  async function send(): Promise<void> {
    if (!draft.trim()) {
      return;
    }
    if (!peer) {
      peerRef.current?.focus();
      return;
    }
    const body = draft;
    const choice = burnChoice(burnMode);
    try {
      await onSend(body, choice.burn, choice.ttl);
      setDraft("");
    } catch {
      setDraft(body);
    }
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== "Enter" || e.shiftKey) {
      return;
    }
    e.preventDefault();
    void send();
  }

  async function attach(): Promise<void> {
    setNotice("");
    if (hasWailsBindings()) {
      try {
        const paths = await selectFiles(t("chatAttach"));
        for (const path of paths) {
          await sendPath(path);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setInline(localizeChatError(message, t) || message);
      }
      return;
    }
    fileRef.current?.click();
  }

  async function onPicked(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    input.value = "";
    try {
      for (const file of files) {
        await sendBrowserFile(file);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInline(localizeChatError(message, t) || message);
    }
  }

  function openBurn(msg: ChatMessage): void {
    setViewer({ id: msg.id, left: msg.ttlSec && msg.ttlSec > 0 ? msg.ttlSec : null });
  }

  async function closeViewer(id: string): Promise<void> {
    setViewer(null);
    await onDiscard?.(id);
  }

  const openMessage = viewer ? messages.find((msg) => msg.id === viewer.id) : undefined;

  return (
    <section className="page chat-page">
      <div className="chat-status">
        {roomError ? <p className="err">{roomError}</p> : <p>{t("chatListening")}</p>}
        {address ? <p className="chat-address">{address}</p> : null}
        <button className="btn" type="button" disabled={!address} onClick={() => copyText(address)}>
          {t("copy")}
        </button>
        {roomError ? (
          <button className="btn" type="button" onClick={() => onRetry()}>
            {t("chatRetry")}
          </button>
        ) : null}
      </div>
      <p className="lede">{t("chatCopyHelper")}</p>
      {peer ? <p>{t("chatPeerConnected")}</p> : null}
      <div className="field">
        <label htmlFor="chat-peer">{t("chatPeerLabel")}</label>
        <input
          id="chat-peer"
          ref={peerRef}
          value={draftPeer}
          onChange={(e) => setDraftPeer(e.target.value)}
          autoComplete="off"
        />
      </div>
      <p className="lede">{t("chatPeerHelper")}</p>
      {inline ? <p className="err">{inline}</p> : null}
      <div className="row">
        <button className="btn" type="button" disabled={!address} onClick={() => connect()}>
          {t("chatConnect")}
        </button>
      </div>
      <div className="chat-log">
        {messages.length === 0 ? <p className="lede">{t("chatEmptyLede")}</p> : null}
        {messages.map((msg) =>
          msg.direction === "system" ? (
            <p key={msg.id} className="chat-system">
              {systemText(msg.code, msg.body ?? "", t)}
            </p>
          ) : (
            <article key={msg.id} className={`glass chat-bubble ${msg.direction}`}>
              <header>
                <span>{msg.direction === "out" ? t("chatYou") : t("chatPeerName")}</span>
                <time>{stamp(msg.at)}</time>
              </header>
              <BubbleBody
                msg={msg}
                caps={caps}
                open={openMessage?.id === msg.id}
                left={viewer?.id === msg.id ? viewer.left : null}
                onOpen={() => openBurn(msg)}
                onClose={() => closeViewer(msg.id)}
                onSave={async () => {
                  await onSave?.(msg.id);
                  if (msg.burn && msg.direction === "in") {
                    await onDiscard?.(msg.id);
                  }
                }}
                onDelete={() => onDiscard?.(msg.id)}
              />
            </article>
          ),
        )}
        {transfers.map((tr) => (
          <p key={tr.id} className="chat-transfer">
            {tr.mode === "full" ? t("chatFullTransfer") : `${tr.offset} / ${tr.size}`}
            {tr.status === "error" ? (
              <>
                <span> {tr.error === "File failed verification." ? t("chatFileVerify") : t("chatUnreachable")}</span>
                <button className="btn" type="button" onClick={() => onResend?.(tr.id)}>
                  {t("chatResend")}
                </button>
              </>
            ) : null}
          </p>
        ))}
      </div>
      <div className="field">
        <label htmlFor="chat-burn">{t("chatBurnLabel")}</label>
        <select id="chat-burn" value={burnMode} onChange={(e) => setBurnMode(e.target.value)}>
          <option value="off">{t("chatBurnOff")}</option>
          <option value="0">{t("chatBurnUntilClosed")}</option>
          <option value="5">{t("chatBurn5")}</option>
          <option value="30">{t("chatBurn30")}</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="chat-composer">{t("chatMessageLabel")}</label>
        <textarea id="chat-composer" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onComposerKey} />
      </div>
      {notice ? <p>{notice}</p> : null}
      <div className="row">
        <button className="btn" type="button" onClick={() => attach()}>
          {t("chatAttach")}
        </button>
        <button className="btn" type="button" onClick={() => send()}>
          {t("send")}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        aria-label={t("chatAttachFile")}
        style={{ display: "none" }}
        onChange={(e) => void onPicked(e)}
      />
    </section>
  );
}

function BubbleBody({
  msg,
  caps,
  open,
  left,
  onOpen,
  onClose,
  onSave,
  onDelete,
}: {
  msg: ChatMessage;
  caps: string[];
  open: boolean;
  left: number | null;
  onOpen: () => void;
  onClose: () => Promise<void>;
  onSave: () => Promise<void>;
  onDelete: () => Promise<void> | void;
}) {
  const { t } = useI18n();
  const inboundBurn = msg.burn && msg.direction === "in";
  const image = (msg.mime ?? "").startsWith("image/");
  if (msg.type === "text" && !inboundBurn) {
    return (
      <>
        <p>{msg.body}</p>
        {msg.burn && msg.direction === "out" ? <BurnBadge caps={caps} onDelete={onDelete} /> : null}
      </>
    );
  }
  if (inboundBurn && !open) {
    return (
      <div className="chat-actions">
        <span>{t("chatBurnCollapsed")}</span>
        {msg.type === "text" ? (
          <button className="btn" type="button" onClick={onOpen}>
            {t("chatReveal")}
          </button>
        ) : (
          <>
            <button className="btn" type="button" onClick={onOpen}>
              {t("chatPreview")}
            </button>
            {msg.type === "file" ? (
              <>
                <p>{t("chatSavingKeeps")}</p>
                <button className="btn" type="button" onClick={() => void onSave()}>
                  {t("chatSave")}
                </button>
              </>
            ) : null}
          </>
        )}
      </div>
    );
  }
  if (inboundBurn && open) {
    return (
      <div className="chat-viewer">
        {msg.type === "text" ? <p>{msg.body}</p> : null}
        {msg.type === "file" && image && msg.preview ? <img alt={msg.name || ""} src={msg.preview} /> : null}
        {msg.type === "file" && !image ? (
          <p className="chat-file-meta">
            {msg.name} · {msg.size ?? 0}
          </p>
        ) : null}
        {msg.type === "file" ? <p>{t("chatSavingKeeps")}</p> : null}
        {left != null ? <p>{left}</p> : null}
        <div className="chat-actions">
          {msg.type === "file" ? (
            <button className="btn" type="button" onClick={() => void onSave()}>
              {t("chatSave")}
            </button>
          ) : null}
          <button className="btn" type="button" onClick={() => void onClose()}>
            {t("chatClose")}
          </button>
        </div>
      </div>
    );
  }
  if (msg.type === "file") {
    return (
      <div className="chat-file">
        {image && msg.preview ? <img alt={msg.name || ""} src={msg.preview} /> : null}
        <p className="chat-file-meta">
          {msg.name} · {msg.size ?? 0}
        </p>
        {!image ? (
          <button className="btn" type="button" onClick={() => void onSave()}>
            {t("chatDownload")}
          </button>
        ) : null}
        {msg.burn && msg.direction === "out" ? <BurnBadge caps={caps} onDelete={onDelete} /> : null}
      </div>
    );
  }
  return <p>{msg.body}</p>;
}

function BurnBadge({ caps, onDelete }: { caps: string[]; onDelete: () => Promise<void> | void }) {
  const { t } = useI18n();
  return (
    <div className="chat-actions">
      <p className="chat-badge">{caps.includes("burn") ? t("chatBurnRemoved") : t("chatBurnKept")}</p>
      <button className="btn" type="button" onClick={() => void onDelete()}>
        {t("chatDelete")}
      </button>
    </div>
  );
}
