import { useCallback, useEffect, useRef, useState } from "react";
import { ToastProvider, useToasts } from "./components/toasts";
import ChatPage, { type ChatMessage } from "./pages/ChatPage";
import LobbyPage from "./pages/LobbyPage";
import MiaoPage from "./pages/MiaoPage";
import SettingsPage from "./pages/SettingsPage";
import TunnelPage from "./pages/TunnelPage";
import { readMappings, toPortMapping, writeMappings, type PortMappingRecord } from "./lib/portMappings";
import { sameKeys, sameSessions } from "./lib/snapshot";
import { translate, useI18n } from "./i18n";
import iconUrl from "./assets/icon.png";
import { inboundAlertBody, inboundAlertTitle, isInboundAlert, readingOpenTranscript } from "./lib/chatNotify";
import { localizeChatError } from "./lib/chatText";
import { NICKNAME_KEY, readNickname } from "./lib/nickname";
import { ensureOsNotifications, sendOsNotification } from "./lib/osNotify";
import { applyRemark, readRemarks, writeRemarks, type RemarkMap } from "./lib/remark";
import { remarkIsShared, roomPrimaryLabel, roomTooltip } from "./lib/roomLabel";
import { applyRoomEvent, emptyRoom, type RoomSlice } from "./lib/roomState";
import {
  connectChatPeer,
  createKey,
  deleteKey,
  discardChatMessage,
  getNetworkSettings,
  getUpdateStatus,
  hasWailsBindings,
  listKeys,
  listSessions,
  onTailcatEvent,
  onTrayNavigate,
  onUpdateStatus,
  resendChatFile,
  restartChatRoom,
  saveChatFile,
  sendChatFile,
  sendChatFileBytes,
  sendChatSignal,
  sendChatText,
  sendChatVoice,
  setNetworkSettings,
  startChatRoom,
  startForward,
  startPing,
  startPortServe,
  stopChatRoom,
  stopSession,
  tailcatVersion,
  type KeyInfo,
  type Session,
  type TailcatEvent,
  type UpdateStatus,
} from "./lib/wails";

type Page = "miao" | "chat" | "tunnel" | "settings";
type Theme = "system" | "light" | "dark";

const THEME_KEY = "tailcat-theme";
const CHAT_KINDS = new Set(["room-ready", "peer", "message", "transfer", "discard"]);
const TUNNEL_KINDS = new Set(["port_serve", "forward"]);

const NAV: Array<{ id: Exclude<Page, "settings">; labelKey: "navChat" | "navTunnel" }> = [
  { id: "chat", labelKey: "navChat" },
  { id: "tunnel", labelKey: "navTunnel" },
];

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

function readTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

