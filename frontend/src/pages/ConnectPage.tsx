import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
import { useI18n } from "../i18n";
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
  const { t } = useI18n();
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

  const tabLabel: Record<Tab, "tabPipe" | "tabForward" | "tabBrowse"> = {
    pipe: "tabPipe",
    forward: "tabForward",
    browse: "tabBrowse",
  };

  return (
    <section className="page">
      <h2>{t("connectTitle")}</h2>
      <p className="lede">{t("connectLede")}</p>
      <div className="tabs" role="tablist" aria-label={t("connectMode")}>
        {(["pipe", "forward", "browse"] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {t(tabLabel[value])}
          </button>
        ))}
      </div>

      {tab === "pipe" ? (
        <form onSubmit={submitPipe}>
          <div className="field">
            <label htmlFor="addr">{t("address")}</label>
            <input
              id="addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="tc:…"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="payload">{t("payload")}</label>
            <textarea id="payload" value={payload} onChange={(e) => setPayload(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy || !addr.trim()}>
              {t("send")}
            </button>
          </div>
        </form>
      ) : null}

      {tab === "forward" ? (
        <form onSubmit={submitForward}>
          <div className="field">
            <label htmlFor="fwd-addr">{t("address")}</label>
            <input
              id="fwd-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="tc:…"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="fwd-spec">{t("mappings")}</label>
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
              {t("startForward")}
            </button>
          </div>
        </form>
      ) : null}

      {tab === "browse" ? (
        <form onSubmit={submitBrowse}>
          <div className="field">
            <label htmlFor="browse-addr">{t("address")}</label>
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
              {t("browsePort80")}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="err">{error}</p> : null}

      {tab === "pipe" ? (
        <>
          <h3 className="kind">{t("echo")}</h3>
          <div className="glass result">{echo || t("echoEmpty")}</div>
          <div className="stack" style={{ marginTop: 16 }}>
            {dials.map((sess) => (
              <SessionCard key={sess.ID} session={sess} onStop={onStop} />
            ))}
          </div>
        </>
      ) : null}

      {tab === "forward" ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {forwards.length === 0 ? <p className="empty">{t("emptyForwards")}</p> : null}
          {forwards.map((sess) => (
            <SessionCard key={sess.ID} session={sess} onStop={onStop} />
          ))}
        </div>
      ) : null}

      {tab === "browse" ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {browses.length === 0 ? <p className="empty">{t("emptyBrowses")}</p> : null}
          {browses.map((sess) => (
            <SessionCard key={sess.ID} session={sess} onStop={onStop} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
