import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { ClipboardSetText, OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
import VoiceNote from "../components/VoiceNote";
import iconUrl from "../assets/icon.png";
import { useI18n } from "../i18n";
import { localizeChatError, systemText } from "../lib/chatText";
import { purgeDiscardIds } from "../lib/chatPurge";
import { createLiveCall, type CallMode, type CallView, type LiveCall, type LiveDevices } from "../lib/liveCall";
import { startVoiceCapture, type VoiceCapture } from "../lib/voiceCapture";
import { displayNickname } from "../lib/nickname";
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
  initialPeerDraft?: string;
  initialComposer?: string;
  initialBurn?: boolean;
  onRoomDraft?: (draft: { peer: string; composer: string; burn: boolean }) => void;
  onSendSignal?: (metaJSON: string) => Promise<void>;
  incomingSignal?: { seq: number; data: string } | null;
  liveMedia?: LiveDevices;
  peerConnection?: new (config?: RTCConfiguration) => RTCPeerConnection;
  nickname?: string;
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

const DISSOLVE_MS = 480;

type PendingOut = {
  baseline: string[];
  msg: ChatMessage;
};

function pendingLanded(item: PendingOut, list: readonly ChatMessage[]): boolean {
  const baseline = new Set(item.baseline);
  return list.some(
    (msg) =>
      !baseline.has(msg.id) &&
      msg.direction === "out" &&
      msg.type === "text" &&
      msg.body === item.msg.body &&
      Boolean(msg.burn) === Boolean(item.msg.burn),
  );
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
  initialPeerDraft,
  initialComposer,
  initialBurn,
  onRoomDraft,
  onSendSignal,
  incomingSignal,
  liveMedia,
  peerConnection,
  nickname = "",
}: Props) {
  const { t } = useI18n();
  const ownLabel = displayNickname(nickname) || t("chatYou");
  const peerRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const burnRef = useRef(false);
  const [draftPeer, setDraftPeer] = useState(initialPeerDraft ?? "");
  const [draft, setDraft] = useState(initialComposer ?? "");
  const [inline, setInline] = useState("");
  const [notice, setNotice] = useState("");
  const [burnOn, setBurnOn] = useState(initialBurn ?? false);
  const draftSink = useRef(onRoomDraft);
  draftSink.current = onRoomDraft;
  useEffect(() => {
    draftSink.current?.({ peer: draftPeer, composer: draft, burn: burnOn });
  }, [draftPeer, draft, burnOn]);
  const [viewer, setViewer] = useState<{ id: string; left: number | null } | null>(null);
  const [recording, setRecording] = useState(false);
  const [multiSelectActive, setMultiSelectActive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<PendingOut[]>([]);
  const [dissolving, setDissolving] = useState<Set<string>>(() => new Set());
  const sendingRef = useRef(false);
  const dissolvingRef = useRef(new Set<string>());
  const captureRef = useRef<VoiceCapture | null>(null);
  const holdRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const stopEarlyRef = useRef(false);
  const recordSource = useRef<"button" | "enter" | null>(null);
  const liveMediaRef = useRef(liveMedia);
  const peerCtorRef = useRef(peerConnection);
  const sendSignalRef = useRef(onSendSignal);
  const signalSeq = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const dragRectEl = useRef<HTMLDivElement>(null);
  const bubbleEls = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    originX: number;
    originY: number;
  } | null>(null);
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

  const DRAG_THRESHOLD = 4;

  function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    return Boolean(target.closest("a, button, input, textarea, select, [role='button']"));
  }

  function rectsIntersect(
    a: { left: number; top: number; width: number; height: number },
    b: { left: number; top: number; width: number; height: number },
  ): boolean {
    const ar = { left: a.left, top: a.top, right: a.left + a.width, bottom: a.top + a.height };
    const br = { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height };
    return !(ar.right < br.left || ar.left > br.right || ar.bottom < br.top || ar.top > br.bottom);
  }

  function paintDragRect(left: number, top: number, width: number, height: number): void {
    const el = dragRectEl.current;
    if (!el) {
      return;
    }
    el.hidden = false;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }

  function clearDragRect(): void {
    const el = dragRectEl.current;
    if (!el) {
      return;
    }
    el.hidden = true;
  }

  function onLogPointerDown(ev: PointerEvent<HTMLDivElement>): void {
    if (ev.button !== 0 || isInteractiveTarget(ev.target)) {
      return;
    }
    // Once multi-select is active, bubble presses are click-toggles — do not start a new drag.
    if (multiSelectActive && ev.target instanceof Element && ev.target.closest(".chat-bubble")) {
      return;
    }
    const log = logRef.current;
    if (!log) {
      return;
    }
    const box = log.getBoundingClientRect();
    dragRef.current = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      active: false,
      originX: box.left,
      originY: box.top,
    };
    log.setPointerCapture?.(ev.pointerId);
  }

  function onLogPointerMove(ev: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== ev.pointerId) {
      return;
    }
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    if (!drag.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }
    drag.active = true;
    const log = logRef.current;
    const left = Math.min(drag.startX, ev.clientX) - drag.originX + (log?.scrollLeft ?? 0);
    const top = Math.min(drag.startY, ev.clientY) - drag.originY + (log?.scrollTop ?? 0);
    paintDragRect(left, top, Math.abs(dx), Math.abs(dy));
  }

  function onLogPointerUp(ev: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    dragRef.current = null;
    clearDragRect();
    if (!drag || drag.pointerId !== ev.pointerId) {
      return;
    }
    if (!drag.active) {
      return;
    }
    const left = Math.min(drag.startX, ev.clientX) - drag.originX;
    const top = Math.min(drag.startY, ev.clientY) - drag.originY;
    const width = Math.abs(ev.clientX - drag.startX);
    const height = Math.abs(ev.clientY - drag.startY);
    const local = { left, top, width, height };
    const hit = new Set<string>();
    const visible = [
      ...messages,
      ...pending.filter((item) => !pendingLanded(item, messages)).map((item) => item.msg),
    ];
    for (const msg of visible) {
      if (msg.direction === "system") {
        continue;
      }
      const el = bubbleEls.current.get(msg.id);
      if (!el) {
        continue;
      }
      const br = el.getBoundingClientRect();
      const rel = {
        left: br.left - drag.originX,
        top: br.top - drag.originY,
        width: br.width,
        height: br.height,
      };
      if (rectsIntersect(local, rel)) {
        hit.add(msg.id);
      }
    }
    if (hit.size === 0) {
      return;
    }
    applySelection(hit);
  }

  async function confirmDelete(): Promise<void> {
    const selectedSnapshot = new Set(selectedIds);
    const ids = purgeDiscardIds(messages, selectedSnapshot);
    setConfirmOpen(false);
    const remaining = new Set(selectedSnapshot);
    let failed = false;
    for (const id of ids) {
      try {
        await onDiscard?.(id);
        remaining.delete(id);
      } catch {
        failed = true;
        break;
      }
    }
    if (failed) {
      setInline(t("chatSelectDeleteError"));
      applySelection(remaining);
      return;
    }
    exitMultiSelect();
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

  useEffect(() => {
    setPending((prev) => {
      const next = prev.filter((item) => !pendingLanded(item, messages));
      return next.length === prev.length ? prev : next;
    });
  }, [messages]);

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
        void finishBurn(messageID);
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
      void finishBurn(viewer.id);
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
    function onKey(ev: globalThis.KeyboardEvent): void {
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
    if (sendingRef.current) {
      return;
    }
    const body = draft;
    if (!body.trim()) {
      return;
    }
    if (!peer) {
      peerRef.current?.focus();
      return;
    }
    sendingRef.current = true;
    setSending(true);
    const choice = burnChoice(burnOn);
    const item: PendingOut = {
      baseline: messages.map((msg) => msg.id),
      msg: {
        id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        direction: "out",
        type: "text",
        body,
        at: new Date().toISOString(),
        burn: choice.burn,
        ttlSec: choice.ttl,
      },
    };
    setPending((prev) => [...prev, item]);
    setDraft("");
    try {
      await onSend(body, choice.burn, choice.ttl);
    } catch {
      setPending((prev) => prev.filter((entry) => entry.msg.id !== item.msg.id));
      setDraft((current) => (current.trim() ? current : body));
    } finally {
      sendingRef.current = false;
      setSending(false);
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
    if (e.repeat || sendingRef.current) {
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
    if (dissolvingRef.current.has(msg.id)) {
      return;
    }
    setViewer({ id: msg.id, left: msg.ttlSec && msg.ttlSec > 0 ? msg.ttlSec : null });
  }

  async function finishBurn(id: string): Promise<void> {
    if (dissolvingRef.current.has(id)) {
      return;
    }
    dissolvingRef.current.add(id);
    setDissolving(new Set(dissolvingRef.current));
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, DISSOLVE_MS);
    });
    setViewer((current) => (current?.id === id ? null : current));
    try {
      await onDiscard?.(id);
    } finally {
      dissolvingRef.current.delete(id);
      setDissolving(new Set(dissolvingRef.current));
    }
  }

  function toggleSelected(id: string): void {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    applySelection(next);
  }

  const openMessage = viewer ? messages.find((msg) => msg.id === viewer.id) : undefined;
  const transcript = [
    ...messages,
    ...pending.filter((item) => !pendingLanded(item, messages)).map((item) => item.msg),
  ];

  function sideActions(msg: ChatMessage): ReactNode {
    const inboundBurn = Boolean(msg.burn && msg.direction === "in");
    const sealed = inboundBurn && openMessage?.id !== msg.id;
    const actions: ReactNode[] = [];
    if (sealed) {
      const label = msg.type === "voice" ? t("chatPlay") : msg.type === "text" ? t("chatReveal") : t("chatPreview");
      actions.push(
        <button
          key="view"
          className="chat-outside-action"
          type="button"
          aria-label={label}
          title={label}
          onClick={() => openBurn(msg)}
        >
          <EyeIcon />
        </button>,
      );
    }
    if (msg.type === "file") {
      const label = inboundBurn ? t("chatSave") : t("chatDownload");
      actions.push(
        <button
          key="save"
          className="chat-outside-action"
          type="button"
          aria-label={label}
          title={inboundBurn ? t("chatSavingKeeps") : label}
          onClick={() => {
            void (async () => {
              await onSave?.(msg.id);
              if (inboundBurn) {
                await finishBurn(msg.id);
              }
            })();
          }}
        >
          <DownloadIcon />
        </button>,
      );
      if (inboundBurn) {
        actions.push(
          <p key="keep" className="chat-side-note">
            {t("chatSavingKeeps")}
          </p>,
        );
      }
    }
    if (actions.length === 0) {
      return null;
    }
    return <div className="chat-outside-actions">{actions}</div>;
  }

  return (
    <section className="page chat-page">
      <div className="chat-layout">
      <div className="chat-main">
      <div className="glass chat-identity">
        <div className="chat-room-bar">
          <span className={`status-dot${roomError ? " bad" : ""}`} aria-hidden="true" />
          <span className="chat-kicker">{t("chatRoomLabel")}</span>
          {roomError ? <span className="err">{roomError}</span> : <span className="status-pill">{t("chatListening")}</span>}
          {address ? <p className="chat-address">{address}</p> : null}
          <button className="btn btn-ghost" type="button" disabled={!address} onClick={() => copyText(address)}>
            {t("copy")}
          </button>
          {roomError ? (
            <button className="btn" type="button" onClick={() => onRetry()}>
              {t("chatRetry")}
            </button>
          ) : null}
        </div>
        <p className="chat-quiet chat-help">{t("chatCopyHelper")}</p>
        <div className="chat-peer-bar">
          <label htmlFor="chat-peer"><LockIcon />{t("chatPeerLabel")}</label>
          <input
            id="chat-peer"
            ref={peerRef}
            value={draftPeer}
            onChange={(e) => setDraftPeer(e.target.value)}
            autoComplete="off"
          />
          {peer ? <span className="status-dot" aria-hidden="true" /> : null}
          <button className="btn" type="button" disabled={!address} onClick={() => connect()}>
            {t("chatConnect")}
          </button>
        </div>
        <p className="chat-quiet chat-help">
          {peer ? <span>{t("chatPeerConnected")}</span> : null}
          {peer ? " · " : null}
          {t("chatPeerHelper")}
        </p>
        {inline ? <p className="err">{inline}</p> : null}
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
          <IconButton label={t("chatSelectDelete")} onClick={() => setConfirmOpen(true)}>
            <TrashIcon />
          </IconButton>
          <IconButton label={t("chatSelectClose")} onClick={() => exitMultiSelect()}>
            <CloseIcon />
          </IconButton>
        </div>
      ) : null}
      <div
        className="chat-log"
        ref={logRef}
        onPointerDown={onLogPointerDown}
        onPointerMove={onLogPointerMove}
        onPointerUp={onLogPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
          clearDragRect();
        }}
        style={{ position: "relative" }}
      >
        <div ref={dragRectEl} className="chat-drag-rect" hidden />
        {transcript.length === 0 ? <p className="lede">{t("chatEmptyLede")}</p> : null}
        {transcript.map((msg) =>
          msg.direction === "system" ? (
            <p key={msg.id} className="chat-system">
              {systemText(msg.code, msg.body ?? "", t)}
            </p>
          ) : (
            <div
              key={msg.id}
              className={`chat-msg ${msg.direction}${multiSelectActive ? " selecting" : ""}${dissolving.has(msg.id) ? " dissolving" : ""}`}
            >
            {multiSelectActive ? (
              <button
                type="button"
                className="chat-select-check"
                role="checkbox"
                aria-checked={selectedIds.has(msg.id)}
                aria-label={t("chatSelectToggle")}
                onClick={() => toggleSelected(msg.id)}
              >
                {selectedIds.has(msg.id) ? <CheckIcon /> : null}
              </button>
            ) : null}
            {msg.direction === "in" ? <img className="chat-avatar" src={iconUrl} alt="" /> : null}
            <div className="chat-bubble-wrap">
            <article
              ref={(el) => {
                if (el) {
                  bubbleEls.current.set(msg.id, el);
                } else {
                  bubbleEls.current.delete(msg.id);
                }
              }}
              data-msgid={msg.id}
              className={`glass chat-bubble ${msg.direction}${selectedIds.has(msg.id) ? " selected" : ""}${msg.burn && msg.direction === "in" && openMessage?.id !== msg.id ? " burn-sealed" : ""}`}
              onClick={(ev) => {
                if (!multiSelectActive) {
                  return;
                }
                if (isInteractiveTarget(ev.target)) {
                  return;
                }
                ev.preventDefault();
                toggleSelected(msg.id);
              }}
            >
              <BubbleBody
                msg={msg}
                caps={caps}
                open={openMessage?.id === msg.id}
                left={viewer?.id === msg.id ? viewer.left : null}
                onClose={() => finishBurn(msg.id)}
                canPlayMime={canPlayMime}
                decodeVoice={decodeVoice}
              />
              <header>
                <span className="chat-who">{msg.direction === "out" ? ownLabel : t("chatPeerName")}</span>
                <time>{stamp(msg.at)}</time>
              </header>
              {msg.burn && msg.direction === "in" && openMessage?.id !== msg.id ? (
                <div className="chat-burn-mask" aria-hidden="true">
                  <FlameIcon />
                </div>
              ) : null}
            </article>
            {sideActions(msg)}
            </div>
            </div>
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
      </div>
      {notice ? <p className="chat-quiet">{notice}</p> : null}
      <div className="glass composer-bar">
        <label className="sr-only" htmlFor="chat-composer">{t("chatMessageLabel")}</label>
        <textarea
          id="chat-composer"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onComposerKey}
          onKeyUp={onComposerKeyUp}
        />
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
          <label className="burn-switch" htmlFor="chat-burn">
            <FlameIcon />
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
          <button className="btn composer-send" type="button" disabled={sending} onClick={() => void send()}>
            {t("send")}
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        aria-label={t("chatAttachFile")}
        style={{ display: "none" }}
        onChange={(e) => void onPicked(e)}
      />
      </div>
      <CallPanel
        phase={callView.phase}
        expanded={callView.expanded}
        error={callView.error ? localizeChatError(callView.error, t) || callView.error : ""}
        localStream={callView.localStream}
        remoteStream={callView.remoteStream}
        onVoice={() => void placeCall("voice")}
        onVideo={() => void placeCall("video")}
        onScreen={() => void placeCall("screen")}
        onHangup={() => void callRef.current?.hangup()}
        onToggleExpanded={() => callRef.current?.toggleExpanded()}
      />
      </div>
      {confirmOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setConfirmOpen(false)}>
          <div
            className="glass modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-select-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="chat-select-delete-title">{t("chatSelectDelete")}</h3>
            <p>{fillN(t("chatSelectDeleteConfirm"), selectedIds.size)}</p>
            <div className="row">
              <button className="btn btn-ghost" type="button" onClick={() => setConfirmOpen(false)}>
                {t("cancel")}
              </button>
              <button className="btn btn-danger" type="button" onClick={() => void confirmDelete()}>
                {t("chatSelectDelete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CallPanel({
  phase,
  expanded,
  error,
  localStream,
  remoteStream,
  onVoice,
  onVideo,
  onScreen,
  onHangup,
  onToggleExpanded,
}: {
  phase: CallView["phase"];
  expanded: boolean;
  error: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  onVoice: () => void;
  onVideo: () => void;
  onScreen: () => void;
  onHangup: () => void;
  onToggleExpanded: () => void;
}) {
  const { t } = useI18n();
  const live = phase !== "idle";
  return (
    <aside
      className={`glass call-panel media-dock${expanded ? " expanded" : ""}`}
      role="complementary"
      aria-label={t("chatCallPanel")}
    >
      <h2 className="call-panel-title">{t("chatCallPanel")}</h2>
      <div className="call-panel-actions">
        <CallStartButton label={t("chatCallVoice")} onClick={onVoice}>
          <PhoneIcon />
        </CallStartButton>
        <CallStartButton label={t("chatCallVideo")} onClick={onVideo}>
          <VideoIcon />
        </CallStartButton>
        <CallStartButton label={t("chatCallScreen")} onClick={onScreen}>
          <ScreenIcon />
        </CallStartButton>
      </div>
      {live ? (
        <div className="call-panel-live" role="group" aria-label={t("chatMediaDock")}>
          <MediaPreview label={t("chatLocalPreview")} stream={localStream} muted />
          <MediaPreview label={t("chatRemoteMedia")} stream={remoteStream} />
          <div className="row">
            <button className="btn" type="button" onClick={onHangup}>
              {t("chatHangUp")}
            </button>
            <button className="btn" type="button" aria-expanded={expanded} onClick={onToggleExpanded}>
              {expanded ? t("chatCollapse") : t("chatExpand")}
            </button>
          </div>
        </div>
      ) : (
        <p className="chat-quiet call-panel-idle">{t("chatCallIdle")}</p>
      )}
      {error ? <p className="err">{error}</p> : null}
    </aside>
  );
}

function CallStartButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button className="btn btn-ghost call-start" type="button" onClick={onClick}>
      {children}
      <span>{label}</span>
    </button>
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
  onClose,
  canPlayMime,
  decodeVoice,
}: {
  msg: ChatMessage;
  caps: string[];
  open: boolean;
  left: number | null;
  onClose: () => Promise<void>;
  canPlayMime?: (mime: string) => boolean;
  decodeVoice?: (mime: string, audio: string) => Promise<string | null>;
}) {
  const { t } = useI18n();
  const inboundBurn = msg.burn && msg.direction === "in";
  const image = (msg.mime ?? "").startsWith("image/");
  if (inboundBurn && !open && msg.type !== "voice") {
    return <span className="chat-burn-label">{t("chatBurnCollapsed")}</span>;
  }
  if (msg.type === "voice") {
    if (inboundBurn && !open) {
      return <span className="chat-burn-label">{t("chatBurnCollapsed")}</span>;
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
        {msg.burn && msg.direction === "out" ? <BurnBadge caps={caps} /> : null}
      </>
    );
  }
  if (msg.type === "text" && !inboundBurn) {
    return (
      <>
        <p>{msg.body}</p>
        {msg.burn && msg.direction === "out" ? <BurnBadge caps={caps} /> : null}
      </>
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
        {left != null ? <p>{left}</p> : null}
        <div className="chat-actions">
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
        {msg.burn && msg.direction === "out" ? <BurnBadge caps={caps} /> : null}
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

function LockIcon() {
  return <StrokeIcon d="M8 11V8a4 4 0 0 1 8 0v3M7 11h10v9H7z" />;
}

function FlameIcon() {
  return <StrokeIcon d="M12 3s5 4.2 5 8.2A5 5 0 0 1 7 11.2C7 8.4 9.2 7 9.2 7S9.6 9 12 9c0-2.6 0-6 0-6z" />;
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function DownloadIcon() {
  return <StrokeIcon d="M12 4v11M8 11l4 4 4-4M5 20h14" />;
}

function CheckIcon() {
  return <StrokeIcon d="M5 12.5 9.2 17 19 7" />;
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

function TrashIcon() {
  return <StrokeIcon d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />;
}

function CloseIcon() {
  return <StrokeIcon d="M6 6l12 12M18 6 6 18" />;
}

function BurnBadge({ caps }: { caps: string[] }) {
  const { t } = useI18n();
  return (
    <div className="chat-actions">
      <p className="chat-badge">{caps.includes("burn") ? t("chatBurnRemoved") : t("chatBurnKept")}</p>
    </div>
  );
}
