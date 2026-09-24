import { forwardPortMappings, parsePortMappings, type PortMapping } from "./ports";

export const MAPPINGS_KEY = "tailcat-port-mappings";

export type MappingMode = "serve" | "forward";

export type PortMappingRecord = {
  id: string;
  mode: MappingMode;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  peer: string;
  openBrowser: boolean;
};

export function newMappingId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `map-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function draftMapping(input: {
  mode: MappingMode;
  spec: string;
  peer: string;
  openBrowser: boolean;
}): PortMappingRecord {
  if (input.mode === "forward" && !input.peer.trim()) {
    throw new Error("peer-required");
  }
  const parsed =
    input.mode === "forward"
      ? forwardPortMappings(input.spec, input.openBrowser)
      : parsePortMappings(input.spec);
  if (parsed.length !== 1) {
    throw new Error("one-mapping");
  }
  return mappingRecord({
    mode: input.mode,
    mapping: parsed[0],
    peer: input.peer,
    openBrowser: input.openBrowser,
  });
}

export function mappingRecord(input: {
  id?: string;
  mode: MappingMode;
  mapping: PortMapping;
  peer?: string;
  openBrowser?: boolean;
}): PortMappingRecord {
  return {
    id: input.id ?? newMappingId(),
    mode: input.mode,
    localPort: input.mapping.LocalPort,
    remoteHost: input.mapping.RemoteHost,
    remotePort: input.mapping.RemotePort,
    peer: input.mode === "forward" ? (input.peer ?? "").trim() : "",
    openBrowser: input.mode === "forward" && Boolean(input.openBrowser),
  };
}

export function mappingPrimary(record: PortMappingRecord, ephemeral = "browser"): string {
  if (record.mode === "serve") {
    if (record.remoteHost && record.remotePort) {
      return `${record.localPort} → ${record.remoteHost}:${record.remotePort}`;
    }
    if (record.remotePort) {
      return `${record.localPort} → :${record.remotePort}`;
    }
    return String(record.localPort);
  }
  const local = record.localPort === 0 ? ephemeral : String(record.localPort);
  const remote = record.remoteHost ? `${record.remoteHost}:${record.remotePort}` : `:${record.remotePort}`;
  return `${local} → ${remote}`;
}

export function toPortMapping(record: PortMappingRecord): PortMapping {
  return {
    LocalPort: record.localPort,
    RemoteHost: record.remoteHost,
    RemotePort: record.remotePort,
  };
}

function isPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 65535;
}

function isRecord(value: unknown): value is PortMappingRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !item.id.trim()) {
    return false;
  }
  if (item.mode !== "serve" && item.mode !== "forward") {
    return false;
  }
  if (!isPort(item.localPort) || !isPort(item.remotePort) || typeof item.remoteHost !== "string") {
    return false;
  }
  if (typeof item.peer !== "string" || typeof item.openBrowser !== "boolean") {
    return false;
  }
  if (item.mode === "serve") {
    return item.localPort > 0;
  }
  return item.peer.trim() !== "" && item.remotePort > 0;
}

export function readMappings(): PortMappingRecord[] {
  try {
    const raw = localStorage.getItem(MAPPINGS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isRecord).map((item) => ({
      id: item.id,
      mode: item.mode,
      localPort: item.localPort,
      remoteHost: item.remoteHost,
      remotePort: item.remotePort,
      peer: item.mode === "forward" ? item.peer.trim() : "",
      openBrowser: item.mode === "forward" && item.openBrowser,
    }));
  } catch {
    return [];
  }
}

export function writeMappings(records: PortMappingRecord[]): void {
  try {
    localStorage.setItem(MAPPINGS_KEY, JSON.stringify(records));
  } catch {
    // A full quota or private mode should not break the tunnel page.
  }
}
