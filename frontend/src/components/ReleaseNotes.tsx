import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { isAbsoluteHttpURL } from "../lib/releaseNotes";
import { openHttpURL } from "../lib/wails";

type Props = {
  markdown: string;
};

function noteUrl(url: string, key: string): string {
  if (!isAbsoluteHttpURL(url)) {
    return "";
  }
  if (key === "src" && !url.trim().toLowerCase().startsWith("https://")) {
    return "";
  }
  return url.trim();
}

function NoteLink({ href, children }: ComponentProps<"a">) {
  if (!href || !isAbsoluteHttpURL(href)) {
    return <>{children}</>;
  }
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      onClick={(event) => {
        event.preventDefault();
        openHttpURL(href);
      }}
    >
      {children}
    </a>
  );
}

function NoteImage({ src, alt }: ComponentProps<"img">) {
  if (typeof src !== "string" || !src.startsWith("https://") || !isAbsoluteHttpURL(src)) {
    return null;
  }
  return <img src={src} alt={alt ?? ""} loading="lazy" />;
}

function NoteCheckbox({ type, checked }: ComponentProps<"input">) {
  if (type !== "checkbox") {
    return null;
  }
  return <input type="checkbox" defaultChecked={Boolean(checked)} disabled />;
}

export default function ReleaseNotes({ markdown }: Props) {
  const source = markdown.trim();
  if (!source) {
    return null;
  }
  return (
    <div className="update-notes-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        skipHtml
        urlTransform={noteUrl}
        components={{
          a: NoteLink,
          img: NoteImage,
          input: NoteCheckbox,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
