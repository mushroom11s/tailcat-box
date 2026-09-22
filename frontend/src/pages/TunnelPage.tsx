import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
import { useI18n } from "../i18n";
import type { Session } from "../lib/wails";

type Props = {
  sessions: Session[];
  busy: boolean;
  error: string;
  onStartPorts: (spec: string) => void;
  onForward: (addr: string, spec: string) => void;
  onBrowse: (addr: string) => void;
  onStop: (id: string) => void;
};

export default function TunnelPage({ sessions, busy, error, onStartPorts, onForward, onBrowse, onStop }: Props) {
  const { t } = useI18n();
  const [spec, setSpec] = useState("8080");
  const [addr, setAddr] = useState("");
  const [fwd, setFwd] = useState("18080:8080");
  const ports = sessions.filter((s) => s.Kind === "port_serve");
  const forwards = sessions.filter((s) => s.Kind === "forward");
  const browses = sessions.filter((s) => s.Kind === "browse");

  function submitPorts(e: FormEvent) {
    e.preventDefault();
    onStartPorts(spec.trim());
  }

  function submitForward(e: FormEvent) {
    e.preventDefault();
    onForward(addr.trim(), fwd.trim());
  }

  function submitBrowse(e: FormEvent) {
    e.preventDefault();
    onBrowse(addr.trim());
  }

  return (
    <section className="page">
      <h2>{t("tunnelTitle")}</h2>
      <p className="lede">{t("tunnelLede")}</p>
      {error ? <p className="err">{error}</p> : null}

      <h3 className="kind">{t("tunnelServe")}</h3>
      <p className="lede">{t("portsLede")}</p>
      <form onSubmit={submitPorts}>
        <div className="field">
          <label htmlFor="tunnel-ports">{t("portMappings")}</label>
          <input
            id="tunnel-ports"
            value={spec}
            onChange={(e) => setSpec(e.target.value)}
            placeholder="8080,8443"
            autoComplete="off"
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !spec.trim()}>
            {t("startPortServe")}
          </button>
        </div>
      </form>
      <div className="stack">
        {ports.length === 0 ? <p className="empty">{t("emptyPorts")}</p> : null}
        {ports.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("tunnelForward")}
      </h3>
      <form onSubmit={submitForward}>
        <div className="field">
          <label htmlFor="tunnel-fwd-addr">{t("address")}</label>
          <input
            id="tunnel-fwd-addr"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="tc:…"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="tunnel-fwd-spec">{t("mappings")}</label>
          <input
            id="tunnel-fwd-spec"
            value={fwd}
            onChange={(e) => setFwd(e.target.value)}
            placeholder="8080 or 18080:8080"
            autoComplete="off"
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !addr.trim() || !fwd.trim()}>
            {t("startForward")}
          </button>
        </div>
      </form>
      <div className="stack">
        {forwards.length === 0 ? <p className="empty">{t("emptyForwards")}</p> : null}
        {forwards.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("tunnelBrowse")}
      </h3>
      <form onSubmit={submitBrowse}>
        <div className="field">
          <label htmlFor="tunnel-browse-addr">{t("address")}</label>
          <input
            id="tunnel-browse-addr"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="tc:…"
            autoComplete="off"
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !addr.trim()}>
            {t("browsePort80")}
          </button>
        </div>
      </form>
      <div className="stack">
        {browses.length === 0 ? <p className="empty">{t("emptyBrowses")}</p> : null}
        {browses.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>
    </section>
  );
}
