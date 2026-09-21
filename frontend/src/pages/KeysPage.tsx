import { FormEvent, useState } from "react";
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
  parseResult: string;
  resolveResult: string;
  onCreate: (name: string, client: boolean, region: string) => void;
  onDelete: (name: string) => void;
  onParse: (raw: string) => void;
  onResolve: (raw: string) => void;
};

export default function KeysPage({
  keys,
  busy,
  error,
  parseResult,
  resolveResult,
  onCreate,
  onDelete,
  onParse,
  onResolve,
}: Props) {
  const { t } = useI18n();
  const [name, setName] = useState("default");
  const [client, setClient] = useState(false);
  const [region, setRegion] = useState("");
  const [raw, setRaw] = useState("");

  function submitCreate(e: FormEvent) {
    e.preventDefault();
    onCreate(name.trim(), client, region.trim());
  }

  function submitParse(e: FormEvent) {
    e.preventDefault();
    onParse(raw.trim());
  }

  function submitResolve(e: FormEvent) {
    e.preventDefault();
    onResolve(raw.trim());
  }

  return (
    <section className="page">
      <h2>{t("keysTitle")}</h2>
      <p className="lede">{t("keysLede")}</p>

      <form onSubmit={submitCreate}>
        <div className="field">
          <label htmlFor="key-name">{t("name")}</label>
          <input id="key-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="key-region">{t("regionHint")}</label>
          <input
            id="key-region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
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
                <button className="btn btn-ghost" type="button" onClick={() => void copyText(key.Address)}>
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

      <h3 className="kind" style={{ marginTop: 24 }}>
        {t("parseResolve")}
      </h3>
      <form onSubmit={submitParse}>
        <div className="field">
          <label htmlFor="addr-tools">{t("address")}</label>
          <input
            id="addr-tools"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="tc:…"
            autoComplete="off"
          />
        </div>
        <div className="row">
          <button className="btn" type="submit" disabled={busy || !raw.trim()}>
            {t("parse")}
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy || !raw.trim()} onClick={submitResolve}>
            {t("resolve")}
          </button>
        </div>
      </form>
      {error ? <p className="err">{error}</p> : null}
      <h3 className="kind">{t("parseJson")}</h3>
      <div className="glass result">{parseResult || t("parseEmpty")}</div>
      <h3 className="kind">{t("resolvedAddress")}</h3>
      <div className="glass result">{resolveResult || t("resolveEmpty")}</div>
    </section>
  );
}
