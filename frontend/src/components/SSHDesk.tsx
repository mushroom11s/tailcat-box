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
      <h3 className="kind">{t("sshDeskTitle")}</h3>
      <p className="lede">{t("sshDeskLede")}</p>
      <label className="check">
        <input
          type="checkbox"
          checked={desk.Enabled}
          disabled={busy}
          onChange={(e) => onToggle(e.target.checked)}
        />
        {t("sshAllow")}
      </label>
      <p className="ssh-help">{t("sshAllowHelp")}</p>
      {desk.Err ? (
        <p className="err" role="alert">
          {desk.Err}
        </p>
      ) : null}
      {desk.Enabled && desk.Address ? (
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
      ) : null}
      <label className="check">
        <input
          type="checkbox"
          checked={desk.AllowAny}
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
        {t("sshAllowAny")}
      </label>
      {desk.AllowAny ? <p className="ssh-warn">{t("sshAllowAnyWarn")}</p> : null}
      {desk.RoomPeers.length > 0 ? <p className="ssh-help">{t("sshRoomPeers")}</p> : null}
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
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !address.trim()}>
            {t("sshSavePeer")}
          </button>
        </div>
      </form>
      <div className="stack ssh-peers">
        {desk.Peers.length === 0 ? <p className="empty">{t("sshEmptyPeers")}</p> : null}
        {desk.Peers.map((peer) => {
          const label = peer.Name.trim() || peer.Address;
          return (
            <div key={peer.Address} className="ssh-peer">
              <div className="ssh-peer-label">
                <span>{label}</span>
                {peer.Name.trim() ? <code>{peer.Address}</code> : null}
              </div>
              <div className="row">
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  aria-label={`${t("sshOpenShellLabel")} ${label}`}
                  onClick={() => onShell(peer.Address, false)}
                >
                  {t("sshOpenShell")}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy}
                  aria-label={`${t("sshOpenTerminalLabel")} ${label}`}
                  onClick={() => onShell(peer.Address, true)}
                >
                  {t("sshOpenTerminal")}
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy}
                  aria-label={`${t("sshRemovePeer")} ${label}`}
                  onClick={() => onRemovePeer(peer.Address)}
                >
                  {t("sshRemovePeer")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {note ? <p className="ssh-help">{note}</p> : null}
      {shell ? (
        <div className="ssh-shell">
          <div className="row ssh-shell-bar">
            <span>{t("sshShell")}</span>
            <button className="btn btn-ghost" type="button" onClick={onShellClose}>
              {t("sshShellClose")}
            </button>
          </div>
          <p className="ssh-help">{t("sshShellHint")}</p>
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
