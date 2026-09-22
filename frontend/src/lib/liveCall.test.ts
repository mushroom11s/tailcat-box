import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cameraDeniedError,
  createLiveCall,
  iceServers,
  liveMediaError,
  micDeniedError,
  screenDeniedError,
  screenUnavailableError,
  type SignalMeta,
} from "./liveCall";

type FakeTrack = {
  kind: "audio" | "video";
  stop: ReturnType<typeof vi.fn>;
  addEventListener: (type: string, fn: () => void) => void;
  removeEventListener: (type: string, fn: () => void) => void;
  end: () => void;
};

function fakeStream(kinds: Array<"audio" | "video">) {
  const tracks: FakeTrack[] = kinds.map((kind) => {
    const ended = new Set<() => void>();
    return {
      kind,
      stop: vi.fn(),
      addEventListener(type: string, fn: () => void) {
        if (type === "ended") {
          ended.add(fn);
        }
      },
      removeEventListener(type: string, fn: () => void) {
        if (type === "ended") {
          ended.delete(fn);
        }
      },
      end() {
        ended.forEach((fn) => fn());
      },
    };
  });
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  };
}

class FakePC {
  static instances: FakePC[] = [];
  static holdNext = false;
  iceGatheringState: RTCIceGatheringState = "new";
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  config: RTCConfiguration;
  closed = false;
  holdGathering = false;
  tracks: unknown[] = [];
  private listeners = new Map<string, Set<(event?: unknown) => void>>();

  constructor(config?: RTCConfiguration) {
    this.config = config ?? {};
    this.holdGathering = FakePC.holdNext;
    FakePC.holdNext = false;
    FakePC.instances.push(this);
  }

  addEventListener(type: string, fn: (event?: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: (event?: unknown) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  emit(type: string, event?: unknown): void {
    this.listeners.get(type)?.forEach((fn) => fn(event));
  }

  close(): void {
    this.closed = true;
    this.connectionState = "closed";
    this.emit("connectionstatechange");
  }

  addTrack(track: unknown): void {
    this.tracks.push(track);
  }

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0" };
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "v=0" };
  }

  async setLocalDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.localDescription = { type: desc.type, sdp: desc.sdp };
    if (this.holdGathering) {
      this.iceGatheringState = "gathering";
      this.emit("icegatheringstatechange");
      return;
    }
    this.iceGatheringState = "complete";
    this.localDescription = { type: desc.type, sdp: `${desc.sdp}\r\na=candidate:1 1 udp 1 1.2.3.4 9 typ host` };
    this.emit("icegatheringstatechange");
  }

  async setRemoteDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.remoteDescription = desc;
  }

  fail(): void {
    this.connectionState = "failed";
    this.emit("connectionstatechange");
  }
}

const PeerConnection = FakePC as unknown as new (config?: RTCConfiguration) => RTCPeerConnection;

function offer(mode: "voice" | "video" | "screen"): string {
  return JSON.stringify({ v: 1, type: "rtc-offer", mode, description: { type: "offer", sdp: "v=remote" } });
}

afterEach(() => {
  FakePC.instances = [];
  FakePC.holdNext = false;
  vi.useRealTimers();
});

function setup(extra?: {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  gatherTimeoutMs?: number;
}) {
  const sent: SignalMeta[] = [];
  const voice = fakeStream(["audio"]);
  const video = fakeStream(["audio", "video"]);
  const screen = fakeStream(["video", "audio"]);
  const getUserMedia = extra?.getUserMedia ?? vi.fn(async (constraints: MediaStreamConstraints) => (constraints.video ? video : voice) as unknown as MediaStream);
  const getDisplayMedia = extra && "getDisplayMedia" in extra ? extra.getDisplayMedia : vi.fn(async () => screen as unknown as MediaStream);
  const call = createLiveCall({
    send: async (meta) => {
      sent.push(meta);
    },
    devices: () => ({ getUserMedia, getDisplayMedia }),
    PeerConnection: () => PeerConnection,
    gatherTimeoutMs: extra?.gatherTimeoutMs,
  });
  return { call, sent, getUserMedia, getDisplayMedia, voice, video, screen };
}

