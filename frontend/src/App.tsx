import { useCallback, useEffect, useMemo, useState } from "react";
import ConnectPage from "./pages/ConnectPage";
import DiagnosticsPage from "./pages/DiagnosticsPage";
import FilesPage from "./pages/FilesPage";
import KeysPage from "./pages/KeysPage";
import ServicesPage from "./pages/ServicesPage";
import SettingsPage from "./pages/SettingsPage";
import { parsePortMappings } from "./lib/ports";
import { sameKeys, sameSessions } from "./lib/snapshot";
import { useI18n } from "./i18n";
import {
  createKey,
  deleteKey,
  dialPipe,
  getNetworkSettings,
  hasWailsBindings,
  listKeys,
  listRemote,
  listSessions,
  onTailcatEvent,
  parseAddr,
  resolveAddr,
  setNetworkSettings,
  startBrowse,
  startCopy,
  startExec,
  startExitNode,
  startFilesServe,
  startForward,
  startPing,
  startPipeServe,
  startPortServe,
  startRecv,
  startSOCKS,
  startSSHClient,
  startSSHServe,
  stopSession,
  tailcatVersion,
  type FileEntry,
  type KeyInfo,
  type Session,
  type TailcatEvent,
} from "./lib/wails";

type Page = "connect" | "services" | "files" | "keys" | "diagnostics" | "settings";
type Theme = "system" | "light" | "dark";

const THEME_KEY = "tailcat-theme";

const NAV: Array<{
  id: Page;
  labelKey: "navConnect" | "navServices" | "navFiles" | "navKeys" | "navDiagnostics" | "navSettings";
}> = [
  { id: "connect", labelKey: "navConnect" },
  { id: "services", labelKey: "navServices" },
  { id: "files", labelKey: "navFiles" },
  { id: "keys", labelKey: "navKeys" },
  { id: "diagnostics", labelKey: "navDiagnostics" },
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

export default function App() {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>("services");
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [events, setEvents] = useState<TailcatEvent[]>([]);
  const [listing, setListing] = useState<FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [parseResult, setParseResult] = useState("");
  const [resolveResult, setResolveResult] = useState("");
  const [region, setRegion] = useState("");
  const [derpMapURL, setDerpMapURL] = useState("");
  const [version, setVersion] = useState("");
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
    }, 2000);
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
            <p>{t("brandTagline")}</p>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-btn ${page === item.id ? "active" : ""}`}
              onClick={() => {
                setPage(item.id);
                setError("");
              }}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">{fallback ? <div className="fallback-chip">{t("fallbackChip")}</div> : null}</div>
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
            onStartFiles={(dir, mode) => void run(() => startFilesServe(dir, mode))}
            onStartSSH={(noAuth, keys, confirm) => void run(() => startSSHServe(noAuth, keys, confirm))}
            onStartExitNode={() => void run(startExitNode)}
            onStartExec={(command) => void run(() => startExec(command))}
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
            onSSH={(addr, command, user, identity) => void run(() => startSSHClient(addr, command, user, identity))}
            onSOCKS={(addr, listen) => void run(() => startSOCKS(addr, listen))}
            onStop={(id) => void run(() => stopSession(id))}
          />
        ) : null}
        {page === "files" ? (
          <FilesPage
            sessions={sessions}
            listing={listing}
            busy={busy}
            error={error}
            onRecv={(dir, acceptDirs) => void run(() => startRecv(dir, acceptDirs))}
            onSend={(addr, paths, remote) => void run(() => startCopy(addr, paths, remote))}
            onServe={(dir, mode) => void run(() => startFilesServe(dir, mode))}
            onList={(addr, path) =>
              void run(async () => {
                setListing(await listRemote(addr, path));
              })
            }
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
            region={region}
            derpMapURL={derpMapURL}
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
            onSaveNetwork={(nextRegion, nextDERP) => void run(() => setNetworkSettings(nextRegion, nextDERP))}
          />
        ) : null}
        {page === "diagnostics" ? (
          <DiagnosticsPage
            sessions={sessions}
            events={events}
            busy={busy}
            error={error}
            version={version}
            onPing={(addr, untilDirect) => void run(() => startPing(addr, untilDirect))}
            onStop={(id) => void run(() => stopSession(id))}
          />
        ) : null}
        {page === "settings" ? <SettingsPage theme={theme} onTheme={setTheme} /> : null}
      </main>
    </div>
  );
}
