import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
import type { Session } from "../lib/wails";

type Props = {
  sessions: Session[];
  echo: string;
  busy: boolean;
  error: string;
  onSend: (addr: string, payload: string) => void;
  onStop: (id: string) => void;
};

export default function ConnectPage({ sessions, echo, busy, error, onSend, onStop }: Props) {
  const [addr, setAddr] = useState("");
  const [payload, setPayload] = useState("hello");
  const dials = sessions.filter((s) => s.Kind === "pipe_dial");

  function submit(e: FormEvent) {
    e.preventDefault();
    onSend(addr.trim(), payload);
  }

  return (
    <section className="page">
      <h2>Connect</h2>
      <p className="lede">Dial a Tailcat address and send a short text payload over the pipe.</p>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="addr">Address</label>
          <input
            id="addr"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="tc:…"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="payload">Payload</label>
          <textarea id="payload" value={payload} onChange={(e) => setPayload(e.target.value)} />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !addr.trim()}>
            Send
          </button>
        </div>
      </form>
      {error ? <p className="err">{error}</p> : null}
      <h3 className="kind">Echo</h3>
      <div className="glass result">{echo || "EventData will appear here."}</div>
      <div className="stack" style={{ marginTop: 16 }}>
        {dials.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>
    </section>
  );
}
