import { useCallback, useEffect, useMemo, useState } from "react";
import ConnectPage from "./pages/ConnectPage";
import DiagnosticsPage from "./pages/DiagnosticsPage";
import KeysPage from "./pages/KeysPage";
import ServicesPage from "./pages/ServicesPage";
import { parsePortMappings } from "./lib/ports";
import {
  createKey,
  deleteKey,
  dialPipe,
  hasWailsBindings,
  listKeys,
  listSessions,
  onTailcatEvent,
  parseAddr,
  resolveAddr,
  startBrowse,
  startForward,
  startPing,
  startPipeServe,
  startPortServe,
  stopSession,
  type KeyInfo,
  type Session,
  type TailcatEvent,
} from "./lib/wails";

type Page = "connect" | "services" | "keys" | "diagnostics";
type Theme = "system" | "light" | "dark";

const THEME_KEY = "tailcat-theme";

const NAV: Array<{ id: Page | "files"; label: string; available: boolean }> = [
  { id: "connect", label: "Connect", available: true },
  { id: "services", label: "Services", available: true },
  { id: "files", label: "Files", available: false },
  { id: "keys", label: "Keys & Addresses", available: true },
  { id: "diagnostics", label: "Diagnostics", available: true },
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

export default function App() {
  const [page, setPage] = useState<Page>("services");
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [events, setEvents] = useState<TailcatEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [parseResult, setParseResult] = useState("");
  const [resolveResult, setResolveResult] = useState("");
  const fallback = !hasWailsBindings();

  const refresh = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setKeys(await listKeys());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    void refresh();
    const off = onTailcatEvent((ev) => {
      setEvents((prev) => [...prev, ev]);
      void refresh();
    });
    const id = window.setInterval(() => {
      void refresh();
    }, 400);
    return () => {
      off();
      window.clearInterval(id);
    };
  }, [refresh]);

  const echo = useMemo(() => {
    const data = [...events].reverse().find((ev) => ev.Kind === "data" && ev.Data);
    return data?.Data ?? "";
  }, [events]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <aside className="glass sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Tailcat</h1>
            <p>Desktop client</p>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-btn ${page === item.id ? "active" : ""}`}
              disabled={!item.available}
              title={item.available ? undefined : "Plan 3+"}
              onClick={() => {
                if (item.available) {
                  setPage(item.id as Page);
                  setError("");
                }
              }}
            >
              {item.label}
              {!item.available ? <span className="nav-hint">Plan 3+</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {fallback ? <div className="fallback-chip">In-browser fake adapter</div> : null}
          <div className="theme-toggle" role="group" aria-label="Theme">
            {(["system", "light", "dark"] as Theme[]).map((value) => (
              <button
                key={value}
                type="button"
                className={theme === value ? "active" : ""}
                onClick={() => setTheme(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </aside>
      <main className="glass main">
        {page === "services" ? (
          <ServicesPage
            sessions={sessions}
            busy={busy}
            error={error}
            onStartPipe={() => void run(startPipeServe)}
            onStartPorts={(spec) =>
              void run(async () => {
                await startPortServe(parsePortMappings(spec));
              })
            }
            onStop={(id) => void run(() => stopSession(id))}
          />
        ) : null}
        {page === "connect" ? (
          <ConnectPage
            sessions={sessions}
            echo={echo}
            busy={busy}
            error={error}
            onSend={(addr, payload) => void run(() => dialPipe(addr, payload))}
            onForward={(addr, spec) =>
              void run(async () => {
                await startForward(addr, parsePortMappings(spec));
              })
            }
            onBrowse={(addr) => void run(() => startBrowse(addr))}
            onStop={(id) => void run(() => stopSession(id))}
          />
        ) : null}
        {page === "keys" ? (
          <KeysPage
            keys={keys}
            busy={busy}
            error={error}
            parseResult={parseResult}
            resolveResult={resolveResult}
            onCreate={(name, client, region) => void run(() => createKey(name, client, region))}
            onDelete={(name) => void run(() => deleteKey(name))}
            onParse={(raw) =>
              void run(async () => {
                setParseResult(await parseAddr(raw));
              })
            }
            onResolve={(raw) =>
              void run(async () => {
                setResolveResult(await resolveAddr(raw));
              })
            }
          />
        ) : null}
        {page === "diagnostics" ? (
          <DiagnosticsPage
            sessions={sessions}
            events={events}
            busy={busy}
            error={error}
            onPing={(addr, untilDirect) => void run(() => startPing(addr, untilDirect))}
            onStop={(id) => void run(() => stopSession(id))}
          />
        ) : null}
      </main>
    </div>
  );
}
