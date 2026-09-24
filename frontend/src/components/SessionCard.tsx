import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { kindMessageKey, statusMessageKey, useI18n } from "../i18n";
import { shareableAddress } from "../lib/qr";
import type { Session } from "../lib/wails";
import QrShareButton from "./QrShareButton";

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

const ownAddressKinds = new Set([
  "chat",
  "pipe_serve",
  "port_serve",
  "recv",
  "files_serve",
  "ssh_serve",
  "exit_node",
  "exec",
]);

function ownsShareableAddress(kind: string): boolean {
  return ownAddressKinds.has(kind);
}

type Props = {
  session: Session;
  onStop?: (id: string) => void;
};

export default function SessionCard({ session, onStop }: Props) {
  const { t } = useI18n();
  const stopped = session.Status === "stopped";
  const kindKey = kindMessageKey(session.Kind);
  const statusKey = statusMessageKey(session.Status);
  const key = ownsShareableAddress(session.Kind) ? shareableAddress(session.Address) : "";
  return (
    <article className="glass card">
      <div className="card-head">
        <div className="card-meta">
          <span className="kind">{kindKey ? t(kindKey) : session.Kind}</span>
          <span className={`pill ${session.Status}`}>{statusKey ? t(statusKey) : session.Status}</span>
          {session.Dangerous ? <span className="pill error">{t("dangerous")}</span> : null}
        </div>
        <div className="card-actions">
          {session.Address ? (
            <button className="btn btn-ghost" type="button" onClick={() => void copyText(session.Address)}>
              {t("copy")}
            </button>
          ) : null}
          {key ? <QrShareButton value={key} /> : null}
          {onStop && !stopped ? (
            <button className="btn btn-danger" type="button" onClick={() => onStop(session.ID)}>
              {t("stop")}
            </button>
          ) : null}
        </div>
      </div>
      {session.Address ? <p className="address">{session.Address}</p> : <p className="empty">{t("noAddressYet")}</p>}
      {session.Progress ? <p className="progress">{session.Progress}</p> : null}
      {session.Err ? <p className="err">{session.Err}</p> : null}
    </article>
  );
}
