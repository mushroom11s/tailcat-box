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
  onStop: (id: string) => void;
};

export default function ServicesPage({
  sessions,
  busy,
  error,
  onStartPipe,
  onStartPorts,
  onStartFiles,
  onStop,
}: Props) {
  const { t } = useI18n();
  const [spec, setSpec] = useState("8080");
  const [filesDir, setFilesDir] = useState("");
  const pipes = sessions.filter((s) => s.Kind === "pipe_serve");
  const ports = sessions.filter((s) => s.Kind === "port_serve");
  const files = sessions.filter((s) => s.Kind === "files_serve" || s.Kind === "recv");

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
    </section>
  );
}
