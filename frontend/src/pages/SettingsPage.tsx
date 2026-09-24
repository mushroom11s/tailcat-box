import { useEffect, useRef, useState, type ReactNode } from "react";
import { useToasts } from "../components/toasts";
import KeysDERPSection from "../components/KeysDERPSection";
import ReleaseNotes from "../components/ReleaseNotes";
import iconUrl from "../assets/icon.png";
import LoadingCat from "../components/LoadingCat";
import { useI18n, type Locale, type MessageKey } from "../i18n";
import { displayNickname, sanitizeNickname } from "../lib/nickname";
import {
  checkForUpdate,
  downloadUpdate,
  getClientInfo,
  getSystemInfo,
  getUpdateStatus,
  onUpdateProgress,
  onUpdateStatus,
  openReleasePage,
  revealDownloadedUpdate,
  setLaunchAtLogin,
  type ClientInfo,
  type KeyInfo,
  type SystemInfo,
  type UpdateStatus,
} from "../lib/wails";

export type Theme = "system" | "light" | "dark";

type Props = {
  highlightUpdate?: boolean;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  nickname: string;
  onNickname: (nickname: string) => void;
  keys: KeyInfo[];
  busy: boolean;
  error: string;
  region: string;
  derpMapURL: string;
  onCreate: (name: string, client: boolean, region: string) => void | Promise<void>;
  onDelete: (name: string) => void | Promise<void>;
  onSaveNetwork: (region: string, derpMapURL: string) => void | Promise<void>;
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

function BadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="9" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M6.5 19.2c.8-2.6 2.8-4 5.5-4s4.7 1.4 5.5 4" />
    </svg>
  );
}

