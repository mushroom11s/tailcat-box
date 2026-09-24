import { FormEvent, useEffect, useState } from "react";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import QrScanButton from "../components/QrScanButton";
import QrShareButton from "../components/QrShareButton";
import LoadingCat from "../components/LoadingCat";
import { statusMessageKey, useI18n } from "../i18n";
import { draftMapping, mappingPrimary, type PortMappingRecord } from "../lib/portMappings";
import { shareableAddress } from "../lib/qr";
import type { Session } from "../lib/wails";

type Props = {
  mappings: PortMappingRecord[];
  sessions: Session[];
  links: Record<string, string>;
  busy: boolean;
  error: string;
  onAdd: (record: PortMappingRecord) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
};

async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to the desktop clipboard
  }
  try {
    await ClipboardSetText(text);
  } catch {
    // ignore copy failures in environments without a clipboard
  }
}

export default function TunnelPage({ mappings, sessions, links, busy, error, onAdd, onStart, onStop, onDelete }: Props) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"serve" | "forward">("serve");
  const [serveSpec, setServeSpec] = useState("8080");
  const [forwardSpec, setForwardSpec] = useState("18080:8080");
  const [peer, setPeer] = useState("");
  const [openBrowser, setOpenBrowser] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (selected && !mappings.some((item) => item.id === selected)) {
      setSelected("");
    }
  }, [mappings, selected]);

  function openCreate() {
    setCreating(true);
    setSelected("");
    setMode("serve");
    setServeSpec("8080");
    setForwardSpec("18080:8080");
    setPeer("");
    setOpenBrowser(false);
    setFormError("");
  }

  function selectMapping(id: string) {
    setCreating(false);
    setSelected(id);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) {
      return;
    }
    try {
      const record = draftMapping({
        mode,
        spec: mode === "serve" ? serveSpec : forwardSpec,
        peer,
        openBrowser,
      });
      onAdd(record);
      setCreating(false);
      setSelected(record.id);
      setFormError("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "peer-required") {
        setFormError(t("tunnelPeerRequired"));
      } else if (message === "one-mapping") {
        setFormError(t("tunnelOneMapping"));
      } else {
        setFormError(message);
      }
    }
  }

  const current = mappings.find((item) => item.id === selected);

  return (
    <section className="page tunnel-page">
      <header className="chat-lobby-head">
        <h2>{t("tunnelTitle")}</h2>
        <p className="lede">{t("tunnelLede")}</p>
      </header>
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      {busy ? (
        <div className="glass tunnel-busy">
          <LoadingCat label={t("tunnelBusy")} />
        </div>
      ) : null}

      <div className="glass tunnel-list nav-rooms" role="list" aria-label={t("tunnelList")}>
        <button type="button" className={`nav-btn nav-child nav-new${creating ? " open" : ""}`} onClick={openCreate}>
          {t("tunnelNew")}
        </button>
        {mappings.length === 0 ? <p className="empty">{t("tunnelEmpty")}</p> : null}
        {mappings.map((mapping) => {
          const session = sessionFor(mapping.id, links, sessions);
          const live = isLive(session);
          const primary = mappingPrimary(mapping, t("tunnelEphemeral"));
          const kind = mapping.mode === "serve" ? t("tunnelServe") : mapping.peer;
          const statusKey = statusMessageKey(session?.Status || "stopped");
          const status = statusKey ? t(statusKey) : session?.Status || "";
          return (
            <div key={mapping.id} className="nav-room-row tunnel-row" role="listitem">
              <button
                type="button"
                className={`nav-btn nav-child${selected === mapping.id && !creating ? " active" : ""}`}
                onClick={() => selectMapping(mapping.id)}
              >
                <span className="nav-room-label">
                  <span className="nav-room-primary">{primary}</span>
                  <span className="nav-room-key">
                    {kind} · {status}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="btn btn-ghost tunnel-row-action"
                aria-label={`${live ? t("stop") : t("tunnelStart")} ${primary}`}
                disabled={busy}
                onClick={() => {
                  selectMapping(mapping.id);
                  if (live) {
                    onStop(mapping.id);
                  } else {
                    onStart(mapping.id);
                  }
                }}
              >
                {live ? t("stop") : t("tunnelStart")}
              </button>
              <button
                type="button"
                className="nav-room-close"
                aria-label={`${t("delete")} ${primary}`}
                disabled={busy}
                onClick={() => onDelete(mapping.id)}
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
      </div>

      {creating ? (
        <form className="glass chat-lobby-panel tunnel-detail" onSubmit={submit}>
          <fieldset className="tunnel-mode">
            <legend>{t("tunnelKind")}</legend>
            <label className="check">
              <input
                type="radio"
                name="tunnel-mapping-mode"
                value="serve"
                checked={mode === "serve"}
                onChange={() => setMode("serve")}
              />
              {t("tunnelServe")}
            </label>
            <label className="check">
              <input
                type="radio"
                name="tunnel-mapping-mode"
                value="forward"
                checked={mode === "forward"}
                onChange={() => setMode("forward")}
              />
              {t("tunnelForward")}
            </label>
          </fieldset>
          {mode === "forward" ? (
            <div className="field">
              <label htmlFor="tunnel-fwd-addr">{t("address")}</label>
              <div className="qr-field">
                <input
                  id="tunnel-fwd-addr"
                  value={peer}
                  onChange={(ev) => setPeer(ev.target.value)}
                  placeholder="tc:…"
                  autoComplete="off"
                />
                <QrScanButton
                  onAccept={(value) => {
                    setPeer(value);
                    setFormError("");
                  }}
                />
              </div>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="tunnel-mapping-spec">{mode === "serve" ? t("portMappings") : t("mappings")}</label>
            <input
              id="tunnel-mapping-spec"
              value={mode === "serve" ? serveSpec : forwardSpec}
              onChange={(ev) => (mode === "serve" ? setServeSpec(ev.target.value) : setForwardSpec(ev.target.value))}
              placeholder={mode === "serve" ? "8080" : "8080 or 18080:8080"}
              autoComplete="off"
            />
          </div>
          {mode === "forward" ? (
            <label className="check">
              <input
                id="tunnel-fwd-browser"
                type="checkbox"
                checked={openBrowser}
                onChange={(ev) => setOpenBrowser(ev.target.checked)}
              />
              {t("openInBrowser")}
            </label>
          ) : null}
          {formError ? (
            <p className="err" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="row">
            <button className="btn" type="submit" disabled={busy}>
              {t("tunnelSave")}
            </button>
          </div>
        </form>
      ) : current ? (
        <MappingDetail mapping={current} session={sessionFor(current.id, links, sessions)} onCopy={(text) => void copyText(text)} />
      ) : null}
    </section>
  );
}

function MappingDetail({
  mapping,
  session,
  onCopy,
}: {
  mapping: PortMappingRecord;
  session: Session | undefined;
  onCopy: (text: string) => void;
}) {
  const { t } = useI18n();
  const primary = mappingPrimary(mapping, t("tunnelEphemeral"));
  const statusKey = statusMessageKey(session?.Status || "stopped");
  const kind = mapping.mode === "serve" ? t("tunnelServe") : t("tunnelForward");
  const peerText = mapping.mode === "forward" ? mapping.peer.trim() : "";
  const liveKey = shareableAddress(session?.Address ?? "");
  return (
    <section className="glass tunnel-detail" aria-label={primary}>
      <h3>{primary}</h3>
      <p className="tunnel-meta">
        <span>{kind}</span>
        <span className={`pill ${session?.Status || "stopped"}`}>{statusKey ? t(statusKey) : session?.Status}</span>
        {mapping.openBrowser ? <span>{t("openInBrowser")}</span> : null}
      </p>
      {peerText ? <KeyLine value={peerText} copyLabel={t("tunnelCopyAddress")} onCopy={onCopy} /> : null}
      {session?.Address ? (
        <>
          <KeyLine
            value={session.Address}
            copyLabel={t(mapping.mode === "serve" ? "tunnelCopyAddress" : "tunnelCopyLocal")}
            onCopy={onCopy}
            className="address"
          />
          {mapping.mode === "serve" && liveKey ? <QrShareButton value={liveKey} /> : null}
        </>
      ) : null}
      {session?.Err ? <p className="err">{session.Err}</p> : null}
    </section>
  );
}

function KeyLine({
  value,
  copyLabel,
  onCopy,
  className,
}: {
  value: string;
  copyLabel: string;
  onCopy: (text: string) => void;
  className?: string;
}) {
  return (
    <div className="tunnel-codeblock">
      <pre>
        <code className={className ? `tunnel-key ${className}` : "tunnel-key"} title={value}>
          {value}
        </code>
      </pre>
      <button className="tunnel-code-copy" type="button" aria-label={copyLabel} title={copyLabel} onClick={() => onCopy(value)}>
        <CopyIcon />
      </button>
    </div>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"
      />
    </svg>
  );
}

function sessionFor(id: string, links: Record<string, string>, sessions: Session[]): Session | undefined {
  const sessionID = links[id];
  if (!sessionID) {
    return undefined;
  }
  return sessions.find((session) => session.ID === sessionID);
}

function isLive(session: Session | undefined): boolean {
  return session?.Status === "running" || session?.Status === "starting";
}

function CloseIcon() {
  return (
    <svg className="nav-room-close-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}
