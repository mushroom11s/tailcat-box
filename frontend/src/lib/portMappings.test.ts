import { beforeEach, describe, expect, it } from "vitest";
import { MAPPINGS_KEY, draftMapping, readMappings, writeMappings } from "./portMappings";

beforeEach(() => {
  localStorage.removeItem(MAPPINGS_KEY);
});

describe("port mapping drafts", () => {
  it("saves one serve port", () => {
    const record = draftMapping({ mode: "serve", spec: "8080", peer: "", openBrowser: false });
    expect(record.mode).toBe("serve");
    expect(record.localPort).toBe(8080);
    expect(record.remoteHost).toBe("");
    expect(record.remotePort).toBe(0);
    expect(record.peer).toBe("");
    expect(record.openBrowser).toBe(false);
    expect(record.id).toBeTruthy();
  });

  it("saves a serve mapping with a remote host", () => {
    const record = draftMapping({
      mode: "serve",
      spec: "5555:127.0.0.1:3306",
      peer: "ignored",
      openBrowser: true,
    });
    expect(record).toMatchObject({
      mode: "serve",
      localPort: 5555,
      remoteHost: "127.0.0.1",
      remotePort: 3306,
      peer: "",
      openBrowser: false,
    });
  });

  it("saves one forward mapping and an ephemeral browser port", () => {
    expect(
      draftMapping({ mode: "forward", spec: "18080:8080", peer: " tc:peer ", openBrowser: false }),
    ).toMatchObject({
      mode: "forward",
      localPort: 18080,
      remoteHost: "",
      remotePort: 8080,
      peer: "tc:peer",
      openBrowser: false,
    });
    expect(
      draftMapping({ mode: "forward", spec: "80", peer: "tc:peer", openBrowser: true }),
    ).toMatchObject({
      localPort: 0,
      remotePort: 80,
      openBrowser: true,
    });
  });

  it("rejects an empty forward peer and more than one mapping", () => {
    expect(() => draftMapping({ mode: "forward", spec: "8080", peer: "  ", openBrowser: false })).toThrow(
      "peer-required",
    );
    expect(() => draftMapping({ mode: "serve", spec: "8080,8443", peer: "", openBrowser: false })).toThrow(
      "one-mapping",
    );
  });
});

describe("port mapping persistence", () => {
  it("round-trips saved mappings and drops invalid entries", () => {
    const serve = draftMapping({ mode: "serve", spec: "8080", peer: "", openBrowser: false });
    const forward = draftMapping({ mode: "forward", spec: "18080:8080", peer: "tc:peer", openBrowser: false });
    writeMappings([serve, forward]);
    expect(readMappings()).toEqual([serve, forward]);

    localStorage.setItem(
      MAPPINGS_KEY,
      JSON.stringify([
        serve,
        { id: "", mode: "serve", localPort: 1, remoteHost: "", remotePort: 0, peer: "", openBrowser: false },
        { id: "bad", mode: "nope" },
        { id: "fwd", mode: "forward", localPort: 1, remoteHost: "", remotePort: 2, peer: "", openBrowser: false },
      ]),
    );
    expect(readMappings()).toEqual([serve]);
    localStorage.setItem(MAPPINGS_KEY, "{");
    expect(readMappings()).toEqual([]);
  });
});
