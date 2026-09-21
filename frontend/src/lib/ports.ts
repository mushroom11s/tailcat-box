export type PortMapping = {
  LocalPort: number;
  RemoteHost: string;
  RemotePort: number;
};

export function parsePortMappings(spec: string): PortMapping[] {
  const parts = spec
    .split(/[,\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error("enter at least one port or mapping");
  }
  return parts.map(parseOne);
}

function parseOne(raw: string): PortMapping {
  const bits = raw.split(":");
  if (bits.length === 1) {
    return { LocalPort: parsePort(bits[0]), RemoteHost: "", RemotePort: 0 };
  }
  if (bits.length === 2) {
    return { LocalPort: parsePort(bits[0], true), RemoteHost: "", RemotePort: parsePort(bits[1]) };
  }
  if (bits.length === 3) {
    return {
      LocalPort: parsePort(bits[0], true),
      RemoteHost: bits[1],
      RemotePort: parsePort(bits[2]),
    };
  }
  throw new Error("invalid mapping " + raw);
}

function parsePort(s: string, allowZero = false): number {
  if (!/^\d+$/.test(s)) {
    throw new Error("invalid port " + s);
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error("invalid port " + s);
  }
  if (n === 0 && !allowZero) {
    throw new Error("invalid port " + s);
  }
  return n;
}
