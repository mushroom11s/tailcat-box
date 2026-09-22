import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { ClipboardSetText, OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
import VoiceNote from "../components/VoiceNote";
import { useI18n } from "../i18n";
import { localizeChatError, systemText } from "../lib/chatText";
import { createLiveCall, type CallMode, type CallView, type LiveCall, type LiveDevices } from "../lib/liveCall";
import { startVoiceCapture, type VoiceCapture } from "../lib/voiceCapture";
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
  duration?: number;
  audio?: string;
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
  onSendVoice?: (mime: string, durationSec: number, audio: Uint8Array, burn: boolean, ttlSec: number) => Promise<void>;
  startCapture?: () => Promise<VoiceCapture>;
  canPlayMime?: (mime: string) => boolean;
  decodeVoice?: (mime: string, audio: string) => Promise<string | null>;
  onSendPath?: (path: string, burn: boolean, ttlSec: number) => Promise<string>;
  onSendBrowserFile?: (file: File, burn: boolean, ttlSec: number) => Promise<string>;
  onDiscard?: (id: string) => Promise<void>;
  onResend?: (id: string) => Promise<void>;
  onSave?: (id: string) => Promise<void>;
  onRetry: () => Promise<void>;
  onSendSignal?: (metaJSON: string) => Promise<void>;
  incomingSignal?: { seq: number; data: string } | null;
  liveMedia?: LiveDevices;
  peerConnection?: new (config?: RTCConfiguration) => RTCPeerConnection;
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

function burnChoice(on: boolean): { burn: boolean; ttl: number } {
  if (on) {
    return { burn: true, ttl: 0 };
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
  onSendVoice,
  startCapture,
  canPlayMime,
  decodeVoice,
  onSendPath,
  onSendBrowserFile,
  onDiscard,
  onResend,
  onSave,
  onRetry,
  onSendSignal,
  incomingSignal,
  liveMedia,
  peerConnection,
}: Props) {
  const { t } = useI18n();
  const peerRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const burnRef = useRef(false);
  const [draftPeer, setDraftPeer] = useState("");
  const [draft, setDraft] = useState("");
  const [inline, setInline] = useState("");
  const [notice, setNotice] = useState("");
  const [burnOn, setBurnOn] = useState(false);
  const [viewer, setViewer] = useState<{ id: string; left: number | null } | null>(null);
  const [recording, setRecording] = useState(false);
  const [multiSelectActive, setMultiSelectActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const captureRef = useRef<VoiceCapture | null>(null);
  const holdRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const stopEarlyRef = useRef(false);
  const recordSource = useRef<"button" | "enter" | null>(null);
  const liveMediaRef = useRef(liveMedia);
  const peerCtorRef = useRef(peerConnection);
  const sendSignalRef = useRef(onSendSignal);
  const signalSeq = useRef(0);
  liveMediaRef.current = liveMedia;
  peerCtorRef.current = peerConnection;
  sendSignalRef.current = onSendSignal;
  const callRef = useRef<LiveCall | null>(null);
  const [callView, setCallView] = useState<CallView>({
    phase: "idle",
    mode: null,
    role: null,
    expanded: false,
    error: "",
    localStream: null,
    remoteStream: null,
  });
  if (!callRef.current) {
    callRef.current = createLiveCall({
      send: (meta) => {
        const send = sendSignalRef.current;
        if (!send) {
          throw new Error("no peer");
        }
        return send(JSON.stringify(meta));
      },
      devices: () => liveMediaRef.current,
      PeerConnection: () => peerCtorRef.current ?? RTCPeerConnection,
      onChange: setCallView,
    });
  }
  burnRef.current = burnOn;

  function fillN(template: string, n: number): string {
    return template.replaceAll("{n}", String(n));
  }

  function exitMultiSelect(): void {
    setMultiSelectActive(false);
    setSelectedIds(new Set());
    setConfirmOpen(false);
  }

  function applySelection(next: Set<string>): void {
    if (next.size === 0) {
      exitMultiSelect();
      return;
    }
    setMultiSelectActive(true);
    setSelectedIds(next);
  }

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
      if (confirmOpen || multiSelectActive) {
        return;
      }
      void onDiscard?.(viewer.id);
      setViewer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, onDiscard, confirmOpen, multiSelectActive]);

  useEffect(() => {
    if (import.meta.env.MODE !== "test") {
      return;
    }
    function onSeed(ev: Event): void {
      const detail = (ev as CustomEvent<{ ids: string[] }>).detail;
      const ids = detail?.ids ?? [];
      if (ids.length === 0) {
        setMultiSelectActive(false);
        setSelectedIds(new Set());
        setConfirmOpen(false);
        return;
      }
      setMultiSelectActive(true);
      setSelectedIds(new Set(ids));
    }
    window.addEventListener("tailcat-test-select", onSeed);
    return () => window.removeEventListener("tailcat-test-select", onSeed);
  }, []);

  useEffect(() => {
    if (!multiSelectActive) {
      return;
    }
    function onKey(ev: KeyboardEvent): void {
      if (ev.key !== "Escape") {
        return;
      }
      if (confirmOpen) {
        setConfirmOpen(false);
        return;
      }
      setMultiSelectActive(false);
      setSelectedIds(new Set());
      setConfirmOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [multiSelectActive, confirmOpen]);

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
    const choice = burnChoice(burnOn);
    try {
      await onSend(body, choice.burn, choice.ttl);
      setDraft("");
    } catch {
      setDraft(body);
    }
  }

  useEffect(() => {
    return () => {
      if (holdRef.current != null) {
        window.clearTimeout(holdRef.current);
      }
      void captureRef.current?.stop();
      captureRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!incomingSignal || incomingSignal.seq === signalSeq.current) {
      return;
    }
    signalSeq.current = incomingSignal.seq;
    void callRef.current?.receive(incomingSignal.data);
  }, [incomingSignal]);

  useEffect(() => {
    const call = callRef.current;
    return () => {
      void call?.hangup();
    };
  }, []);

  async function placeCall(mode: CallMode): Promise<void> {
    if (!peer) {
      peerRef.current?.focus();
      return;
    }
    await callRef.current?.start(mode);
  }

  async function beginRecording(source: "button" | "enter"): Promise<void> {
    if (pendingRef.current || captureRef.current) {
      return;
    }
    if (!peer) {
      peerRef.current?.focus();
      return;
    }
    pendingRef.current = true;
    stopEarlyRef.current = false;
    recordSource.current = source;
    try {
      const capture = await (startCapture ?? startVoiceCapture)();
      if (stopEarlyRef.current) {
        await capture.stop();
        recordSource.current = null;
        return;
      }
      captureRef.current = capture;
      setRecording(true);
    } catch (err) {
      recordSource.current = null;
      const message = err instanceof Error ? err.message : String(err);
      setInline(localizeChatError(message, t) || message);
    } finally {
      pendingRef.current = false;
    }
  }

  async function finishRecording(): Promise<void> {
    const capture = captureRef.current;
    captureRef.current = null;
    recordSource.current = null;
    setRecording(false);
    if (!capture) {
      return;
    }
    try {
      const take = await capture.stop();
      if (take.audio.length === 0) {
        return;
      }
      const choice = burnChoice(burnRef.current);
      await onSendVoice?.(take.mime, take.durationSec, take.audio, choice.burn, choice.ttl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setInline(localizeChatError(message, t) || message);
    }
  }

  function requestStop(): void {
    if (pendingRef.current && !captureRef.current) {
      stopEarlyRef.current = true;
      return;
    }
    void finishRecording();
  }

  function onComposerKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== "Enter" || e.shiftKey) {
      return;
    }
    e.preventDefault();
    if (e.repeat) {
      return;
    }
    if (draft.trim()) {
      void send();
      return;
    }
    if (holdRef.current != null) {
      return;
    }
    holdRef.current = window.setTimeout(() => {
      holdRef.current = null;
      void beginRecording("enter");
    }, 100);
  }

  function onComposerKeyUp(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== "Enter" || e.shiftKey) {
      return;
    }
    if (holdRef.current != null) {
      window.clearTimeout(holdRef.current);
      holdRef.current = null;
      return;
    }
    if (recordSource.current === "enter") {
      requestStop();
    }
  }

  function onMicDown(e: PointerEvent<HTMLButtonElement> | ReactMouseEvent<HTMLButtonElement>): void {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    if ("pointerId" in e) {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is unavailable in some test environments.
      }
    }
    void beginRecording("button");
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
      <div className="chat-stage">
      <div className="chat-transcript-column">
      {selectedIds.size >= 1 ? (
        <div
          className="chat-select-bar"
          role="toolbar"
          aria-label={fillN(t("chatSelectCount"), selectedIds.size)}
        >
          <span>{fillN(t("chatSelectCount"), selectedIds.size)}</span>
          <button className="btn" type="button" onClick={() => setConfirmOpen(true)}>
            {t("chatSelectDelete")}
          </button>
          <button className="btn" type="button" onClick={() => exitMultiSelect()}>
            {t("chatSelectClose")}
          </button>
        </div>
      ) : null}
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
                canPlayMime={canPlayMime}
                decodeVoice={decodeVoice}
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
      </div>
      {callView.phase !== "idle" ? (
        <aside className={`glass media-dock${callView.expanded ? " expanded" : ""}`} role="complementary" aria-label={t("chatMediaDock")}>
          <MediaPreview label={t("chatLocalPreview")} stream={callView.localStream} muted />
          <MediaPreview label={t("chatRemoteMedia")} stream={callView.remoteStream} />
          <div className="row">
            <button className="btn" type="button" onClick={() => void callRef.current?.hangup()}>
              {t("chatHangUp")}
            </button>
            <button
              className="btn"
              type="button"
              aria-expanded={callView.expanded}
              onClick={() => callRef.current?.toggleExpanded()}
            >
              {callView.expanded ? t("chatCollapse") : t("chatExpand")}
            </button>
          </div>
        </aside>
      ) : null}
      </div>
      <div className="field">
        <label htmlFor="chat-composer">{t("chatMessageLabel")}</label>
        <textarea
          id="chat-composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onComposerKey}
          onKeyUp={onComposerKeyUp}
        />
      </div>
      {notice ? <p>{notice}</p> : null}
      {callView.error ? <p className="err">{localizeChatError(callView.error, t) || callView.error}</p> : null}
      <div className="row composer-actions">
        <IconButton label={t("chatAttach")} onClick={() => void attach()}>
          <ClipIcon />
        </IconButton>
        <IconButton
          label={recording ? t("chatRecording") : t("chatRecord")}
          pressed={recording}
          onPointerDown={onMicDown}
          onMouseDown={onMicDown}
          onPointerUp={() => requestStop()}
          onMouseUp={() => requestStop()}
          onPointerCancel={() => requestStop()}
        >
          <MicIcon />
        </IconButton>
        <IconButton label={t("chatCallVoice")} onClick={() => void placeCall("voice")}>
          <PhoneIcon />
        </IconButton>
        <IconButton label={t("chatCallVideo")} onClick={() => void placeCall("video")}>
          <VideoIcon />
        </IconButton>
        <IconButton label={t("chatCallScreen")} onClick={() => void placeCall("screen")}>
          <ScreenIcon />
        </IconButton>
        <label className="burn-switch" htmlFor="chat-burn">
          <span>{t("chatBurnLabel")}</span>
          <input
            id="chat-burn"
            className="switch"
            type="checkbox"
            role="switch"
            checked={burnOn}
            aria-checked={burnOn}
            onChange={(e) => setBurnOn(e.target.checked)}
          />
        </label>
        <button className="btn composer-send" type="button" onClick={() => void send()}>
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

