import { FormEvent, useEffect, useState } from "react";
import { ClipboardSetText } from "../../wailsjs/runtime/runtime";
import { useI18n } from "../i18n";
import type { KeyInfo } from "../lib/wails";

async function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // fall through
  }
  try {
    await ClipboardSetText(text);
  } catch {
    // ignore
  }
}

type Props = {
  keys: KeyInfo[];
  busy: boolean;
  error: string;
  region: string;
  derpMapURL: string;
  roomKey: string;
  appliedKey: string;
  appliedRegion: string;
  appliedDERP: string;
  onRoomKey: (name: string) => void;
  onCreate: (name: string, client: boolean, region: string) => void | Promise<void>;
  onDelete: (name: string) => void | Promise<void>;
  onSaveNetwork: (region: string, derpMapURL: string) => void | Promise<void>;
  onRestart: (keyName: string) => void | Promise<void>;
  canRestart: boolean;
};

export default function KeysDERPSection({
  keys,
  busy,
  error,
  region,
  derpMapURL,
  roomKey,
  appliedKey,
  appliedRegion,
  appliedDERP,
  onRoomKey,
  onCreate,
  onDelete,
  onSaveNetwork,
  onRestart,
  canRestart,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [client, setClient] = useState(false);
  const [keyRegion, setKeyRegion] = useState("");
  const [netRegion, setNetRegion] = useState(region);
  const [netDERP, setNetDERP] = useState(derpMapURL);
  const dirty = roomKey !== appliedKey || region !== appliedRegion || derpMapURL !== appliedDERP;

  useEffect(() => {
    setNetRegion(region);
    setNetDERP(derpMapURL);
  }, [region, derpMapURL]);

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    await onCreate(name.trim(), client, keyRegion.trim());
  }

  return (
    <section className="glass settings-panel">
      <h2>{t("keysDERPTitle")}</h2>
      <h3 className="kind">{t("derpRegion")}</h3>
      <p className="lede">{t("derpLede")}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSaveNetwork(netRegion.trim(), netDERP.trim());
        }}
      >
        <div className="field">
          <label htmlFor="net-region">{t("regionLabel")}</label>
          <input
            id="net-region"
            value={netRegion}
            onChange={(e) => setNetRegion(e.target.value)}
            placeholder="auto, nyc, 1"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="net-derp">{t("derpMapURL")}</label>
          <input
            id="net-derp"
            value={netDERP}
            onChange={(e) => setNetDERP(e.target.value)}
            placeholder="https://tailcat.dev/derpmap.json"
            autoComplete="off"
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>
            {t("saveNetwork")}
          </button>
        </div>
      </form>

      <form onSubmit={(e) => void submitCreate(e)}>
        <div className="field">
          <label htmlFor="key-name">{t("name")}</label>
          <input id="key-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="key-region">{t("regionHint")}</label>
          <input
            id="key-region"
            value={keyRegion}
            onChange={(e) => setKeyRegion(e.target.value)}
            placeholder="auto, nyc, 1"
            autoComplete="off"
            disabled={client}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={client} onChange={(e) => setClient(e.target.checked)} />
          {t("clientIdentityKey")}
        </label>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !name.trim()}>
            {t("createKey")}
          </button>
        </div>
      </form>

      <div className="keys stack">
        {keys.length === 0 ? <p className="empty">{t("emptyKeys")}</p> : null}
        {keys.map((key) => (
          <article key={key.Name + key.Source} className="glass key-row">
            <div className="key-meta">
              <h3>
                {key.Name} {key.Client ? t("keyClient") : t("keyServer")}{" "}
                <span className="pill">{key.Source || "app"}</span>
              </h3>
              <p className="address">{key.Address || t("noAddress")}</p>
            </div>
            <div className="card-actions">
              {key.Address ? (
                <button className="btn btn-ghost" type="button" onClick={() => copyText(key.Address)}>
                  {t("copy")}
                </button>
              ) : null}
              {key.Source !== "cli" ? (
                <button className="btn btn-danger" type="button" disabled={busy} onClick={() => onDelete(key.Name)}>
                  {t("delete")}
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>

      <div className="field">
        <label htmlFor="room-key">{t("chatRoomKey")}</label>
        <select id="room-key" value={roomKey} onChange={(e) => onRoomKey(e.target.value)}>
          <option value="">{t("chatNewRoomKey")}</option>
          {keys.map((key) => (
            <option key={key.Name + key.Source} value={key.Name}>
              {key.Name}
            </option>
          ))}
        </select>
      </div>
      {canRestart && dirty ? <p>{t("chatRestartHint")}</p> : null}
      {!canRestart ? <p>{t("chatNoRoomRestart")}</p> : null}
      <div className="row">
        <button className="btn" type="button" disabled={busy || !canRestart} onClick={() => onRestart(roomKey)}>
          {t("chatRestartRoom")}
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
    </section>
  );
}
