import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
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
      <h2>Diagnostics</h2>
      <p className="lede">Ping a Tailcat address, watch EventData lines, and inspect active sessions.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="ping-addr">Address</label>
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
          Until direct
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !addr.trim()}>
            Ping
          </button>
        </div>
      </form>
      {error ? <p className="err">{error}</p> : null}
      <h3 className="kind">EventData log</h3>
      <div className="glass result log">{log || "Pong lines will appear here."}</div>
      <h3 className="kind" style={{ marginTop: 24 }}>
        Ping sessions
      </h3>
      <div className="stack">
        {pings.length === 0 ? <p className="empty">No ping sessions yet.</p> : null}
        {pings.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>
      <h3 className="kind" style={{ marginTop: 24 }}>
        Active sessions
      </h3>
      <div className="stack">
        {active.length === 0 ? <p className="empty">No active sessions.</p> : null}
        {active.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>
    </section>
  );
}