function AppShell() {
  const { t, locale } = useI18n();
  const { push } = useToasts();
  const pushRef = useRef(push);
  pushRef.current = push;
  const [page, setPageState] = useState<Page>("chat");
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [nickname, setNickname] = useState(() => readNickname());
  const [remarks, setRemarks] = useState<RemarkMap>(() => readRemarks());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [events, setEvents] = useState<TailcatEvent[]>([]);
  const [region, setRegion] = useState("");
  const [derpMapURL, setDerpMapURL] = useState("");
  const [version, setVersion] = useState("");
  const [rooms, setRooms] = useState<Record<string, RoomSlice>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [focus, setFocus] = useState("");
  const [lobby, setLobby] = useState(true);
  const [lobbyPeer, setLobbyPeer] = useState("");
  const [lobbyError, setLobbyError] = useState("");
  const [lobbyBusy, setLobbyBusy] = useState<"" | "temp" | "permanent" | "connect">("");
  const lobbyBusyRef = useRef<"" | "temp" | "permanent" | "connect">("");
  const [lobbyKey, setLobbyKey] = useState("");
  const [lobbyKeyDraft, setLobbyKeyDraft] = useState("");
  const [closeAsk, setCloseAsk] = useState("");
  const [mappings, setMappings] = useState<PortMappingRecord[]>(() => readMappings());
  const [links, setLinks] = useState<Record<string, string>>({});
  const [tunnelBusy, setTunnelBusy] = useState(false);
  const [liveSignal, setLiveSignal] = useState<{ seq: number; data: string } | null>(null);
  const [roomKey, setRoomKey] = useState("");
  const roomKeyRef = useRef("");
  const netRef = useRef({ region: "", derp: "" });
  const roomsRef = useRef(rooms);
  const mappingsRef = useRef(mappings);
  const linksRef = useRef(links);
  const tunnelBusyRef = useRef(false);
  const orderRef = useRef(order);
  const focusRef = useRef(focus);
  const lobbyRef = useRef(lobby);
  const pageRef = useRef(page);
  const pendingRef = useRef<TailcatEvent[]>([]);
  const localeRef = useRef(locale);
  const notifiedIds = useRef(new Set<string>());
  const appliedChatErr = useRef<Record<string, string>>({});
  const appliedTunnelErr = useRef<Record<string, string>>({});
  const [notifyDenied, setNotifyDenied] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateFocus, setUpdateFocus] = useState(0);
  netRef.current = { region, derp: derpMapURL };
  mappingsRef.current = mappings;
  linksRef.current = links;
  pageRef.current = page;
  localeRef.current = locale;
  const fallback = !hasWailsBindings();
  function setPage(next: Page): void {
    if (next !== "chat") {
      setLiveSignal(null);
    }
    pageRef.current = next;
    setPageState(next);
    setUpdateFocus(0);
  }

  function openUpdateSettings(): void {
    setLiveSignal(null);
    pageRef.current = "settings";
    setPageState("settings");
    setUpdateFocus((n) => n + 1);
  }

  function commitRooms(next: Record<string, RoomSlice>): void {
    roomsRef.current = next;
    setRooms(next);
  }

  function commitOrder(next: string[]): void {
    orderRef.current = next;
    setOrder(next);
  }

  function commitFocus(id: string): void {
    focusRef.current = id;
    setFocus(id);
  }

  function commitLobby(open: boolean): void {
    lobbyRef.current = open;
    setLobby(open);
  }

  function showError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    return localizeChatError(message, t) || message;
  }

  function pushError(message: string): void {
    const text = message.trim();
    if (text) {
      pushRef.current(text);
    }
  }

  function drain(id: string): TailcatEvent[] {
    const queued = pendingRef.current.filter((ev) => ev.SessionID === id);
    pendingRef.current = pendingRef.current.filter((ev) => ev.SessionID !== id);
    return queued;
  }

  function stampApplied(room: RoomSlice): RoomSlice {
    if (!room.address) {
      return room;
    }
    return {
      ...room,
      appliedKey: room.keyName,
      appliedRegion: netRef.current.region,
      appliedDERP: netRef.current.derp,
    };
  }

  function noteInbound(room: RoomSlice, ev: TailcatEvent): void {
    if (ev.Kind !== "message" || !ev.Data) {
      return;
    }
    let msg: ChatMessage;
    try {
      msg = JSON.parse(ev.Data) as ChatMessage;
    } catch {
      return;
    }
    if (!msg.id || !isInboundAlert(msg) || notifiedIds.current.has(msg.id)) {
      return;
    }
    notifiedIds.current.add(msg.id);
    const viewingThisRoom =
      pageRef.current === "chat" && !lobbyRef.current && focusRef.current === room.id;
    if (readingOpenTranscript(document, viewingThisRoom)) {
      return;
    }
    const loc = localeRef.current;
    const tr = (key: Parameters<typeof translate>[1]) => translate(loc, key);
    void sendOsNotification({
      id: msg.id,
      title: inboundAlertTitle(room.peer, tr("productName")),
      body: inboundAlertBody(msg, tr),
    }).then((result) => {
      if (result === "denied") {
        setNotifyDenied(true);
      }
    });
  }

  function adoptRoom(sess: Session, peerDraft: string, keyName = ""): void {
    let room = emptyRoom(sess.ID, peerDraft);
    room.keyName = keyName;
    room.address = sess.Address || "";
    room.error = sess.Err ? showError(sess.Err) : "";
    const queued = drain(sess.ID);
    for (const ev of queued) {
      room = applyRoomEvent(room, ev);
    }
    room = stampApplied(room);
    commitRooms({ ...roomsRef.current, [sess.ID]: room });
    commitOrder([sess.ID, ...orderRef.current.filter((item) => item !== sess.ID)]);
    commitFocus(sess.ID);
    commitLobby(false);
    for (const ev of queued) {
      noteInbound(room, ev);
    }
    roomKeyRef.current = keyName;
    setRoomKey(keyName);
    setLiveSignal(null);
    if (room.error) {
      pushError(room.error);
    }
  }

  function syncKey(id: string): void {
    const key = roomsRef.current[id]?.keyName ?? "";
    roomKeyRef.current = key;
    setRoomKey(key);
  }

  function openLobby(): void {
    setPage("chat");
    commitLobby(true);
    setLiveSignal(null);
  }

  function selectRoom(id: string): void {
    setPage("chat");
    commitLobby(false);
    commitFocus(id);
    syncKey(id);
    setLiveSignal(null);
  }

  function openChat(): void {
    setPage("chat");
    setLiveSignal(null);
    if (orderRef.current.length === 0) {
      commitLobby(true);
      return;
    }
    commitLobby(false);
    let id = focusRef.current;
    if (!id || !roomsRef.current[id]) {
      id = orderRef.current[0];
      commitFocus(id);
    }
    syncKey(id);
  }

  const refresh = useCallback(async () => {
    try {
      const nextSessions = await listSessions();
      const nextKeys = await listKeys();
      const net = await getNetworkSettings();
      const ver = await tailcatVersion();
      setSessions((prev) => (sameSessions(prev, nextSessions) ? prev : nextSessions));
      setKeys((prev) => (sameKeys(prev, nextKeys) ? prev : nextKeys));
      setRegion((prev) => (prev === net.Region ? prev : net.Region));
      setDerpMapURL((prev) => (prev === net.DERPMapURL ? prev : net.DERPMapURL));
      setVersion((prev) => (prev === ver ? prev : ver));
    } catch {
      // Session refresh keeps the last good snapshot.
    }
  }, []);

  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(NICKNAME_KEY, nickname);
  }, [nickname]);

  useEffect(() => {
    writeRemarks(remarks);
  }, [remarks]);

  useEffect(() => {
    writeMappings(mappings);
  }, [mappings]);

  useEffect(() => {
    const node = mainRef.current;
    if (!node) {
      return;
    }
    if (page === "settings" && updateFocus > 0) {
      try {
        document.getElementById("settings-update")?.scrollIntoView({ block: "center" });
      } catch {
        // The in-browser test DOM may not implement scrolling.
      }
      return;
    }
    node.scrollTop = 0;
  }, [page, updateFocus]);

  useEffect(() => {
    let revision = 0;
    const off = onUpdateStatus((status) => {
      revision += 1;
      setUpdateStatus(status);
    });
    const ticket = revision;
    void getUpdateStatus().then((status) => {
      if (revision === ticket) {
        setUpdateStatus(status);
      }
    });
    return off;
  }, []);

  useEffect(() => {
    return onTrayNavigate((next) => {
      if (next === "chat") {
        openChat();
      } else if (next === "tunnel" || next === "settings") {
        setPage(next);
      }
    });
  }, []);

  useEffect(() => {
    void ensureOsNotifications();
  }, []);

  useEffect(() => {
    void refresh();
    const off = onTailcatEvent((ev) => {
      setEvents((prev) => [...prev, ev]);
      const id = ev.SessionID;
      if (ev.Kind === "signal") {
        if (pageRef.current === "chat" && !lobbyRef.current && focusRef.current === id && ev.Data) {
          const data = ev.Data;
          setLiveSignal((prev) => ({ seq: (prev?.seq ?? 0) + 1, data }));
        }
        void refresh();
        return;
      }
      if (!id || !roomsRef.current[id]) {
        if (id && CHAT_KINDS.has(ev.Kind)) {
          pendingRef.current.push(ev);
        }
        void refresh();
        return;
      }
      let room = applyRoomEvent(roomsRef.current[id], ev);
      if (ev.Kind === "room-ready") {
        room = stampApplied(room);
      }
      commitRooms({ ...roomsRef.current, [id]: room });
      noteInbound(room, ev);
      void refresh();
    });
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const prevChat = appliedChatErr.current;
    const prevTunnel = appliedTunnelErr.current;
    const nextChat: Record<string, string> = {};
    const nextTunnel: Record<string, string> = {};
    const roomsNow = roomsRef.current;
    let changed = false;
    const nextRooms = { ...roomsNow };
    for (const sess of sessions) {
      const raw = (sess.Err || "").trim();
      if (sess.Kind === "chat") {
        if (!raw) {
          continue;
        }
        const room = nextRooms[sess.ID];
        if (!room) {
          continue;
        }
        nextChat[sess.ID] = raw;
        if (prevChat[sess.ID] === raw) {
          continue;
        }
        const message = localizeChatError(raw, (key) => translate(localeRef.current, key)) || raw;
        if (room.error !== message) {
          nextRooms[sess.ID] = { ...room, error: message };
          changed = true;
          pushRef.current(message);
        }
        continue;
      }
      if (!TUNNEL_KINDS.has(sess.Kind) || !raw) {
        continue;
      }
      nextTunnel[sess.ID] = raw;
      if (prevTunnel[sess.ID] !== raw) {
        pushRef.current(raw);
      }
    }
    appliedChatErr.current = nextChat;
    appliedTunnelErr.current = nextTunnel;
    if (changed) {
      roomsRef.current = nextRooms;
      setRooms(nextRooms);
    }
  }, [sessions]);

  useEffect(() => {
    if (!region && !derpMapURL) {
      return;
    }
    const prev = roomsRef.current;
    let changed = false;
    const next = { ...prev };
    for (const [id, room] of Object.entries(prev)) {
      if (room.address && room.appliedRegion === "" && room.appliedDERP === "" && (region !== "" || derpMapURL !== "")) {
        next[id] = { ...room, appliedRegion: region, appliedDERP: derpMapURL };
        changed = true;
      }
    }
    if (changed) {
      commitRooms(next);
    }
  }, [region, derpMapURL]);

  function claimLobby(action: "temp" | "permanent" | "connect"): boolean {
    if (lobbyBusyRef.current) {
      return false;
    }
    lobbyBusyRef.current = action;
    setLobbyBusy(action);
    setLobbyError("");
    return true;
  }

  function releaseLobby(): void {
    lobbyBusyRef.current = "";
    setLobbyBusy("");
  }

  async function createTemporary(): Promise<void> {
    if (!claimLobby("temp")) {
      return;
    }
    const draft = lobbyPeer;
    try {
      const sess = await startChatRoom("");
      adoptRoom(sess, draft, "");
      setLobbyPeer("");
      setPage("chat");
    } catch (err) {
      pushError(showError(err));
    } finally {
      releaseLobby();
    }
  }

  async function createPermanent(): Promise<void> {
    if (lobbyBusyRef.current) {
      return;
    }
    const name = lobbyKey.trim();
    if (!name) {
      setLobbyError(t("lobbyKeyRequired"));
      return;
    }
    if (!claimLobby("permanent")) {
      return;
    }
    const draft = lobbyPeer;
    try {
      const sess = await startChatRoom(name);
      adoptRoom(sess, draft, name);
      setLobbyPeer("");
      setPage("chat");
    } catch (err) {
      pushError(showError(err));
    } finally {
      releaseLobby();
    }
  }

  async function saveLobbyKey(): Promise<void> {
    const name = lobbyKeyDraft.trim();
    if (!name) {
      setLobbyError(t("lobbyKeyNameRequired"));
      return;
    }
    setLobbyError("");
    try {
      await createKey(name, false, region);
      setLobbyKey(name);
      setLobbyKeyDraft("");
      const next = await listKeys();
      setKeys((prev) => (sameKeys(prev, next) ? prev : next));
    } catch (err) {
      pushError(showError(err));
    }
  }

  function roomHasUserMessage(room: RoomSlice | undefined): boolean {
    return Boolean(room?.messages.some((msg) => msg.direction === "in" || msg.direction === "out"));
  }

  function requestCloseRoom(id: string): void {
    const room = roomsRef.current[id];
    if (!room) {
      return;
    }
    if (!roomHasUserMessage(room)) {
      void closeRoom(id);
      return;
    }
    setCloseAsk(id);
  }

  async function closeRoom(id: string): Promise<void> {
    setCloseAsk((current) => (current === id ? "" : current));
    try {
      await stopChatRoom(id);
    } catch (err) {
      const message = showError(err);
      const current = roomsRef.current[id];
      if (current && current.error !== message) {
        commitRooms({ ...roomsRef.current, [id]: { ...current, error: message } });
      }
      pushError(message);
      return;
    }
    pendingRef.current = pendingRef.current.filter((ev) => ev.SessionID !== id);
    const next = { ...roomsRef.current };
    delete next[id];
    commitRooms(next);
    const remaining = orderRef.current.filter((item) => item !== id && next[item]);
    commitOrder(remaining);
    if (focusRef.current === id) {
      if (remaining.length === 0) {
        commitFocus("");
        commitLobby(true);
        roomKeyRef.current = "";
        setRoomKey("");
      } else {
        const nextID = remaining[0];
        commitFocus(nextID);
        syncKey(nextID);
      }
    }
    setLiveSignal(null);
  }

  async function connectLobby(): Promise<void> {
    if (lobbyBusyRef.current) {
      return;
    }
    const addr = lobbyPeer.trim();
    if (!addr.startsWith("tc")) {
      setLobbyError(t("chatAddrError"));
      return;
    }
    if (!claimLobby("connect")) {
      return;
    }
    const draft = lobbyPeer;
    try {
      const sess = await startChatRoom("");
      adoptRoom(sess, draft, "");
      setLobbyPeer("");
      setPage("chat");
      try {
        await connectChatPeer(sess.ID, addr);
      } catch (err) {
        const message = showError(err);
        const current = roomsRef.current[sess.ID];
        if (current && current.error !== message) {
          commitRooms({ ...roomsRef.current, [sess.ID]: { ...current, error: message } });
        }
        pushError(message);
      }
    } catch (err) {
      pushError(showError(err));
    } finally {
      releaseLobby();
    }
  }

  async function runTunnel(action: () => Promise<unknown>): Promise<void> {
    if (tunnelBusyRef.current) {
      return;
    }
    tunnelBusyRef.current = true;
    setTunnelBusy(true);
    try {
      await action();
      await refresh();
    } catch (err) {
      pushError(err instanceof Error ? err.message : String(err));
    } finally {
      tunnelBusyRef.current = false;
      setTunnelBusy(false);
    }
  }

  function addMapping(record: PortMappingRecord): void {
    const next = [record, ...mappingsRef.current.filter((item) => item.id !== record.id)];
    mappingsRef.current = next;
    setMappings(next);
  }

  async function startMapping(id: string): Promise<void> {
    const mapping = mappingsRef.current.find((item) => item.id === id);
    if (!mapping) {
      return;
    }
    await runTunnel(async () => {
      const port = toPortMapping(mapping);
      const started =
        mapping.mode === "serve"
          ? await startPortServe([port])
          : await startForward(mapping.peer, [port], mapping.openBrowser);
      const next = { ...linksRef.current, [id]: started.ID };
      linksRef.current = next;
      setLinks(next);
    });
  }

  async function stopMapping(id: string): Promise<void> {
    const sessionID = linksRef.current[id];
    if (!sessionID) {
      return;
    }
    await runTunnel(() => stopSession(sessionID));
  }

  async function deleteMapping(id: string): Promise<void> {
    const sessionID = linksRef.current[id];
    await runTunnel(async () => {
      if (sessionID) {
        try {
          await stopSession(sessionID);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!/unknown session/i.test(message)) {
            throw err;
          }
        }
      }
      const nextLinks = { ...linksRef.current };
      delete nextLinks[id];
      linksRef.current = nextLinks;
      setLinks(nextLinks);
      const next = mappingsRef.current.filter((item) => item.id !== id);
      mappingsRef.current = next;
      setMappings(next);
    });
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await refresh();
    } catch (err) {
      pushError(showError(err));
    }
  }

  async function onRestart(keyName: string): Promise<void> {
    const id = focusRef.current;
    if (!id || lobbyRef.current || !roomsRef.current[id]) {
      return;
    }
    roomKeyRef.current = keyName;
    setRoomKey(keyName);
    setLiveSignal(null);
    try {
      const sess = await restartChatRoom(id, keyName);
      const prev = roomsRef.current[id];
      // The room was closed while restart was in flight. Do not put it back.
      if (!prev) {
        if (sess.ID && sess.ID !== id) {
          void stopChatRoom(sess.ID);
        }
        return;
      }
      // A new session id must not overwrite a different room's slice.
      if (sess.ID !== id && roomsRef.current[sess.ID]) {
        return;
      }
      let room: RoomSlice = {
        ...prev,
        id: sess.ID,
        keyName,
        address: sess.Address || prev.address,
        peer: "",
        caps: [],
        messages: prev.messages.slice(),
        transfers: prev.transfers.slice(),
        error: sess.Err ? showError(sess.Err) : "",
      };
      for (const ev of drain(sess.ID)) {
        room = applyRoomEvent(room, ev);
      }
      room = stampApplied(room);
      const next = { ...roomsRef.current };
      if (sess.ID !== id) {
        delete next[id];
      }
      next[sess.ID] = room;
      commitRooms(next);
      commitOrder(orderRef.current.map((item) => (item === id ? sess.ID : item)));
      // Only move focus when the user is still on the room that was restarted.
      if (focusRef.current === id) {
        commitFocus(sess.ID);
        if (!lobbyRef.current) {
          commitLobby(false);
        }
      }
      if (room.error) {
        pushError(room.error);
      }
    } catch (err) {
      const message = showError(err);
      const current = roomsRef.current[id];
      if (!current) {
        pushError(message);
        return;
      }
      if (current.error !== message) {
        commitRooms({ ...roomsRef.current, [id]: { ...current, error: message } });
      }
      pushError(message);
    }
  }

  function rememberDraft(draft: { peer: string; composer: string; burn: boolean }): void {
    const id = focusRef.current;
    const current = roomsRef.current[id];
    if (!current) {
      return;
    }
    if (current.peerDraft === draft.peer && current.composer === draft.composer && current.burn === draft.burn) {
      return;
    }
    commitRooms({
      ...roomsRef.current,
      [id]: { ...current, peerDraft: draft.peer, composer: draft.composer, burn: draft.burn },
    });
  }

  const chatRoom = !lobby && focus && rooms[focus] ? rooms[focus] : undefined;
  const showLobby = page === "chat" && !chatRoom;
  const restartLabel = chatRoom
    ? [chatRoom.address || t("roomStarting"), chatRoom.keyName].filter(Boolean).join(" · ")
    : "";
  void version;

  return (
    <div className="shell">
      <aside className="glass sidebar">
        <div className="brand">
          <div className="brand-logo-row">
            <img className="brand-mark" src={iconUrl} alt="" />
            {showUpdateBadge(updateStatus) ? (
              <button type="button" className="update-new" onClick={openUpdateSettings} aria-label={t("updateNewBadge")}>
                {t("updateNew")}
              </button>
            ) : null}
          </div>
          <div>
            <h1>{t("productName")}</h1>
            <p>{t("brandTagline")}</p>
          </div>
        </div>
        <nav className="nav">
          <button
            type="button"
            className={`nav-btn ${page === "miao" ? "active" : ""}`}
            onClick={() => setPage("miao")}
          >
            <NavGlyph name="miao" />
            <span className="nav-label">{t("navMiao")}</span>
          </button>
          {NAV.map((item) =>
            item.id === "tunnel" ? (
              <button
                key={item.id}
                type="button"
                className={`nav-btn ${page === item.id ? "active" : ""}`}
                onClick={() => setPage(item.id)}
              >
                <NavGlyph name={item.id} />
                <span className="nav-label">{t(item.labelKey)}</span>
              </button>
            ) : (
              <span key={item.id} className="nav-chat">
                <button
                  type="button"
                  className={`nav-btn ${page === "chat" ? "active" : ""}`}
                  onClick={openChat}
                >
                  <NavGlyph name="chat" />
                  <span className="nav-label">{t("navChat")}</span>
                </button>
                <div className="nav-rooms">
                  <button
                    type="button"
                    className={`nav-btn nav-child nav-new${showLobby ? " open" : ""}`}
                    onClick={openLobby}
                  >
                    {t("navNewRoom")}
                  </button>
                  <div className="nav-room-list">
                    {order.map((id) => {
                      const room = rooms[id];
                      if (!room) {
                        return null;
                      }
                      const peers = order.map((roomID) => rooms[roomID]?.peer ?? "");
                      const label = roomPrimaryLabel(
                        room.address,
                        t("roomStarting"),
                        room.peer,
                        remarks,
                        remarkIsShared(room.peer, peers, remarks),
                      );
                      const selected = page === "chat" && !showLobby && focus === id;
                      return (
                        <div key={id} className="nav-room-row">
                          <button
                            type="button"
                            className={`nav-btn nav-child ${selected ? "active" : ""}`}
                            title={roomTooltip(room.address, room.keyName)}
                            onClick={() => selectRoom(id)}
                          >
                            <span className="nav-room-label">
                              <span className="nav-room-primary">{label}</span>
                              {room.keyName ? <span className="nav-room-key">{room.keyName}</span> : null}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="nav-room-close"
                            aria-label={`${t("roomClose")} ${label}`}
                            onClick={() => requestCloseRoom(id)}
                          >
                            <RoomCloseIcon />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </span>
            ),
          )}
        </nav>
        <div className="sidebar-footer">
          <button
            type="button"
            className={`nav-btn ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <NavGlyph name="settings" />
            <span className="nav-label">{t("navSettings")}</span>
          </button>
          {fallback ? <div className="fallback-chip">{t("fallbackChip")}</div> : null}
        </div>
      </aside>
      <main ref={mainRef} className="glass main">
        {page === "miao" ? (
          <MiaoPage />
        ) : page === "chat" ? (
          showLobby || !chatRoom ? (
            <LobbyPage
              peer={lobbyPeer}
              error={lobbyError}
              keys={keys.map((key) => ({ name: key.Name, source: key.Source }))}
              keyName={lobbyKey}
              keyDraft={lobbyKeyDraft}
              onPeer={(value) => {
                setLobbyPeer(value);
                setLobbyError("");
              }}
              onKey={setLobbyKey}
              onKeyDraft={setLobbyKeyDraft}
              onCreate={() => void createTemporary()}
              onCreatePermanent={() => void createPermanent()}
              onSaveKey={() => void saveLobbyKey()}
              onConnect={() => void connectLobby()}
              busy={lobbyBusy}
            />
          ) : (
            <ChatPage
              key={chatRoom.id}
              address={chatRoom.address}
              peer={chatRoom.peer}
              caps={chatRoom.caps}
              messages={chatRoom.messages}
              transfers={chatRoom.transfers}
              roomError={chatRoom.error}
              initialPeerDraft={chatRoom.peerDraft}
              initialComposer={chatRoom.composer}
              initialBurn={chatRoom.burn}
              onRoomDraft={rememberDraft}
              nickname={nickname}
              remarks={remarks}
              onRemark={(address, raw, commit) => {
                setRemarks((prev) => applyRemark(prev, address, raw, commit));
              }}
              onConnect={(addr) => connectChatPeer(chatRoom.id, addr)}
              onSend={(body, burn, ttl) => sendChatText(chatRoom.id, body, burn, ttl)}
              onSendVoice={(mime, duration, audio, burn, ttl) =>
                sendChatVoice(chatRoom.id, mime, duration, audio, burn, ttl)
              }
              onSendSignal={(meta) => sendChatSignal(chatRoom.id, meta)}
              incomingSignal={liveSignal}
              onSendPath={(path, burn, ttl) => sendChatFile(chatRoom.id, path, burn, ttl)}
              onSendBrowserFile={(file, burn, ttl) => sendChatFileBytes(chatRoom.id, file, burn, ttl)}
              onDiscard={(messageID) => discardChatMessage(chatRoom.id, messageID)}
              onResend={(messageID) => resendChatFile(chatRoom.id, messageID)}
              onSave={(messageID) => saveChatFile(chatRoom.id, messageID)}
              onRetry={() => onRestart(chatRoom.keyName)}
              notifyNote={notifyDenied ? t("chatNotifyDenied") : ""}
            />
          )
        ) : page === "tunnel" ? (
          <TunnelPage
            mappings={mappings}
            sessions={sessions}
            links={links}
            busy={tunnelBusy}
            onAdd={addMapping}
            onStart={(id) => void startMapping(id)}
            onStop={(id) => void stopMapping(id)}
            onDelete={(id) => void deleteMapping(id)}
          />
        ) : (
          <SettingsPage
            highlightUpdate={updateFocus > 0}
            theme={theme}
            onTheme={setTheme}
            nickname={nickname}
            onNickname={setNickname}
            keys={keys}
            busy={false}
            error=""
            region={region}
            derpMapURL={derpMapURL}
            roomKey={roomKey}
            appliedKey={chatRoom?.appliedKey ?? ""}
            appliedRegion={chatRoom?.appliedRegion ?? ""}
            appliedDERP={chatRoom?.appliedDERP ?? ""}
            onRoomKey={(name) => {
              roomKeyRef.current = name;
              setRoomKey(name);
            }}
            sessions={sessions}
            events={events}
            peer={chatRoom?.peer ?? ""}
            canRestart={Boolean(chatRoom)}
            restartLabel={restartLabel}
            onCreate={(name, client, keyRegion) => run(() => createKey(name, client, keyRegion))}
            onDelete={(name) => run(() => deleteKey(name))}
            onSaveNetwork={(nextRegion, nextDERP) => run(() => setNetworkSettings(nextRegion, nextDERP))}
            onRestart={(keyName) => onRestart(keyName)}
            onPing={(addr, untilDirect) => run(() => startPing(addr, untilDirect))}
            onStop={(id) => run(() => stopSession(id))}
          />
        )}
      </main>
      {closeAsk ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setCloseAsk("")}>
          <div
            className="glass modal modal-compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="room-close-title"
            aria-describedby="room-close-body"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 id="room-close-title">{t("roomCloseTitle")}</h3>
            <p id="room-close-body">{t("roomCloseConfirm")}</p>
            <div className="row">
              <button className="btn btn-ghost" type="button" onClick={() => setCloseAsk("")}>
                {t("cancel")}
              </button>
              <button className="btn btn-danger" type="button" onClick={() => void closeRoom(closeAsk)}>
                {t("roomClose")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}

function RoomCloseIcon() {
  return (
    <svg className="nav-room-close-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function showUpdateBadge(status: UpdateStatus | null): boolean {
  if (!status?.UpdateAvailable) {
    return false;
  }
  return status.Status !== "error" && status.Status !== "unsupported";
}

function NavGlyph({ name }: { name: "miao" | "chat" | "tunnel" | "settings" }) {
  const d =
    name === "miao"
      ? "M7 4.5h10a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM12 8v5.5M9.6 11.2 12 13.6l2.4-2.4"
      : name === "chat"
      ? "M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H9l-3.5 3V6.5z"
      : name === "tunnel"
        ? "M9 8H7a4 4 0 0 0 0 8h2M15 8h2a4 4 0 0 1 0 8h-2M8 12h8"
        : "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM12 3.5v2.1M12 18.4v2.1M4.8 6.2l1.5 1.5M17.7 16.3l1.5 1.5M3.5 12h2.1M18.4 12h2.1M4.8 17.8l1.5-1.5M17.7 7.7l1.5-1.5";
  return (
    <svg className="nav-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}
