import { FormEvent, useEffect, useState } from "react";
import SessionCard from "./SessionCard";
import { useI18n } from "../i18n";
import type { Session, TailcatEvent } from "../lib/wails";

type Props = {
  sessions: Session[];
  events: TailcatEvent[];
  peer: string;
  busy: boolean;
  error: string;
  onPing: (addr: string, untilDirect: boolean) => void | Promise<void>;
  onStop: (id: string) => void | Promise<void>;
};

export default function DiagnosticsSection({ sessions, events, peer, busy, error, onPing, onStop }: Props) {
  const { t } = useI18n();
  const [addr, setAddr] = useState(peer);
  const [dirty, setDirty] = useState(false);
  const [untilDirect, setUntilDirect] = useState(true);
  const chats = sessions.filter((s) => s.Kind === "chat");
  const pings = sessions.filter((s) => s.Kind === "ping");
  const log = events
    .filter((ev) => ev.Kind === "data" && ev.Data)
    .map((ev) => ev.Data as string)
    .join("\n");

  useEffect(() => {
    if (!dirty) {
      setAddr(peer);
    }
  }, [peer, dirty]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void onPing(addr.trim(), untilDirect);
  }

  return (
    <section>
      <h2>{t("diagnosticsSection")}</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="ping-addr">{t("address")}</label>
          <input
            id="ping-addr"
            value={addr}
            onChange={(e) => {
              setDirty(true);
              setAddr(e.target.value);
            }}
            placeholder="tc:…"
            autoComplete="off"
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={untilDirect} onChange={(e) => setUntilDirect(e.target.checked)} />
          {t("untilDirect")}
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !addr.trim()}>
            {t("ping")}
          </button>
        </div>
      </form>
      {error ? <p className="err">{error}</p> : null}
      <h3 className="kind">{t("eventLog")}</h3>
      <div className="glass result log">{log || t("eventLogEmpty")}</div>
      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("chatSession")}
      </h3>
      <div className="stack">
        {chats.length === 0 ? <p className="empty">{t("emptyActive")}</p> : null}
        {chats.map((sess) => (
          <SessionCard key={sess.ID} session={sess} />
        ))}
      </div>
      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("pingSessions")}
      </h3>
      <div className="stack">
        {pings.length === 0 ? <p className="empty">{t("emptyPings")}</p> : null}
        {pings.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>
    </section>
  );
}
