import { useRef, useState, type KeyboardEvent } from "react";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { useI18n } from "../i18n";
import { localizeChatError, systemText } from "../lib/chatText";

export type ChatMessage = {
  id: string;
  direction: "in" | "out" | "system";
  type: string;
  code?: string;
  body: string;
  at: string;
};

type Props = {
  address: string;
  peer: string;
  messages: ChatMessage[];
  roomError: string;
  onConnect: (addr: string) => Promise<void>;
  onSend: (body: string) => Promise<void>;
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

export default function ChatPage({ address, peer, messages, roomError, onConnect, onSend, onRetry }: Props) {
  const { t } = useI18n();
  const peerRef = useRef<HTMLInputElement>(null);
  const [draftPeer, setDraftPeer] = useState("");
  const [draft, setDraft] = useState("");
  const [inline, setInline] = useState("");

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
    try {
      await onSend(body);
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

  return (
    <section className="page">
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
              {systemText(msg.code, msg.body, t)}
            </p>
          ) : (
            <article key={msg.id} className={`glass chat-bubble ${msg.direction}`}>
              <header>
                <span>{msg.direction === "out" ? t("chatYou") : t("chatPeerName")}</span>
                <time>{stamp(msg.at)}</time>
              </header>
              <p>{msg.body}</p>
            </article>
          ),
        )}
      </div>
      <div className="field">
        <label htmlFor="chat-composer">{t("chatMessageLabel")}</label>
        <textarea id="chat-composer" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onComposerKey} />
      </div>
      <div className="row">
        <button className="btn" type="button" onClick={() => send()}>
          {t("send")}
        </button>
      </div>
    </section>
  );
}
