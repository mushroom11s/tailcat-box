import { FormEvent, useState } from "react";
import SessionCard from "../components/SessionCard";
import { useI18n } from "../i18n";
import { selectDirectory, selectFiles, type FileEntry, type Session } from "../lib/wails";

type Tab = "recv" | "send" | "serve" | "ls";

type Props = {
  sessions: Session[];
  listing: FileEntry[];
  busy: boolean;
  error: string;
  onRecv: (inboxDir: string, acceptDirs: boolean) => void;
  onSend: (addr: string, localPaths: string[], remotePath: string) => void;
  onServe: (rootDir: string, mode: string) => void;
  onList: (addr: string, path: string) => void;
  onStop: (id: string) => void;
};

export default function FilesPage({
  sessions,
  listing,
  busy,
  error,
  onRecv,
  onSend,
  onServe,
  onList,
  onStop,
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("recv");
  const [inbox, setInbox] = useState("");
  const [acceptDirs, setAcceptDirs] = useState(false);
  const [addr, setAddr] = useState("");
  const [localPaths, setLocalPaths] = useState("");
  const [remotePath, setRemotePath] = useState(".");
  const [rootDir, setRootDir] = useState("");
  const [mode, setMode] = useState("ro");
  const [listPath, setListPath] = useState(".");

  const recvs = sessions.filter((s) => s.Kind === "recv");
  const copies = sessions.filter((s) => s.Kind === "copy");
  const serves = sessions.filter((s) => s.Kind === "files_serve");

  async function pickDir(setter: (v: string) => void, title: string): Promise<void> {
    try {
      const dir = await selectDirectory(title);
      if (dir) {
        setter(dir);
      }
    } catch {
      // Native picker is unavailable in the browser fake; keep the typed path.
    }
  }

  async function pickFiles(): Promise<void> {
    try {
      const files = await selectFiles(t("pickSendFiles"));
      if (files.length) {
        setLocalPaths(files.join("\n"));
      }
    } catch {
      // keep typed paths
    }
  }

  function submitRecv(e: FormEvent) {
    e.preventDefault();
    onRecv(inbox.trim(), acceptDirs);
  }

  function submitSend(e: FormEvent) {
    e.preventDefault();
    const paths = localPaths
      .split(/\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    onSend(addr.trim(), paths, remotePath.trim() || ".");
  }

  function submitServe(e: FormEvent) {
    e.preventDefault();
    onServe(rootDir.trim(), mode);
  }

  function submitList(e: FormEvent) {
    e.preventDefault();
    onList(addr.trim(), listPath.trim() || ".");
  }

  const tabLabel: Record<Tab, "tabRecv" | "tabSend" | "tabServe" | "tabList"> = {
    recv: "tabRecv",
    send: "tabSend",
    serve: "tabServe",
    ls: "tabList",
  };

  return (
    <section className="page">
      <h2>{t("filesTitle")}</h2>
      <p className="lede">{t("filesLede")}</p>
      <div className="tabs" role="tablist" aria-label={t("filesMode")}>
        {(["recv", "send", "serve", "ls"] as Tab[]).map((value) => (
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

      {tab === "recv" ? (
        <form onSubmit={submitRecv}>
          <div className="field">
            <label htmlFor="inbox">{t("inboxDirectory")}</label>
            <input
              id="inbox"
              value={inbox}
              onChange={(e) => setInbox(e.target.value)}
              placeholder="/home/me/inbox or C:\Users\me\inbox"
              autoComplete="off"
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={acceptDirs} onChange={(e) => setAcceptDirs(e.target.checked)} />
            {t("acceptDirs")}
          </label>
          <div className="row">
            <button className="btn btn-ghost" type="button" onClick={() => void pickDir(setInbox, t("pickRecvInbox"))}>
              {t("browse")}
            </button>
            <button className="btn" type="submit" disabled={busy || !inbox.trim()}>
              {t("startRecv")}
            </button>
          </div>
        </form>
      ) : null}

      {tab === "send" ? (
        <form onSubmit={submitSend}>
          <div className="field">
            <label htmlFor="send-addr">{t("peerAddress")}</label>
            <input
              id="send-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="tc:…"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="send-paths">{t("localPaths")}</label>
            <textarea
              id="send-paths"
              value={localPaths}
              onChange={(e) => setLocalPaths(e.target.value)}
              placeholder={"/tmp/hello.txt\nC:\\Users\\me\\photo.jpg"}
            />
          </div>
          <div className="field">
            <label htmlFor="send-remote">{t("remotePath")}</label>
            <input
              id="send-remote"
              value={remotePath}
              onChange={(e) => setRemotePath(e.target.value)}
              placeholder="."
              autoComplete="off"
            />
          </div>
          <div className="row">
            <button className="btn btn-ghost" type="button" onClick={() => void pickFiles()}>
              {t("browseFiles")}
            </button>
            <button className="btn" type="submit" disabled={busy || !addr.trim() || !localPaths.trim()}>
              {t("send")}
            </button>
          </div>
        </form>
      ) : null}

      {tab === "serve" ? (
        <form onSubmit={submitServe}>
          <div className="field">
            <label htmlFor="serve-dir">{t("directory")}</label>
            <input
              id="serve-dir"
              value={rootDir}
              onChange={(e) => setRootDir(e.target.value)}
              placeholder="/home/me/share or C:\Users\me\share"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="serve-mode">{t("mode")}</label>
            <select id="serve-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="ro">{t("modeRo")}</option>
              <option value="rw">{t("modeRw")}</option>
              <option value="wo">{t("modeWo")}</option>
              <option value="wo+">{t("modeWoPlus")}</option>
            </select>
          </div>
          <div className="row">
            <button className="btn btn-ghost" type="button" onClick={() => void pickDir(setRootDir, t("pickServeDir"))}>
              {t("browse")}
            </button>
            <button className="btn" type="submit" disabled={busy || !rootDir.trim()}>
              {t("startFilesServe")}
            </button>
          </div>
        </form>
      ) : null}

      {tab === "ls" ? (
        <form onSubmit={submitList}>
          <div className="field">
            <label htmlFor="ls-addr">{t("peerAddress")}</label>
            <input
              id="ls-addr"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="tc:…"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="ls-path">{t("remotePath")}</label>
            <input
              id="ls-path"
              value={listPath}
              onChange={(e) => setListPath(e.target.value)}
              placeholder="."
              autoComplete="off"
            />
          </div>
          <div className="row">
            <button className="btn" type="submit" disabled={busy || !addr.trim()}>
              {t("list")}
            </button>
          </div>
        </form>
      ) : null}

      {error ? <p className="err">{error}</p> : null}

      {tab === "ls" ? (
        <div className="glass result" style={{ marginTop: 16, overflow: "auto" }}>
          {listing.length === 0 ? (
            <p className="empty" style={{ margin: 0 }}>
              {t("listingEmpty")}
            </p>
          ) : (
            <table className="listing">
              <thead>
                <tr>
                  <th>{t("listingName")}</th>
                  <th>{t("listingSize")}</th>
                  <th>{t("listingMode")}</th>
                </tr>
              </thead>
              <tbody>
                {listing.map((ent) => (
                  <tr key={ent.Name}>
                    <td>
                      {ent.Name}
                      {ent.IsDir ? "/" : ""}
                    </td>
                    <td>{ent.IsDir ? "—" : String(ent.Size)}</td>
                    <td>{ent.Mode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {tab === "recv" ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {recvs.length === 0 ? <p className="empty">{t("emptyRecv")}</p> : null}
          {recvs.map((sess) => (
            <SessionCard key={sess.ID} session={sess} onStop={onStop} />
          ))}
        </div>
      ) : null}

      {tab === "send" ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {copies.length === 0 ? <p className="empty">{t("emptyCopy")}</p> : null}
          {copies.map((sess) => (
            <SessionCard key={sess.ID} session={sess} onStop={onStop} />
          ))}
        </div>
      ) : null}

      {tab === "serve" ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {serves.length === 0 ? <p className="empty">{t("emptyFilesServe")}</p> : null}
          {serves.map((sess) => (
            <SessionCard key={sess.ID} session={sess} onStop={onStop} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
