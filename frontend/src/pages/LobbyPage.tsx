import type { KeyboardEvent } from "react";
import { useI18n } from "../i18n";

type Props = {
  peer: string;
  error: string;
  onPeer: (value: string) => void;
  onCreate: () => void;
  onConnect: () => void;
};

export default function LobbyPage({ peer, error, onPeer, onCreate, onConnect }: Props) {
  const { t } = useI18n();

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>): void {
    if (ev.key !== "Enter") {
      return;
    }
    ev.preventDefault();
    onConnect();
  }

  return (
    <section className="page chat-lobby">
      <h2>{t("lobbyTitle")}</h2>
      <p className="lede">{t("lobbyHelper")}</p>
      <div className="row">
        <button className="btn" type="button" onClick={onCreate}>
          {t("lobbyCreate")}
        </button>
      </div>
      <div className="field">
        <label htmlFor="lobby-peer">{t("lobbyPeer")}</label>
        <input
          id="lobby-peer"
          value={peer}
          onChange={(ev) => onPeer(ev.target.value)}
          onKeyDown={onKeyDown}
          placeholder="tc…"
          autoComplete="off"
        />
      </div>
      <p className="chat-quiet">{t("lobbyConnectHint")}</p>
      <div className="row">
        <button className="btn" type="button" onClick={onConnect}>
          {t("chatConnect")}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
    </section>
  );
}
