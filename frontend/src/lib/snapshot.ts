import type { KeyInfo, Session } from "./wails";

export function sameSessions(a: Session[], b: Session[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.ID !== y.ID ||
      x.Kind !== y.Kind ||
      x.Status !== y.Status ||
      x.Address !== y.Address ||
      x.Err !== y.Err ||
      x.Progress !== y.Progress ||
      x.Dangerous !== y.Dangerous
    ) {
      return false;
    }
  }
  return true;
}

export function sameKeys(a: KeyInfo[], b: KeyInfo[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.Name !== y.Name || x.Path !== y.Path || x.Client !== y.Client || x.Address !== y.Address || x.Source !== y.Source) {
      return false;
    }
  }
  return true;
}
