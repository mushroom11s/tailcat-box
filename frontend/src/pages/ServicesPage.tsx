import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
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
      <h2>Services</h2>
      <p className="lede">Serve an ephemeral pipe or TCP ports and share the Tailcat address with a peer.</p>

      <h3 className="kind">Pipe</h3>
      <div className="row">
        <button className="btn" type="button" disabled={busy} onClick={onStartPipe}>
          Start ephemeral pipe serve
        </button>
      </div>
      <div className="stack">
        {pipes.length === 0 ? <p className="empty">No pipe serve sessions yet.</p> : null}
        {pipes.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      <h3 className="kind" style={{ marginTop: 24 }}>
        Ports
      </h3>
      <p className="lede">Comma-separated ports or mappings such as 8080,8443 or 5555:127.0.0.1:3306.</p>
      <form onSubmit={submitPorts}>
        <div className="field">
          <label htmlFor="ports">Port mappings</label>
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
            Start port serve
          </button>
        </div>
      </form>
      {error ? <p className="err">{error}</p> : null}
      <div className="stack">
        {ports.length === 0 ? <p className="empty">No port serve sessions yet.</p> : null}
        {ports.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>

      <h3 className="kind" style={{ marginTop: 24 }}>
        Files
      </h3>
      <p className="lede">Serve a folder over SFTP, or open Files for recv/send/ls.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onStartFiles(filesDir.trim(), "ro");
        }}
      >
        <div className="field">
          <label htmlFor="files-dir">Directory</label>
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
            Start files serve
          </button>
        </div>
      </form>
      <div className="stack">
        {files.length === 0 ? <p className="empty">No files sessions yet.</p> : null}
        {files.map((sess) => (
          <SessionCard key={sess.ID} session={sess} onStop={onStop} />
        ))}
      </div>
    </section>
  );
}
