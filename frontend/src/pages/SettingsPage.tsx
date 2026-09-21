import { useEffect, useState } from "react";
import { useI18n, type Locale } from "../i18n";
import {
  getClientInfo,
  getSystemInfo,
  recordUpdateCheck,
  setLaunchAtLogin,
  type ClientInfo,
  type SystemInfo,
} from "../lib/wails";

export type Theme = "system" | "light" | "dark";

type Props = {
  theme: Theme;
  onTheme: (theme: Theme) => void;
};

function formatUptime(startedAt: string, t: (key: "unitDay" | "unitHour" | "unitMinute" | "unitSecond") => string): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) {
    return "—";
  }
  let secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const days = Math.floor(secs / 86400);
  secs %= 86400;
  const hours = Math.floor(secs / 3600);
  secs %= 3600;
  const mins = Math.floor(secs / 60);
  secs %= 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}${t("unitDay")}`);
  }
  if (days > 0 || hours > 0) {
    parts.push(`${hours}${t("unitHour")}`);
  }
  parts.push(`${mins}${t("unitMinute")}`);
  parts.push(`${secs}${t("unitSecond")}`);
  return parts.join(" ");
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value || "—"}</span>
    </div>
  );
}

export default function SettingsPage({ theme, onTheme }: Props) {
  const { locale, setLocale, t } = useI18n();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  const uptime = client ? formatUptime(client.StartedAt, t) : "—";
  void now;

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

      <h3 className="kind">{t("appearance")}</h3>
      <div className="appearance-toggles">
        <div className="field">
          <label id="settings-language">{t("language")}</label>
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
        <div className="field">
          <label id="settings-theme">{t("theme")}</label>
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
      </div>

      <h3 className="kind settings-block">{t("clientInfoTitle")}</h3>
      <div className="info-list">
        <InfoRow label={t("uptime")} value={uptime} />
        <InfoRow label={t("appVersion")} value={client?.AppVersion ?? "—"} />
        <InfoRow label={t("tailcatVersion")} value={client?.TailcatVersion ?? "—"} />
        <InfoRow
          label={t("lastUpdateCheck")}
          value={formatChecked(client?.LastUpdateCheck ?? "", locale, t("never"))}
        />
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" type="button" disabled={busy} onClick={() => void onCheckNow()}>
          {t("checkNow")}
        </button>
      </div>
      <p className="note">{t("updateCheckHint")}</p>

      <h3 className="kind settings-block">{t("systemInfoTitle")}</h3>
      <div className="info-list">
        <InfoRow label={t("osVersion")} value={system?.OSVersion ?? "—"} />
        <div className="glass info-row">
          <span className="info-label">{t("launchAtLogin")}</span>
          <span className="info-value">
            <label className="check settings-switch">
              <input
                type="checkbox"
                checked={Boolean(system?.LaunchAtLogin)}
                disabled={busy || !system}
                onChange={(e) => void onToggleLaunch(e.target.checked)}
              />
              {system?.LaunchAtLogin ? t("on") : t("off")}
            </label>
          </span>
        </div>
        <InfoRow label={t("networkStatus")} value={system ? networkValue : "—"} />
      </div>
      {system && !system.LaunchAtLoginSupported ? <p className="note">{t("launchAtLoginNote")}</p> : null}

      {error ? <p className="err">{error}</p> : null}
    </section>
  );
}