describe("live WebRTC signaling", () => {
  it("sends one voice offer after ICE gathering completes, with only the Google STUN server", async () => {
    const { call, sent } = setup();
    await call.start("voice");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ v: 1, type: "rtc-offer", mode: "voice" });
    expect(sent[0].description?.sdp).toContain("a=candidate:");
    expect(FakePC.instances[0]?.config.iceServers).toEqual(iceServers);
    expect(call.snapshot()).toMatchObject({ phase: "live", role: "caller", mode: "voice" });
  });

  it("sends the offer after 5 seconds when gathering never completes", async () => {
    vi.useFakeTimers();
    FakePC.holdNext = true;
    const { call, sent } = setup();
    const pending = call.start("voice");
    await vi.advanceTimersByTimeAsync(4999);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(sent).toHaveLength(1);
    expect(sent[0].description?.sdp).toBe("v=0");
  });

  it("captures audio and video for a video call and display media for screen share", async () => {
    const { call, sent, getUserMedia, getDisplayMedia, screen } = setup();
    await call.start("video");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: true });
    await call.start("screen");
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(sent.map((meta) => meta.mode)).toEqual(["video", "screen"]);
    expect(sent.some((meta) => meta.type === "rtc-hangup")).toBe(false);
    expect(FakePC.instances[0]?.closed).toBe(true);
    screen.getVideoTracks()[0]?.end();
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe("rtc-hangup"));
    expect(call.snapshot().phase).toBe("idle");
    expect(call.snapshot().error).toBe("");
  });

  it("ignores an inbound offer while building an outgoing offer", async () => {
    let release: (stream: MediaStream) => void = () => undefined;
    const pendingMedia = new Promise<MediaStream>((resolve) => {
      release = resolve;
    });
    const getUserMedia = vi.fn(() => pendingMedia);
    const { call, sent } = setup({ getUserMedia });
    const starting = call.start("voice");
    await Promise.resolve();
    await call.receive(offer("video"));
    expect(sent).toEqual([]);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    release(fakeStream(["audio"]) as unknown as MediaStream);
    await starting;
    expect(sent.map((meta) => meta.type)).toEqual(["rtc-offer"]);
    expect(sent[0]?.mode).toBe("voice");
  });

  it("does not send hangup when the caller cancels before the offer is sent", async () => {
    let release: (stream: MediaStream) => void = () => undefined;
    const pendingMedia = new Promise<MediaStream>((resolve) => {
      release = resolve;
    });
    const { call, sent } = setup({ getUserMedia: () => pendingMedia });
    const starting = call.start("voice");
    await Promise.resolve();
    await call.hangup();
    release(fakeStream(["audio"]) as unknown as MediaStream);
    await starting;
    expect(sent).toEqual([]);
    expect(call.snapshot().phase).toBe("idle");
  });

  it("sends rtc-hangup for an established link and answers a screen offer without local capture", async () => {
    const { call, sent, getUserMedia, getDisplayMedia } = setup();
    await call.start("voice");
    await call.hangup();
    expect(sent.at(-1)).toMatchObject({ type: "rtc-hangup" });
    await call.receive(offer("screen"));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(sent.at(-1)).toMatchObject({ type: "rtc-answer", description: { type: "answer", sdp: expect.stringContaining("a=candidate:") } });
    expect(sent.at(-1)?.mode).toBeUndefined();
    expect(call.snapshot()).toMatchObject({ phase: "live", role: "answerer", mode: "screen" });
  });

  it("captures only audio when answering a voice offer", async () => {
    const { call, getUserMedia } = setup();
    await call.receive(offer("voice"));
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it("ends a failed link with the relay error and leaves another call possible", async () => {
    const { call, sent } = setup();
    await call.start("voice");
    FakePC.instances.at(-1)?.fail();
    await vi.waitFor(() => expect(sent.at(-1)?.type).toBe("rtc-hangup"));
    expect(call.snapshot().error).toBe(liveMediaError);
    expect(call.snapshot().phase).toBe("idle");
    await call.start("video");
    expect(call.snapshot()).toMatchObject({ phase: "live", mode: "video", error: "" });
  });

  it("reports permission denials and a missing screen API without placing a call", async () => {
    const denied = setup({
      getUserMedia: async () => {
        throw new DOMException("denied", "NotAllowedError");
      },
    });
    await denied.call.start("voice");
    expect(denied.call.snapshot().error).toBe(micDeniedError);
    await denied.call.start("video");
    expect(denied.call.snapshot().error).toBe(cameraDeniedError);
    const micOnVideo = setup({
      getUserMedia: async () => {
        throw new Error("Permission denied for microphone");
      },
    });
    await micOnVideo.call.start("video");
    expect(micOnVideo.call.snapshot().error).toBe(micDeniedError);
    const unavailable = setup({ getDisplayMedia: undefined });
    await unavailable.call.start("screen");
    expect(unavailable.call.snapshot().error).toBe(screenUnavailableError);
    const blocked = setup({
      getDisplayMedia: async () => {
        throw new Error("denied");
      },
    });
    await blocked.call.start("screen");
    expect(blocked.call.snapshot().error).toBe(screenDeniedError);
    expect(denied.sent).toEqual([]);
    expect(unavailable.sent).toEqual([]);
    expect(blocked.sent).toEqual([]);
  });

  it("clears the dock on a remote hangup without sending another hangup", async () => {
    const { call, sent } = setup();
    await call.start("voice");
    await call.receive(JSON.stringify({ v: 1, type: "rtc-hangup" }));
    expect(call.snapshot().phase).toBe("idle");
    expect(sent.map((meta) => meta.type)).toEqual(["rtc-offer"]);
  });
});
