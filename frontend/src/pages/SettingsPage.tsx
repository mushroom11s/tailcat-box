import { useEffect, useState, type ReactNode } from "react";
import DiagnosticsSection from "../components/DiagnosticsSection";
import KeysDERPSection from "../components/KeysDERPSection";
import iconUrl from "../assets/icon.png";
import { useI18n, type Locale } from "../i18n";
import {
  getClientInfo,
  getSystemInfo,
  recordUpdateCheck,
  setLaunchAtLogin,
  type ClientInfo,
  type KeyInfo,
  type Session,
  type SystemInfo,
  type TailcatEvent,
} from "../lib/wails";

export type Theme = "system" | "light" | "dark";

type Props = {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  keys: KeyInfo[];
  busy: boolean;
  error: string;
  region: string;
  derpMapURL: string;
  roomKey: string;
  appliedKey: string;
  appliedRegion: string;
  appliedDERP: string;
  onRoomKey: (name: string) => void;
  sessions: Session[];
  events: TailcatEvent[];
  peer: string;
  onCreate: (name: string, client: boolean, region: string) => void | Promise<void>;
  onDelete: (name: string) => void | Promise<void>;
  onSaveNetwork: (region: string, derpMapURL: string) => void | Promise<void>;
  onRestart: (keyName: string) => void | Promise<void>;
  onPing: (addr: string, untilDirect: boolean) => void | Promise<void>;
  onStop: (id: string) => void | Promise<void>;
};

