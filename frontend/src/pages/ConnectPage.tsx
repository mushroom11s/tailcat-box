import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
import { useI18n } from "../i18n";
import type { Session } from "../lib/wails";

type Tab = "pipe" | "forward" | "browse" | "ssh" | "socks";

type Props = {
  sessions: Session[];
  echo: string;
  busy: boolean;
  error: string;
  onSend: (addr: string, payload: string) => void;
  onForward: (addr: string, spec: string) => void;
  onBrowse: (addr: string) => void;
  onSSH: (addr: string, command: string, user: string, identity: string) => void;
  onSOCKS: (addr: string, listen: string) => void;
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
  onSSH,
  onSOCKS,
  onStop,
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("pipe");
  const [addr, setAddr] = useState("");
  const [payload, setPayload] = useState("hello");
  const [spec, setSpec] = useState("18080:8080");
  const [sshCmd, setSshCmd] = useState("whoami");
  const [sshUser, setSshUser] = useState("");
  const [sshIdentity, setSshIdentity] = useState("");
  const [socksListen, setSocksListen] = useState("127.0.0.1:1080");
  const dials = sessions.filter((s) => s.Kind === "pipe_dial");
  const forwards = sessions.filter((s) => s.Kind === "forward");
  const browses = sessions.filter((s) => s.Kind === "browse");
  const ssh = sessions.filter((s) => s.Kind === "ssh_client");
  const socks = sessions.filter((s) => s.Kind === "socks");

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

  const tabLabel: Record<Tab, "tabPipe" | "tabForward" | "tabBrowse" | "tabSSH" | "tabSOCKS"> = {
    pipe: "tabPipe",
    forward: "tabForward",
    browse: "tabBrowse",
    ssh: "tabSSH",
    socks: "tabSOCKS",
  };

  return (
    <section className="page">
      <h2>{t("connectTitle")}</h2>
      <p className="lede">{t("connectLede")}</p>
      <div className="tabs" role="tablist" aria-label={t("connectMode")}>
        {(["pipe", "forward", "browse", "ssh", "socks"] as Tab[]).map((value) => (
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

      {tab === "ssh" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSSH(addr.trim(), sshCmd.trim(), sshUser.trim(), sshIdentity.trim());
          }}
        >
          <div className="field">
            <label htmlFor="ssh-addr">{t("address")}</label>
            <input
              id="ssh-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="tc:…"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="ssh-user">{t("sshUser")}</label>
            <input id="ssh-user" value={sshUser} onChange={(e) => setSshUser(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="ssh-cmd">{t("sshCommand")}</label>
            <input
              id="ssh-cmd"
              value={sshCmd}
              onChange={(e) => setSshCmd(e.target.value)}
              placeholder="whoami"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="ssh-id">{t("sshIdentity")}</label>
            <input
              id="ssh-id"
              value={sshIdentity}
              onChange={(e) => setSshIdentity(e.target.value)}
              placeholder="/home/me/.ssh/id_ed25519"
              autoComplete="off"
            />
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy || !addr.trim()}>
              {t("runSSH")}
            </button>
          </div>
        </form>
      ) : null}

      {tab === "socks" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSOCKS(addr.trim(), socksListen.trim());
          }}
        >
          <div className="field">
            <label htmlFor="socks-addr">{t("socksPeer")}</label>
            <input
              id="socks-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="tc:…"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="socks-listen">{t("socksListen")}</label>
            <input
              id="socks-listen"
              value={socksListen}
              onChange={(e) => setSocksListen(e.target.value)}
              placeholder="127.0.0.1:1080"
              autoComplete="off"
            />
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy || !addr.trim()}>
              {t("startSOCKS")}
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

      {tab === "ssh" ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {ssh.length === 0 ? <p className="empty">{t("emptySSHClient")}</p> : null}
          {ssh.map((sess) => (
            <SessionCard key={sess.ID} session={sess} onStop={onStop} />
          ))}
        </div>
      ) : null}

      {tab === "socks" ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {socks.length === 0 ? <p className="empty">{t("emptySOCKS")}</p> : null}
          {socks.map((sess) => (
            <SessionCard key={sess.ID} session={sess} onStop={onStop} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
