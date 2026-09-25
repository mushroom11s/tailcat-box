import { FormEvent, KeyboardEvent, useState } from "react";
import QrScanButton from "./QrScanButton";
import QrShareButton from "./QrShareButton";
import { useI18n } from "../i18n";
import { shareableAddress } from "../lib/qr";
import type { SSHDeskState } from "../lib/wails";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";

export type SSHShell = {
  id: string;
  address: string;
  output: string;
};

type Props = {
  desk: SSHDeskState;
  busy: boolean;
  note: string;
  shell: SSHShell | null;
  onToggle: (enabled: boolean) => void;
  onAllowAny: (allow: boolean) => void;
  onAddPeer: (name: string, address: string) => void;
  onRemovePeer: (address: string) => void;
  onShell: (address: string, system: boolean) => void;
  onShellInput: (data: string) => void;
  onShellClose: () => void;
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

export default function SSHDesk({
  desk,
  busy,
  note,
  shell,
  onToggle,
  onAllowAny,
  onAddPeer,
  onRemovePeer,
  onShell,
  onShellInput,
  onShellClose,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [formError, setFormError] = useState("");
  const [confirmAny, setConfirmAny] = useState(false);
  const [phrase, setPhrase] = useState("");
  const liveKey = shareableAddress(desk.Address);
  const live = desk.Enabled && Boolean(desk.Address);
  const status = desk.AllowAny && desk.Enabled ? t("sshStatusAny") : desk.Enabled ? t("sshStatusAllow") : t("sshStatusOff");
  const dotClass = desk.Err ? " bad" : desk.AllowAny && desk.Enabled ? " warn" : desk.Enabled ? "" : " idle";

  function submitPeer(e: FormEvent) {
    e.preventDefault();
    const addr = address.trim();
    if (!addr) {
      setFormError(t("sshPeerRequired"));
      return;
    }
    setFormError("");
    onAddPeer(name.trim(), addr);
    setName("");
    setAddress("");
  }

  function onTermKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      onShellInput("\t");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      onShellInput("\r");
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      onShellInput("\x7f");
      return;
    }
    if (e.ctrlKey && e.key.length === 1) {
      e.preventDefault();
      const code = e.key.toLowerCase().charCodeAt(0);
      if (code >= 97 && code <= 122) {
        onShellInput(String.fromCharCode(code - 96));
      }
      return;
    }
    if (e.key.length === 1 && !e.metaKey && !e.altKey) {
      e.preventDefault();
      onShellInput(e.key);
    }
  }

  return (
    <section className="glass ssh-desk" aria-label={t("sshDeskTitle")}>
      <div className="ssh-head">
        <div className="ssh-title">
          <span className={`status-dot${dotClass}`} aria-hidden="true" />
          <h3>{t("sshDeskTitle")}</h3>
          <span className={`status-pill${desk.Err ? " bad" : desk.AllowAny && desk.Enabled ? " warn" : desk.Enabled ? "" : " quiet"}`}>
            {status}
          </span>
        </div>
        <label className="burn-switch">
          <span>{t("sshAllow")}</span>
          <input
            className="switch"
            type="checkbox"
            role="switch"
            checked={desk.Enabled}
            aria-checked={desk.Enabled}
            disabled={busy}
            onChange={(e) => onToggle(e.target.checked)}
          />
        </label>
      </div>
      <p className="ssh-lede">{t("sshDeskLede")}</p>
      {desk.Err ? (
        <p className="err" role="alert">
          {desk.Err}
        </p>
      ) : null}
      {live ? (
        <div className="ssh-address">
          <span className="ssh-address-label">{t("sshDeskAddress")}</span>
          <div className="tunnel-codeblock">
            <pre>
              <code className="tunnel-key address" title={desk.Address}>
                {desk.Address}
              </code>
            </pre>
            <button
              className="tunnel-code-copy"
              type="button"
              aria-label={t("tunnelCopyAddress")}
              title={t("tunnelCopyAddress")}
              onClick={() => void copyText(desk.Address)}
            >
              <CopyIcon />
            </button>
          </div>
          {liveKey ? <QrShareButton value={liveKey} /> : null}
        </div>
      ) : (
        <p className="chat-quiet">{t("sshAllowHelp")}</p>
      )}
      <div className="ssh-any">
        <label className="burn-switch">
          <span>{t("sshAllowAny")}</span>
          <input
            className="switch"
            type="checkbox"
            role="switch"
            checked={desk.AllowAny}
            aria-checked={desk.AllowAny}
            disabled={busy}
            onChange={(e) => {
              if (e.target.checked) {
                setPhrase("");
                setConfirmAny(true);
                return;
              }
              onAllowAny(false);
            }}
          />
        </label>
        {desk.AllowAny ? <p className="ssh-warn">{t("sshAllowAnyWarn")}</p> : null}
        {desk.RoomPeers.length > 0 ? <p className="chat-quiet">{t("sshRoomPeers")}</p> : null}
      </div>
      <form className="ssh-peer-form" onSubmit={submitPeer}>
        <div className="field">
          <label htmlFor="ssh-peer-name">{t("sshPeerName")}</label>
          <input id="ssh-peer-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="ssh-peer-addr">{t("sshPeerAddress")}</label>
          <div className="qr-field">
            <input
              id="ssh-peer-addr"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setFormError("");
              }}
              placeholder="tc:…"
              autoComplete="off"
            />
            <QrScanButton
              onAccept={(value) => {
                setAddress(value);
                setFormError("");
              }}
            />
          </div>
        </div>
        {formError ? (
          <p className="err" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="ssh-peer-save">
          <button className="btn btn-small" type="submit" disabled={busy || !address.trim()}>
            {t("sshSavePeer")}
          </button>
        </div>
      </form>
      <div className="ssh-peers" role="list">
        {desk.Peers.length === 0 ? <p className="empty">{t("sshEmptyPeers")}</p> : null}
        {desk.Peers.map((peer) => {
          const label = peer.Name.trim() || peer.Address;
          return (
            <div key={peer.Address} className="ssh-peer" role="listitem">
              <span className="status-dot" aria-hidden="true" />
              <div className="ssh-peer-label">
                <span className="nav-room-primary">{label}</span>
                {peer.Name.trim() ? <span className="nav-room-key">{peer.Address}</span> : null}
              </div>
              <div className="ssh-peer-actions">
                <button
                  className="btn btn-small"
                  type="button"
                  disabled={busy}
                  aria-label={`${t("sshOpenShellLabel")} ${label}`}
                  onClick={() => onShell(peer.Address, false)}
                >
                  {t("sshOpenShell")}
                </button>
                <button
                  className="btn btn-ghost btn-small"
                  type="button"
                  disabled={busy}
                  aria-label={`${t("sshOpenTerminalLabel")} ${label}`}
                  onClick={() => onShell(peer.Address, true)}
                >
                  {t("sshOpenTerminal")}
                </button>
                <button
                  className="ssh-icon-btn"
                  type="button"
                  disabled={busy}
                  aria-label={`${t("sshRemovePeer")} ${label}`}
                  title={t("sshRemovePeer")}
                  onClick={() => onRemovePeer(peer.Address)}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {note ? <p className="chat-quiet">{note}</p> : null}
      {shell ? (
        <div className="ssh-shell">
          <div className="ssh-shell-bar">
            <div className="ssh-shell-title">
              <span className="status-dot" aria-hidden="true" />
              <span>{t("sshShell")}</span>
              <code title={shell.address}>{shell.address}</code>
            </div>
            <button className="btn btn-ghost btn-small" type="button" onClick={onShellClose}>
              {t("sshShellClose")}
            </button>
          </div>
          <p className="chat-quiet">{t("sshShellHint")}</p>
          <textarea
            className="ssh-term"
            aria-label={t("sshShell")}
            readOnly
            value={shell.output || t("sshShellEmpty")}
            onKeyDown={onTermKey}
            spellCheck={false}
          />
        </div>
      ) : null}
      {confirmAny ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setConfirmAny(false)}>
          <div
            className="glass modal modal-compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ssh-any-title"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 id="ssh-any-title">{t("sshAllowAnyTitle")}</h3>
            <p>{t("sshAllowAnyBody")}</p>
            <div className="field">
              <label htmlFor="ssh-any-phrase">{t("confirmation")}</label>
              <input
                id="ssh-any-phrase"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="row">
              <button className="btn btn-ghost" type="button" onClick={() => setConfirmAny(false)}>
                {t("cancel")}
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={phrase.trim() !== "ALLOW"}
                onClick={() => {
                  setConfirmAny(false);
                  onAllowAny(true);
                }}
              >
                {t("sshAllowAnyStart")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CloseIcon() {
  return (
    <svg className="nav-room-close-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
    </svg>
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