function InfoCard({
  id,
  className,
  title,
  icon,
  tone,
  action,
  children,
}: {
  id?: string;
  className?: string;
  title: string;
  icon: ReactNode;
  tone: "warning" | "danger";
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article id={id} className={`glass info-card${className ? ` ${className}` : ""}`}>
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
  highlightUpdate = false,
  theme,
  onTheme,
  nickname,
  onNickname,
  keys,
  busy,
  error,
  region,
  derpMapURL,
  onCreate,
  onDelete,
  onSaveNetwork,
}: Props) {
  const { locale, setLocale, t } = useI18n();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [progress, setProgress] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [localBusy, setBusy] = useState(false);
  const { push } = useToasts();
  const pushRef = useRef(push);
  pushRef.current = push;

  function report(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    const text = message.trim();
    if (text) {
      pushRef.current(text);
    }
  }

  async function refresh(): Promise<void> {
    const [nextClient, nextSystem] = await Promise.all([getClientInfo(), getSystemInfo()]);
    setClient(nextClient);
    setSystem(nextSystem);
  }

  useEffect(() => {
    void refresh().catch((err) => {
      report(err);
    });
  }, []);

  useEffect(() => {
    let revision = 0;
    const offStatus = onUpdateStatus((status) => {
      revision += 1;
      setUpdate(status);
    });
    const offProgress = onUpdateProgress((next) => {
      setProgress(next.Percent);
    });
    const ticket = revision;
    void getUpdateStatus()
      .then((status) => {
        if (revision === ticket) {
          setUpdate(status);
        }
      })
      .catch((err) => {
        report(err);
      });
    return () => {
      offStatus();
      offProgress();
    };
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
    setChecking(true);
    try {
      const [nextUpdate, nextClient] = await Promise.all([checkForUpdate(), getClientInfo()]);
      setUpdate(nextUpdate);
      setClient(nextClient);
    } catch (err) {
      report(err);
    } finally {
      setChecking(false);
      setBusy(false);
    }
  }

  async function onDownload(): Promise<void> {
    setBusy(true);
    setDownloading(true);
    setProgress(0);
    try {
      setUpdate(await downloadUpdate());
    } catch (err) {
      report(err);
    } finally {
      setDownloading(false);
      setBusy(false);
    }
  }

  async function onReveal(): Promise<void> {
    setBusy(true);
    try {
      await revealDownloadedUpdate();
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function onToggleLaunch(enabled: boolean): Promise<void> {
    setBusy(true);
    try {
      setSystem(await setLaunchAtLogin(enabled));
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  void now;
  const uptime = client ? formatUptime(client.StartedAt) : "—";
  const checkedAt = update?.LastChecked || client?.LastUpdateCheck || "";
  const downloaded = update?.Status === "downloaded" && Boolean(update.DownloadedPath);
  const canDownload = Boolean(update?.UpdateAvailable && update.DownloadURL);
  const statusText = update ? describeUpdate(update, t) : "";
  const downloadError = update?.Error === "download" ? t("updateErrDownload") : "";

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

      <section className="glass settings-panel">
        <h3 className="kind">{t("profile")}</h3>
        <div className="setting-row nickname-row">
          <div className="setting-label">
            <BadgeIcon />
            <label htmlFor="settings-nickname">{t("nickname")}</label>
          </div>
          <input
            id="settings-nickname"
            className="nickname-input"
            value={nickname}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="settings-nickname-help"
            onChange={(e) => onNickname(sanitizeNickname(e.target.value))}
            onBlur={(e) => onNickname(displayNickname(e.currentTarget.value))}
          />
        </div>
        <p id="settings-nickname-help" className="setting-help">{t("nicknameHelp")}</p>
      </section>

      <div className="settings-cards">
        <InfoCard
          id="settings-update"
          className={highlightUpdate ? "update-focus" : undefined}
          title={t("clientInfoTitle")}
          icon={<img className="info-card-mark" src={iconUrl} alt="" />}
          tone="warning"
          action={
            <button className="btn-link" type="button" disabled={localBusy} onClick={() => void onCheckNow()}>
              {checking ? t("updateChecking") : t("checkNow")}
            </button>
          }
        >
          <InfoRow label={t("uptime")} value={uptime} mono />
          <InfoRow label={t("appVersion")} value={client?.AppVersion ?? update?.CurrentVersion ?? "—"} mono />
          <InfoRow label={t("tailcatVersion")} value={client?.TailcatVersion ?? "—"} mono />
          <InfoRow label={t("latestVersion")} value={update?.LatestVersion || "—"} mono />
          <InfoRow label={t("lastUpdateCheck")} value={formatChecked(checkedAt, locale, t("never"))} />
          {statusText ? <p className="update-status">{statusText}</p> : null}
          {update?.Notes ? (
            <div className="update-notes">
              <span className="info-card-label">{t("releaseNotes")}</span>
              <ReleaseNotes markdown={update.Notes} />
            </div>
          ) : null}
          {downloading ? (
            <LoadingCat size="sm" label={t("downloadingUpdate")} />
          ) : null}
          {downloading ? (
            <div
              className="update-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label={t("downloadingUpdate")}
            >
              <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
            </div>
          ) : null}
          {downloadError ? <p className="err">{downloadError}</p> : null}
          <div className="update-actions">
            {canDownload && !downloaded ? (
              <button className="btn btn-small" type="button" disabled={localBusy} onClick={() => void onDownload()}>
                {downloading ? t("downloadingUpdate") : t("downloadUpdate")}
              </button>
            ) : null}
            {downloaded ? (
              <button className="btn btn-small" type="button" disabled={localBusy} onClick={() => void onReveal()}>
                {revealLabel(update?.Platform ?? "", t)}
              </button>
            ) : null}
            {downloaded ? (
              <button className="btn-link" type="button" disabled={localBusy} onClick={() => void onDownload()}>
                {downloading ? t("downloadingUpdate") : t("downloadAgain")}
              </button>
            ) : null}
            {update?.ReleaseURL ? (
              <button className="btn-link" type="button" onClick={() => openReleasePage(update.ReleaseURL)}>
                {t("viewRelease")}
              </button>
            ) : null}
          </div>
          {downloaded ? (
            <div className="update-install">
              <h4>{t("updateInstallTitle")}</h4>
              <p>{installSteps(update?.Platform ?? "", update?.AssetName ?? "", t)}</p>
            </div>
          ) : null}
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

      <KeysDERPSection
        keys={keys}
        busy={busy}
        error={error}
        region={region}
        derpMapURL={derpMapURL}
        onCreate={onCreate}
        onDelete={onDelete}
        onSaveNetwork={onSaveNetwork}
      />
    </section>
  );
}

function describeUpdate(update: UpdateStatus, t: (key: MessageKey) => string): string {
  if (update.Status === "error") {
    return updateErrorText(update.Error || "parse", t);
  }
  switch (update.Status) {
    case "upToDate":
      return t("updateUpToDate");
    case "available":
      return t("updateAvailableLabel");
    case "downloaded":
      return t("updateDownloaded");
    case "unsupported":
      return t("updateNoPackage");
    default:
      return "";
  }
}

function updateErrorText(code: string, t: (key: MessageKey) => string): string {
  switch (code) {
    case "network":
      return t("updateErrNetwork");
    case "rate_limit":
      return t("updateErrRateLimit");
    case "parse":
      return t("updateErrParse");
    case "no_asset":
    case "unsupported":
      return t("updateNoPackage");
    case "download":
      return t("updateErrDownload");
    default:
      return code;
  }
}

function revealLabel(platform: string, t: (key: MessageKey) => string): string {
  if (platform === "darwin") {
    return t("revealUpdateMac");
  }
  if (platform === "windows") {
    return t("revealUpdateWin");
  }
  return t("revealUpdate");
}

function installSteps(platform: string, assetName: string, t: (key: MessageKey) => string): string {
  const zip = assetName.toLowerCase().endsWith(".zip");
  if (platform === "darwin") {
    return t(zip ? "updateInstallMacZip" : "updateInstallMac");
  }
  if (platform === "windows") {
    return t(zip ? "updateInstallWinZip" : "updateInstallWin");
  }
  return t("updateInstallOther");
}
