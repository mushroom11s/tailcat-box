import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
import { useI18n } from "../i18n";
import type { Session, TailcatEvent } from "../lib/wails";

type Props = {
  sessions: Session[];
  events: TailcatEvent[];
  busy: boolean;
  error: string;
  onPing: (addr: string, untilDirect: boolean) => void;
  onStop: (id: string) => void;
};

export default function DiagnosticsPage({ sessions, events, busy, error, onPing, onStop }: Props) {
  const { t } = useI18n();
  const [addr, setAddr] = useState("");
  const [untilDirect, setUntilDirect] = useState(true);
  const pings = sessions.filter((s) => s.Kind === "ping");
  const active = sessions.filter((s) => s.Status !== "stopped");
  const log = events
    .filter((ev) => ev.Kind === "data" && ev.Data)
    .map((ev) => ev.Data as string)
    .join("\n");

  function submit(e: FormEvent) {
    e.preventDefault();
    onPing(addr.trim(), untilDirect);
  }

  return (
    <section className="page">
      <h2>{t("diagnosticsTitle")}</h2>
      <p className="lede">{t("diagnosticsLede")}</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="ping-addr">{t("address")}</label>
          <input
            id="ping-addr"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
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
        {t("pingSessions")}
      </h3>
      <div className="stack">
        {pings.length === 0 ? <p className="empty">{t("emptyPings")}</p> : null}
        {pings.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>
      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("activeSessions")}
      </h3>
      <div className="stack">
        {active.length === 0 ? <p className="empty">{t("emptyActive")}</p> : null}
        {active.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>
    </section>
  );
}
