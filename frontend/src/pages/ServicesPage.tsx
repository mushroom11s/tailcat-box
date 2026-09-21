import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
import { useI18n } from "../i18n";
import type { Session } from "../lib/wails";

type Props = {
  sessions: Session[];
  busy: boolean;
  error: string;
  onStartPipe: () => void;
  onStartPorts: (spec: string) => void;
  onStartFiles: (dir: string, mode: string) => void;
  onStartSSH: (noAuth: boolean, authorizedKeys: string, confirmDangerous: boolean) => void;
  onStartExitNode: () => void;
  onStartExec: (command: string) => void;
  onStop: (id: string) => void;
};

export default function ServicesPage({
  sessions,
  busy,
  error,
  onStartPipe,
  onStartPorts,
  onStartFiles,
  onStartSSH,
  onStartExitNode,
  onStartExec,
  onStop,
}: Props) {
  const { t } = useI18n();
  const [spec, setSpec] = useState("8080");
  const [filesDir, setFilesDir] = useState("");
  const [noAuth, setNoAuth] = useState(false);
  const [authorizedKeys, setAuthorizedKeys] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [execCmd, setExecCmd] = useState("/bin/cat");
  const pipes = sessions.filter((s) => s.Kind === "pipe_serve");
  const ports = sessions.filter((s) => s.Kind === "port_serve");
  const files = sessions.filter((s) => s.Kind === "files_serve" || s.Kind === "recv");
  const ssh = sessions.filter((s) => s.Kind === "ssh_serve");
  const exits = sessions.filter((s) => s.Kind === "exit_node");
  const execs = sessions.filter((s) => s.Kind === "exec");

  function submitPorts(e: FormEvent) {
    e.preventDefault();
    onStartPorts(spec.trim());
  }

  return (
    <section className="page">
      <h2>{t("servicesTitle")}</h2>
      <p className="lede">{t("servicesLede")}</p>

      <h3 className="kind">{t("pipe")}</h3>
      <div className="row">
        <button className="btn" type="button" disabled={busy} onClick={onStartPipe}>
          {t("startPipeServe")}
        </button>
      </div>
      <div className="stack">
        {pipes.length === 0 ? <p className="empty">{t("emptyPipes")}</p> : null}
        {pipes.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("ports")}
      </h3>
      <p className="lede">{t("portsLede")}</p>
      <form onSubmit={submitPorts}>
        <div className="field">
          <label htmlFor="ports">{t("portMappings")}</label>
          <input
            id="ports"
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
      {error ? <p className="err">{error}</p> : null}
      <div className="stack">
        {ports.length === 0 ? <p className="empty">{t("emptyPorts")}</p> : null}
        {ports.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("files")}
      </h3>
      <p className="lede">{t("servicesFilesLede")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onStartFiles(filesDir.trim(), "ro");
        }}
      >
        <div className="field">
          <label htmlFor="files-dir">{t("directory")}</label>
          <input
            id="files-dir"
            value={filesDir}
            onChange={(e) => setFilesDir(e.target.value)}
            placeholder="/home/me/share or C:\Users\me\share"
            autoComplete="off"
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !filesDir.trim()}>
            {t("startFilesServe")}
          </button>
        </div>
      </form>
      <div className="stack">
        {files.length === 0 ? <p className="empty">{t("emptyFiles")}</p> : null}
        {files.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("ssh")}
      </h3>
      <p className="lede">{t("sshLede")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (noAuth) {
            setConfirmPhrase("");
            setConfirmOpen(true);
            return;
          }
          onStartSSH(false, authorizedKeys.trim(), false);
        }}
      >
        <label className="check">
          <input type="checkbox" checked={noAuth} onChange={(e) => setNoAuth(e.target.checked)} />
          {t("noAuthSSH")}
        </label>
        <div className="field">
          <label htmlFor="ssh-keys">{t("authorizedKeys")}</label>
          <textarea
            id="ssh-keys"
            value={authorizedKeys}
            onChange={(e) => setAuthorizedKeys(e.target.value)}
            placeholder="ssh-ed25519 AAAA… comment  or  /home/me/.ssh/authorized_keys"
            disabled={noAuth}
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || (!noAuth && !authorizedKeys.trim())}>
            {t("startSSHServe")}
          </button>
        </div>
      </form>
      <div className="stack">
        {ssh.length === 0 ? <p className="empty">{t("emptySSHServe")}</p> : null}
        {ssh.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("exitNode")}
      </h3>
      <p className="lede">{t("exitNodeLede")}</p>
      <div className="row">
        <button className="btn" type="button" disabled={busy} onClick={onStartExitNode}>
          {t("startExitNode")}
        </button>
      </div>
      <div className="stack">
        {exits.length === 0 ? <p className="empty">{t("emptyExitNode")}</p> : null}
        {exits.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("exec")}
      </h3>
      <p className="lede">{t("execLede")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onStartExec(execCmd.trim());
        }}
      >
        <div className="field">
          <label htmlFor="exec-cmd">{t("command")}</label>
          <input
            id="exec-cmd"
            value={execCmd}
            onChange={(e) => setExecCmd(e.target.value)}
            placeholder="/usr/bin/fortune"
            autoComplete="off"
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !execCmd.trim()}>
            {t("startExecServe")}
          </button>
        </div>
      </form>
      <div className="stack">
        {execs.length === 0 ? <p className="empty">{t("emptyExec")}</p> : null}
        {execs.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      {confirmOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setConfirmOpen(false)}>
          <div
            className="glass modal"
            role="dialog"
            aria-labelledby="noauth-title"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="noauth-title">{t("noAuthTitle")}</h3>
            <p>{t("noAuthBody")}</p>
            <div className="field">
              <label htmlFor="confirm-phrase">{t("confirmation")}</label>
              <input
                id="confirm-phrase"
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="row">
              <button className="btn btn-ghost" type="button" onClick={() => setConfirmOpen(false)}>
                {t("cancel")}
              </button>
              <button
                className="btn btn-danger"
                type="button"
                disabled={busy || confirmPhrase !== "CONFIRM"}
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmPhrase("");
                  onStartSSH(true, "", true);
                }}
              >
                {t("startNoAuthSSH")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
