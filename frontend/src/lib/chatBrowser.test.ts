import { describe, expect, it } from "vitest";
import { createBrowserHub } from "./chatBrowser";

describe("browser hub", () => {
  it("starts once, echoes text, and restarts onto a saved key", async () => {
    const hub = createBrowserHub();
    const first = await hub.start("sess-1", "");
    const second = await hub.start("sess-2", "");
    expect(second.address).toBe(first.address);
    expect(first.address.startsWith("tc:fake-room-")).toBe(true);
    await expect(hub.connect("nope")).rejects.toThrow("Paste a Tailcat address that starts with tc.");
    await hub.connect("tc:fake-echo");
    const events: Array<{ Kind: string; Data?: string }> = [];
    hub.onEvent((ev) => events.push(ev));
    await hub.sendText("hi");
    const bodies = events
      .filter((ev) => ev.Kind === "message")
      .map((ev) => JSON.parse(ev.Data ?? "{}") as { body: string; direction: string });
    expect(bodies).toEqual([
      expect.objectContaining({ direction: "out", body: "hi" }),
      expect.objectContaining({ direction: "in", body: "echo" }),
    ]);
    const restarted = await hub.restart("sess-3", `{"fake":"k1"}`);
    expect(restarted.address.startsWith("tc:fake-room-key-")).toBe(true);
    expect(restarted.address).not.toBe(first.address);
    const same = await hub.restart("sess-4", `{"fake":"k1"}`);
    expect(same.address).toBe(restarted.address);
  });
});
