import { useState, type KeyboardEvent } from "react";
import LoadingCat from "../components/LoadingCat";
import QrScanButton from "../components/QrScanButton";
import { useI18n, type MessageKey } from "../i18n";
import { useClipboardFieldPaste, type PasteFailure } from "../lib/clipboardPaste";
import { extractShareableAddress } from "../lib/qr";

export type LobbyKey = {
  name: string;
  source: string;
};

type Props = {
  peer: string;
  error: string;
  keys: LobbyKey[];
  keyName: string;
  keyDraft: string;
  onPeer: (value: string) => void;
  onKey: (value: string) => void;
  onKeyDraft: (value: string) => void;
  onCreate: () => void;
  onCreatePermanent: () => void;
  onSaveKey: () => void;
  onConnect: () => void;
  busy: "" | "temp" | "permanent" | "connect";
};

export default function LobbyPage({
  peer,
  error,
  keys,
  keyName,
  keyDraft,
  onPeer,
  onKey,
  onKeyDraft,
  onCreate,
  onCreatePermanent,
  onSaveKey,
  onConnect,
  busy,
}: Props) {
  const { t } = useI18n();
  const [pasteError, setPasteError] = useState("");
  const pending = busy !== "";

  function peerPasteFailure(reason: PasteFailure): MessageKey {
    if (reason === "empty") {
      return "qrPasteEmpty";
    }
    if (reason === "unusable") {
      return "qrPasteUnusable";
    }
    if (reason === "denied") {
      return "qrPasteDenied";
    }
    if (reason === "no-qr") {
      return "qrNotFound";
    }
    return "chatAddrError";
  }

  const onPeerPaste = useClipboardFieldPaste(
    peer,
    (value) => {
      setPasteError("");
      onPeer(value);
    },
    extractShareableAddress,
    (reason) => setPasteError(t(peerPasteFailure(reason))),
  );

  function acceptPeer(raw: string): { ok: true; value: string } | { ok: false } {
    const value = extractShareableAddress(raw);
    return value ? { ok: true, value } : { ok: false };
  }

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>): void {
    if (ev.key !== "Enter" || pending) {
      return;
    }
    ev.preventDefault();
    onConnect();
  }

  function onKeyDraftKey(ev: KeyboardEvent<HTMLInputElement>): void {
    if (ev.key !== "Enter" || pending) {
      return;
    }
    ev.preventDefault();
    onSaveKey();
  }

  function panelBusy(active: boolean, label: string) {
    if (!active) {
      return null;
    }
    return (
      <div className="chat-lobby-busy">
        <LoadingCat layout="block" label={label} />
      </div>
    );
  }

  return (
    <section className="page chat-lobby">
      <header className="chat-lobby-head">
        <h2>{t("lobbyTitle")}</h2>
        <p className="lede">{t("lobbyHelper")}</p>
      </header>

      <div className="glass chat-lobby-panel">
        <h3>{t("lobbyTempTitle")}</h3>
        {panelBusy(busy === "temp", t("lobbyCreating"))}
        {busy === "temp" ? null : (
          <button className="btn" type="button" disabled={pending} onClick={onCreate}>
            {t("lobbyCreate")}
          </button>
        )}
      </div>

      <div className="glass chat-lobby-panel">
        <h3>{t("lobbyPermanent")}</h3>
        {panelBusy(busy === "permanent", t("lobbyCreating"))}
        <div className="field">
          <label htmlFor="lobby-key">{t("lobbyKey")}</label>
          <select id="lobby-key" value={keyName} onChange={(ev) => onKey(ev.target.value)}>
            <option value="">{t("lobbyKeyPlaceholder")}</option>
            {keys.map((key) => (
              <option key={`${key.source}:${key.name}`} value={key.name}>
                {key.source && key.source !== "app" ? `${key.name} · ${key.source}` : key.name}
              </option>
            ))}
          </select>
        </div>
        {busy === "permanent" ? null : (
          <div className="row">
            <button className="btn btn-ghost" type="button" disabled={pending} onClick={onCreatePermanent}>
              {t("chatRestartRoom")}
            </button>
          </div>
        )}
        <div className="chat-lobby-key-save">
          <div className="field">
            <label htmlFor="lobby-key-name">{t("lobbyNewKey")}</label>
            <input
              id="lobby-key-name"
              value={keyDraft}
              onChange={(ev) => onKeyDraft(ev.target.value)}
              onKeyDown={onKeyDraftKey}
              autoComplete="off"
            />
          </div>
          <button className="btn btn-ghost" type="button" disabled={pending} onClick={onSaveKey}>
            {t("lobbySaveKey")}
          </button>
        </div>
      </div>

      <div className="glass chat-lobby-panel">
        {panelBusy(busy === "connect", t("lobbyConnecting"))}
        <div className="field">
          <label htmlFor="lobby-peer">{t("lobbyPeer")}</label>
          <div className="qr-field">
            <input
              id="lobby-peer"
              value={peer}
              onChange={(ev) => {
                setPasteError("");
                onPeer(ev.target.value);
              }}
              onPaste={onPeerPaste}
              onKeyDown={onKeyDown}
              placeholder="tc…"
              autoComplete="off"
            />
            <QrScanButton
              disabled={pending}
              accept={acceptPeer}
              invalidKey="chatAddrError"
              normalizePastedText={extractShareableAddress}
              onAccept={(value) => {
                setPasteError("");
                onPeer(value);
              }}
            />
          </div>
          {pasteError ? (
            <p className="err" role="alert">
              {pasteError}
            </p>
          ) : null}
        </div>
        <p className="chat-quiet">{t("lobbyConnectHint")}</p>
        {busy === "connect" ? null : (
          <button className="btn btn-ghost" type="button" disabled={pending} onClick={onConnect}>
            {t("chatConnect")}
          </button>
        )}
      </div>

      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
