import SessionCard from "../components/SessionCard";
import type { Session } from "../lib/wails";

type Props = {
  sessions: Session[];
  busy: boolean;
  error: string;
  onStart: () => void;
  onStop: (id: string) => void;
};

export default function ServicesPage({ sessions, busy, error, onStart, onStop }: Props) {
  const serves = sessions.filter((s) => s.Kind === "pipe_serve");
  return (
    <section className="page">
      <h2>Services</h2>
      <p className="lede">Start an ephemeral Tailcat pipe server and share its address with a peer.</p>
      <div className="row">
        <button className="btn" type="button" disabled={busy} onClick={onStart}>
          Start ephemeral pipe serve
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <div className="stack">
        {serves.length === 0 ? <p className="empty">No pipe serve sessions yet.</p> : null}
        {serves.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>
    </section>
  );
}
