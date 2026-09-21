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

  it("sends a voice note and echoes it from the fake peer", async () => {
    const hub = createBrowserHub();
    await hub.start("sess-voice", "");
    await hub.connect("tc:fake-echo");
    const events: Array<{ Kind: string; Data?: string }> = [];
    hub.onEvent((ev) => events.push(ev));
    await hub.sendVoice("audio/webm;codecs=opus", 0, Uint8Array.from([1, 2]), true, 5);
    const messages = events
      .filter((ev) => ev.Kind === "message")
      .map((ev) => JSON.parse(ev.Data ?? "{}") as { direction: string; type: string; duration: number; burn?: boolean; audio: string });
    expect(messages).toEqual([
      expect.objectContaining({ direction: "out", type: "voice", duration: 1, burn: true, audio: messages[0]?.audio }),
      expect.objectContaining({ direction: "in", type: "voice", duration: 1, burn: true, audio: messages[0]?.audio }),
    ]);
    expect(messages[0]?.audio).toBe(btoa("\u0001\u0002"));
  });

  it("delivers a signal envelope from one fake room to the other", async () => {
    const a = createBrowserHub();
    const b = createBrowserHub();
    const addrA = (await a.start("sig-a", "")).address;
    const addrB = (await b.start("sig-b", "")).address;
    await a.connect(addrB);
    await b.connect(addrA);
    const events: Array<{ Kind: string; Data?: string }> = [];
    b.onEvent((ev) => events.push(ev));
    const meta = JSON.stringify({
      v: 1,
      type: "rtc-offer",
      mode: "screen",
      description: { type: "offer", sdp: "v=0" },
    });
    a.sendSignal(meta);
    expect(events).toEqual([expect.objectContaining({ Kind: "signal", Data: meta })]);
    a.stop();
    b.stop();
  });

  it("lets an official peer accept a voice note without answering", async () => {
    const hub = createBrowserHub();
    await hub.start("sess-official", "");
    await hub.connect("tc:fake-official");
    const events: Array<{ Kind: string; Data?: string }> = [];
    hub.onEvent((ev) => events.push(ev));
    await hub.sendVoice("audio/pcm;rate=48000;channels=1", 3, Uint8Array.from([0, 1]), false, 0);
    const messages = events.filter((ev) => ev.Kind === "message").map((ev) => JSON.parse(ev.Data ?? "{}") as { direction: string });
    expect(messages).toEqual([expect.objectContaining({ direction: "out", type: "voice", duration: 3 })]);
  });
});
