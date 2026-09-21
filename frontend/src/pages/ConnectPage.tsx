import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
import type { Session } from "../lib/wails";

type Tab = "pipe" | "forward" | "browse";

type Props = {
  sessions: Session[];
  echo: string;
  busy: boolean;
  error: string;
  onSend: (addr: string, payload: string) => void;
  onForward: (addr: string, spec: string) => void;
  onBrowse: (addr: string) => void;
  onStop: (id: string) => void;
};

export default function ConnectPage({
  sessions,
  echo,
  busy,
  error,
  onSend,
  onForward,
  onBrowse,
  onStop,
}: Props) {
  const [tab, setTab] = useState<Tab>("pipe");
  const [addr, setAddr] = useState("");
  const [payload, setPayload] = useState("hello");
  const [spec, setSpec] = useState("18080:8080");
  const dials = sessions.filter((s) => s.Kind === "pipe_dial");
  const forwards = sessions.filter((s) => s.Kind === "forward");
  const browses = sessions.filter((s) => s.Kind === "browse");

  function submitPipe(e: FormEvent) {
    e.preventDefault();
    onSend(addr.trim(), payload);
  }

  function submitForward(e: FormEvent) {
    e.preventDefault();
    onForward(addr.trim(), spec.trim());
  }

  function submitBrowse(e: FormEvent) {
    e.preventDefault();
    onBrowse(addr.trim());
  }

  return (
    <section className="page">
      <h2>Connect</h2>
      <p className="lede">Dial a Tailcat address over the pipe, forward local TCP ports, or browse a served HTTP port.</p>
      <div className="tabs" role="tablist" aria-label="Connect mode">
        {(["pipe", "forward", "browse"] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      {tab === "pipe" ? (
        <form onSubmit={submitPipe}>
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
      ) : null}

      {tab === "forward" ? (
        <form onSubmit={submitForward}>
          <div className="field">
            <label htmlFor="fwd-addr">Address</label>
            <input
              id="fwd-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="tc:…"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="fwd-spec">Mappings</label>
            <input
              id="fwd-spec"
              value={spec}
              onChange={(e) => setSpec(e.target.value)}
              placeholder="8080 or 18080:8080"
              autoComplete="off"
            />
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy || !addr.trim() || !spec.trim()}>
              Start forward
            </button>
          </div>
        </form>
      ) : null}

      {tab === "browse" ? (
        <form onSubmit={submitBrowse}>
          <div className="field">
            <label htmlFor="browse-addr">Address</label>
            <input
              id="browse-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="tc:…"
              autoComplete="off"
            />
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy || !addr.trim()}>
              Browse port 80
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="err">{error}</p> : null}

      {tab === "pipe" ? (
        <>
          <h3 className="kind">Echo</h3>
          <div className="glass result">{echo || "EventData will appear here."}</div>
          <div className="stack" style={{ marginTop: 16 }}>
            {dials.map((sess) => (
              <SessionCard key={sess.ID} session={sess} onStop={onStop} />
            ))}
          </div>
        </>
      ) : null}

      {tab === "forward" ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {forwards.length === 0 ? <p className="empty">No forward sessions yet.</p> : null}
          {forwards.map((sess) => (
            <SessionCard key={sess.ID} session={sess} onStop={onStop} />
          ))}
        </div>
      ) : null}

      {tab === "browse" ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {browses.length === 0 ? <p className="empty">No browse sessions yet.</p> : null}
          {browses.map((sess) => (
            <SessionCard key={sess.ID} session={sess} onStop={onStop} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
