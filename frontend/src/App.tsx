import { useCallback, useEffect, useRef, useState } from "react";
import ChatPage, { type ChatMessage, type ChatTransfer } from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";
import { sameKeys, sameSessions } from "./lib/snapshot";
import { useI18n } from "./i18n";
import { localizeChatError } from "./lib/chatText";
import {
  connectChatPeer,
  createKey,
  deleteKey,
  discardChatMessage,
  getNetworkSettings,
  hasWailsBindings,
  listKeys,
  listSessions,
  onTailcatEvent,
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
  startPing,
  stopSession,
  tailcatVersion,
  type KeyInfo,
  type Session,
  type TailcatEvent,
} from "./lib/wails";
import { WindowSetTitle } from "../wailsjs/runtime/runtime";

type Page = "chat" | "settings";
type Theme = "system" | "light" | "dark";

const THEME_KEY = "tailcat-theme";

const NAV: Array<{ id: Page; labelKey: "navChat" | "navSettings" }> = [
  { id: "chat", labelKey: "navChat" },
  { id: "settings", labelKey: "navSettings" },
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

function asMessage(data: string): ChatMessage | null {
  try {
    const msg = JSON.parse(data) as ChatMessage;
    if (!msg.id || !msg.direction) {
      return null;
    }
    return msg;
  } catch {
    return null;
  }
}

export default function App() {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>("chat");
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [events, setEvents] = useState<TailcatEvent[]>([]);
  const [region, setRegion] = useState("");
  const [derpMapURL, setDerpMapURL] = useState("");
  const [version, setVersion] = useState("");
  const [chatAddress, setChatAddress] = useState("");
  const [chatPeer, setChatPeer] = useState("");
  const [chatCaps, setChatCaps] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [transfers, setTransfers] = useState<ChatTransfer[]>([]);
  const [roomError, setRoomError] = useState("");
  const [liveSignal, setLiveSignal] = useState<{ seq: number; data: string } | null>(null);
  const [roomKey, setRoomKey] = useState("");
  const [appliedRoom, setAppliedRoom] = useState({ key: "", region: "", derp: "" });
  const roomKeyRef = useRef("");
  const peerRef = useRef("");
  const netRef = useRef({ region: "", derp: "" });
  netRef.current = { region, derp: derpMapURL };
  const fallback = !hasWailsBindings();

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
      // Session refresh keeps the last good snapshot. Room listen errors use roomError.
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.title = t("brandName");
    if (hasWailsBindings()) {
      WindowSetTitle(t("brandName"));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    const off = onTailcatEvent((ev) => {
      setEvents((prev) => [...prev, ev]);
      if (ev.Kind === "room-ready" && ev.Data) {
        try {
          const data = JSON.parse(ev.Data) as { address?: string };
          if (data.address) {
            setChatAddress(data.address);
            setRoomError("");
            setAppliedRoom({
              key: roomKeyRef.current,
              region: netRef.current.region,
              derp: netRef.current.derp,
            });
          }
        } catch {
          // ignore malformed event data
        }
      } else if (ev.Kind === "peer" && ev.Data) {
        try {
          const data = JSON.parse(ev.Data) as { address?: string; caps?: string[] };
          const next = data.address ?? "";
          if (Array.isArray(data.caps)) {
            setChatCaps(data.caps);
          } else if (next !== peerRef.current) {
            setChatCaps([]);
          }
          peerRef.current = next;
          setChatPeer(next);
        } catch {
          // ignore malformed event data
        }
      } else if (ev.Kind === "message" && ev.Data) {
        const msg = asMessage(ev.Data);
        if (msg) {
          setChatMessages((prev) => (prev.some((item) => item.id === msg.id) ? prev : [...prev, msg]));
          if (msg.code === "room-restarted") {
            peerRef.current = "";
            setChatPeer("");
            setChatCaps([]);
          }
        }
      } else if (ev.Kind === "transfer" && ev.Data) {
        try {
          const tr = JSON.parse(ev.Data) as ChatTransfer;
          if (tr.id) {
            setTransfers((prev) => {
              const index = prev.findIndex((item) => item.id === tr.id);
              if (index < 0) {
                return [...prev, tr];
              }
              const next = prev.slice();
              next[index] = tr;
              return next;
            });
          }
        } catch {
          // ignore malformed event data
        }
      } else if (ev.Kind === "signal" && ev.Data) {
        const data = ev.Data;
        setLiveSignal((prev) => ({ seq: (prev?.seq ?? 0) + 1, data }));
      } else if (ev.Kind === "discard" && ev.Data) {
        try {
          const data = JSON.parse(ev.Data) as { id?: string };
          if (data.id) {
            setChatMessages((prev) => prev.filter((item) => item.id !== data.id));
          }
        } catch {
          // ignore malformed event data
        }
      }
      void refresh();
    });
    const id = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [refresh]);

  useEffect(() => {
    setAppliedRoom((prev) => {
      if (prev.key !== roomKeyRef.current) {
        return prev;
      }
      if (prev.region === region && prev.derp === derpMapURL) {
        return prev;
      }
      if (prev.region === "" && prev.derp === "" && (region !== "" || derpMapURL !== "")) {
        return { key: prev.key, region, derp: derpMapURL };
      }
      return prev;
    });
  }, [region, derpMapURL]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const sess = await startChatRoom();
        if (!live) {
          return;
        }
        if (sess.Address) {
          setChatAddress(sess.Address);
          setRoomError("");
        }
      } catch (err) {
        if (!live) {
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        const text = localizeChatError(message, t);
        if (!text && message === "room is starting") {
          return;
        }
        setRoomError(text || message);
      }
    })();
    return () => {
      live = false;
    };
  }, [t]);

  async function retryRoom(): Promise<void> {
    setRoomError("");
    try {
      const sess = await startChatRoom();
      if (sess.Address) {
        setChatAddress(sess.Address);
        setRoomError("");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRoomError(localizeChatError(message, t) || message);
    }
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRoomError(localizeChatError(message, t) || message);
    }
  }

  async function onRestart(keyName: string): Promise<void> {
    roomKeyRef.current = keyName;
    setRoomError("");
    try {
      const sess = await restartChatRoom(keyName);
      setAppliedRoom({ key: keyName, region, derp: derpMapURL });
      if (sess.Address) {
        setChatAddress(sess.Address);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRoomError(localizeChatError(message, t) || message);
    }
  }

  const listed = sessions.find((s) => s.Kind === "chat" && s.Status === "running");
  const address = chatAddress || listed?.Address || "";
  void version;

  return (
    <div className="shell">
      <aside className="glass sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <h1>{t("brandName")}</h1>
            <p>{t("brandTagline")}</p>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-btn ${page === item.id ? "active" : ""}`}
              onClick={() => setPage(item.id)}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">{fallback ? <div className="fallback-chip">{t("fallbackChip")}</div> : null}</div>
      </aside>
      <main className="glass main">
        {page === "chat" ? (
          <ChatPage
            address={address}
            peer={chatPeer}
            caps={chatCaps}
            messages={chatMessages}
            transfers={transfers}
            roomError={roomError}
            onConnect={connectChatPeer}
            onSend={sendChatText}
            onSendVoice={sendChatVoice}
            onSendSignal={sendChatSignal}
            incomingSignal={liveSignal}
            onSendPath={sendChatFile}
            onSendBrowserFile={sendChatFileBytes}
            onDiscard={discardChatMessage}
            onResend={resendChatFile}
            onSave={saveChatFile}
            onRetry={retryRoom}
          />
        ) : (
          <SettingsPage
            theme={theme}
            onTheme={setTheme}
            keys={keys}
            busy={false}
            error=""
            region={region}
            derpMapURL={derpMapURL}
            roomKey={roomKey}
            appliedKey={appliedRoom.key}
            appliedRegion={appliedRoom.region}
            appliedDERP={appliedRoom.derp}
            onRoomKey={(name) => {
              roomKeyRef.current = name;
              setRoomKey(name);
            }}
            sessions={sessions}
            events={events}
            peer={chatPeer}
            onCreate={(name, client, keyRegion) => run(() => createKey(name, client, keyRegion))}
            onDelete={(name) => run(() => deleteKey(name))}
            onSaveNetwork={(nextRegion, nextDERP) => run(() => setNetworkSettings(nextRegion, nextDERP))}
            onRestart={(keyName) => onRestart(keyName)}
            onPing={(addr, untilDirect) => run(() => startPing(addr, untilDirect))}
            onStop={(id) => run(() => stopSession(id))}
          />
        )}
      </main>
    </div>
  );
}
