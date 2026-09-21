import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import type { Session } from "../lib/wails";

function kindLabel(kind: string): string {
  if (kind === "pipe_serve") {
    return "Pipe serve";
  }
  if (kind === "pipe_dial") {
    return "Pipe dial";
  }
  if (kind === "port_serve") {
    return "Port serve";
  }
  if (kind === "forward") {
    return "Forward";
  }
  if (kind === "browse") {
    return "Browse";
  }
  if (kind === "ping") {
    return "Ping";
  }
  if (kind === "recv") {
    return "Recv inbox";
  }
  if (kind === "copy") {
    return "Copy";
  }
  if (kind === "files_serve") {
    return "Files serve";
  }
  return kind;
}

async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through to Wails clipboard
  }
  try {
    await ClipboardSetText(text);
  } catch {
    // ignore copy failures in environments without a clipboard
  }
}

type Props = {
  session: Session;
  onStop?: (id: string) => void;
};

export default function SessionCard({ session, onStop }: Props) {
  const stopped = session.Status === "stopped";
  return (
    <article className="glass card">
      <div className="card-head">
        <div className="card-meta">
          <span className="kind">{kindLabel(session.Kind)}</span>
          <span className={`pill ${session.Status}`}>{session.Status}</span>
        </div>
        <div className="card-actions">
          {session.Address ? (
            <button className="btn btn-ghost" type="button" onClick={() => void copyText(session.Address)}>
              Copy
            </button>
          ) : null}
          {onStop && !stopped ? (
            <button className="btn btn-danger" type="button" onClick={() => onStop(session.ID)}>
              Stop
            </button>
          ) : null}
        </div>
      </div>
      {session.Address ? <p className="address">{session.Address}</p> : <p className="empty">No address yet</p>}
      {session.Progress ? <p className="progress">{session.Progress}</p> : null}
      {session.Err ? <p className="err">{session.Err}</p> : null}
    </article>
  );
}