function MediaPreview({ label, stream, muted }: { label: string; stream: MediaStream | null; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const showVideo = Boolean(stream && stream.getVideoTracks().length > 0);
  useEffect(() => {
    const el = showVideo ? videoRef.current : audioRef.current;
    if (!el) {
      return;
    }
    try {
      el.srcObject = stream;
    } catch {
      // Test doubles are not DOM media streams.
    }
  }, [showVideo, stream]);
  return (
    <div className="media-slot">
      <p>{label}</p>
      {showVideo ? (
        <video ref={videoRef as RefObject<HTMLVideoElement>} autoPlay muted={muted} playsInline />
      ) : (
        <audio ref={audioRef as RefObject<HTMLAudioElement>} autoPlay muted={muted} />
      )}
    </div>
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
  canPlayMime,
  decodeVoice,
}: {
  msg: ChatMessage;
  caps: string[];
  open: boolean;
  left: number | null;
  onOpen: () => void;
  onClose: () => Promise<void>;
  onSave: () => Promise<void>;
  onDelete: () => Promise<void> | void;
  canPlayMime?: (mime: string) => boolean;
  decodeVoice?: (mime: string, audio: string) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const inboundBurn = msg.burn && msg.direction === "in";
  const image = (msg.mime ?? "").startsWith("image/");
  if (msg.type === "voice") {
    if (inboundBurn && !open) {
      return (
        <div className="chat-actions">
          <span>{t("chatBurnCollapsed")}</span>
          <button className="btn" type="button" onClick={onOpen}>
            {t("chatPlay")}
          </button>
        </div>
      );
    }
    return (
      <>
        <VoiceNote
          mime={msg.mime ?? ""}
          audio={msg.audio ?? ""}
          autoPlay={msg.direction === "in"}
          onEnded={() => {
            if (inboundBurn && !msg.ttlSec) {
              void onClose();
            }
          }}
          canPlayMime={canPlayMime}
          decodeVoice={decodeVoice}
        />
        {open && left != null ? <p>{left}</p> : null}
        {open ? (
          <div className="chat-actions">
            <button className="btn" type="button" onClick={() => void onClose()}>
              {t("chatClose")}
            </button>
          </div>
        ) : null}
        {msg.burn && msg.direction === "out" ? <BurnBadge caps={caps} onDelete={onDelete} /> : null}
      </>
    );
  }
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

function IconButton({
  label,
  pressed,
  onClick,
  onPointerDown,
  onMouseDown,
  onPointerUp,
  onMouseUp,
  onPointerCancel,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick?: () => void;
  onPointerDown?: (e: PointerEvent<HTMLButtonElement>) => void;
  onMouseDown?: (e: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerUp?: () => void;
  onMouseUp?: () => void;
  onPointerCancel?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className="btn icon-btn"
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onMouseDown={onMouseDown}
      onPointerUp={onPointerUp}
      onMouseUp={onMouseUp}
      onPointerCancel={onPointerCancel}
    >
      {children}
    </button>
  );
}

function StrokeIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

function ClipIcon() {
  return <StrokeIcon d="M16.5 7.5 10 14a2.5 2.5 0 0 1-3.5-3.5l7-7a4 4 0 0 1 5.7 5.7l-7.2 7.2a5.5 5.5 0 0 1-7.8-7.8L12 2.5" />;
}

function MicIcon() {
  return <StrokeIcon d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" />;
}

function PhoneIcon() {
  return <StrokeIcon d="M7 3h3l2 5-2.2 1.2a12 12 0 0 0 5 5L16 12l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 5 5a2 2 0 0 1 2-2z" />;
}

function VideoIcon() {
  return <StrokeIcon d="M3 8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8zM15 10.5 21 7v10l-6-3.5z" />;
}

function ScreenIcon() {
  return <StrokeIcon d="M3 5h18v12H3zM8 21h8M12 17v4" />;
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