function formatUptime(startedAt: string): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) {
    return "—";
  }
  const ms = Math.max(0, Date.now() - start);
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function formatChecked(iso: string, locale: Locale, neverLabel: string): string {
  if (!iso) {
    return neverLabel;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return neverLabel;
  }
  return d.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US");
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M8 19.5h8M12 16.5v3" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path fill="none" stroke="currentColor" strokeWidth="1.75" d="M4 12h16M12 4c2.2 2.4 3.3 5.1 3.3 8S14.2 17.6 12 20c-2.2-2.4-3.3-5.1-3.3-8S9.8 6.4 12 4z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M12 3.5v2M12 18.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3.5 12h2M18.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function InfoCard({
  title,
  icon,
  tone,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  tone: "warning" | "danger";
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="glass info-card">
      <header className="info-card-head">
        <div className="info-card-title">
          <span className={`info-card-icon ${tone}`}>{icon}</span>
          <h3>{title}</h3>
        </div>
        {action ? <div className="info-card-action">{action}</div> : null}
      </header>
      <div className="info-card-body">{children}</div>
    </article>
  );
}

function InfoRow({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="info-card-row">
      <span className="info-card-label">{label}</span>
      {children ? (
        <span className="info-card-value">{children}</span>
      ) : (
        <span className={`info-card-value${mono ? " mono" : ""}`}>{value || "—"}</span>
      )}
    </div>
  );
}

export default function SettingsPage({
  theme,
  onTheme,
  keys,
  busy,
  error,
  region,
  derpMapURL,
  roomKey,
  appliedKey,
  appliedRegion,
  appliedDERP,
  onRoomKey,
  sessions,
  events,
  peer,
  onCreate,
  onDelete,
  onSaveNetwork,
  onRestart,
  onPing,
  onStop,
}: Props) {
  const { locale, setLocale, t } = useI18n();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [localBusy, setBusy] = useState(false);
  const [localError, setError] = useState("");

  async function refresh(): Promise<void> {
    const [nextClient, nextSystem] = await Promise.all([getClientInfo(), getSystemInfo()]);
    setClient(nextClient);
    setSystem(nextSystem);
  }

  useEffect(() => {
    void refresh().catch((err) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function onOnline() {
      setBrowserOnline(true);
      void refresh();
    }
    function onOffline() {
      setBrowserOnline(false);
      void refresh();
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  async function onCheckNow(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      setClient(await recordUpdateCheck());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleLaunch(enabled: boolean): Promise<void> {
    setBusy(true);
    setError("");
    try {
      setSystem(await setLaunchAtLogin(enabled));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  void now;
  const uptime = client ? formatUptime(client.StartedAt) : "—";

  const goOnline = system?.NetworkOnline;
  const online = goOnline ?? browserOnline;
  let networkValue = online ? t("online") : t("offline");
  if (system?.NetworkSummary) {
    networkValue = `${networkValue} · ${system.NetworkSummary}`;
  }
  if (system && browserOnline !== system.NetworkOnline) {
    networkValue = `${networkValue} (${browserOnline ? t("browserOnline") : t("browserOffline")})`;
  }

  return (
    <section className="page">
      <h2>{t("settingsTitle")}</h2>
      <p className="lede">{t("settingsLede")}</p>

      <section className="glass settings-panel">
        <h3 className="kind">{t("appearance")}</h3>
        <p className="lede">{t("appearanceLede")}</p>
        <div className="setting-row">
          <div className="setting-label">
            <GlobeIcon />
            <span id="settings-language">{t("language")}</span>
          </div>
          <div className="lang-toggle" role="group" aria-labelledby="settings-language">
            {(["en", "zh-CN"] as Locale[]).map((value) => (
              <button
                key={value}
                type="button"
                className={locale === value ? "active" : ""}
                onClick={() => setLocale(value)}
              >
                {value === "en" ? t("langEnglish") : t("langChinese")}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-label">
            <SunIcon />
            <span id="settings-theme">{t("theme")}</span>
          </div>
          <div className="theme-toggle" role="group" aria-labelledby="settings-theme">
            {(["system", "light", "dark"] as Theme[]).map((value) => (
              <button
                key={value}
                type="button"
                className={theme === value ? "active" : ""}
                onClick={() => onTheme(value)}
              >
                {value === "system" ? t("themeSystem") : value === "light" ? t("themeLight") : t("themeDark")}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="settings-cards">
        <InfoCard
          title={t("clientInfoTitle")}
          icon={<img className="info-card-mark" src={iconUrl} alt="" />}
          tone="warning"
          action={
            <button className="btn-link" type="button" disabled={localBusy} onClick={() => void onCheckNow()}>
              {t("checkNow")}
            </button>
          }
        >
          <InfoRow label={t("uptime")} value={uptime} mono />
          <InfoRow label={t("appVersion")} value={client?.AppVersion ?? "—"} mono />
          <InfoRow label={t("tailcatVersion")} value={client?.TailcatVersion ?? "—"} mono />
          <InfoRow
            label={t("lastUpdateCheck")}
            value={formatChecked(client?.LastUpdateCheck ?? "", locale, t("never"))}
          />
          <p className="info-card-note">{t("updateCheckHint")}</p>
        </InfoCard>

        <InfoCard title={t("systemInfoTitle")} icon={<MonitorIcon />} tone="danger">
          <InfoRow label={t("osVersion")} value={system?.OSVersion ?? "—"} />
          <InfoRow label={t("launchAtLogin")}>
            <button
              type="button"
              className={`chip-toggle${system?.LaunchAtLogin ? " on" : ""}`}
              disabled={localBusy || !system}
              onClick={() => void onToggleLaunch(!system?.LaunchAtLogin)}
            >
              {system?.LaunchAtLogin ? t("on") : t("off")}
            </button>
          </InfoRow>
          <InfoRow label={t("networkStatus")} value={system ? networkValue : "—"} />
          {system && !system.LaunchAtLoginSupported ? (
            <p className="info-card-note">{t("launchAtLoginNote")}</p>
          ) : null}
        </InfoCard>
      </div>

      {localError ? <p className="err">{localError}</p> : null}

      <KeysDERPSection
        keys={keys}
        busy={busy}
        error={error}
        region={region}
        derpMapURL={derpMapURL}
        roomKey={roomKey}
        appliedKey={appliedKey}
        appliedRegion={appliedRegion}
        appliedDERP={appliedDERP}
        onRoomKey={onRoomKey}
        onCreate={onCreate}
        onDelete={onDelete}
        onSaveNetwork={onSaveNetwork}
        onRestart={onRestart}
      />
      <DiagnosticsSection
        sessions={sessions}
        events={events}
        peer={peer}
        busy={busy}
        error={error}
        onPing={onPing}
        onStop={onStop}
      />
    </section>
  );
}
