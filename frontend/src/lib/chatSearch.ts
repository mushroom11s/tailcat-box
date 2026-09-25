export type HighlightPart = {
  text: string;
  match: boolean;
};

// matchesQuery is true for a blank search, and otherwise for a case-insensitive substring.
export function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return text.toLowerCase().includes(needle);
}

// highlightParts splits text around case-insensitive matches of query.
export function highlightParts(text: string, query: string): HighlightPart[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) {
    return text ? [{ text, match: false }] : [];
  }
  const lower = text.toLowerCase();
  const parts: HighlightPart[] = [];
  let start = 0;
  while (start < text.length) {
    const at = lower.indexOf(needle, start);
    if (at < 0) {
      parts.push({ text: text.slice(start), match: false });
      break;
    }
    if (at > start) {
      parts.push({ text: text.slice(start, at), match: false });
    }
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    start = at + needle.length;
  }
  return parts;
}
