import { describe, expect, it } from "vitest";
import { forwardPortMappings } from "./ports";

describe("forwardPortMappings", () => {
  it("keeps an explicit local:remote mapping", () => {
    expect(forwardPortMappings("18080:8080", true)).toEqual([
      { LocalPort: 18080, RemoteHost: "", RemotePort: 8080 },
    ]);
  });

  it("treats a bare port as the remote port with an ephemeral local listener when opening a browser", () => {
    expect(forwardPortMappings("80", false)).toEqual([{ LocalPort: 80, RemoteHost: "", RemotePort: 0 }]);
    expect(forwardPortMappings("80", true)).toEqual([{ LocalPort: 0, RemoteHost: "", RemotePort: 80 }]);
  });

  it("leaves an explicit ephemeral mapping unchanged", () => {
    expect(forwardPortMappings("0:80", true)).toEqual([{ LocalPort: 0, RemoteHost: "", RemotePort: 80 }]);
  });
});
