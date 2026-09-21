import { afterEach, describe, expect, it, vi } from "vitest";
import { opusMIME, startVoiceCapture } from "./voiceCapture";

const tracks = { getTracks: () => [{ stop: vi.fn() }] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voice capture", () => {
  it("records audio/webm;codecs=opus when MediaRecorder supports it", async () => {
    class FakeRecorder {
      state = "inactive";
      mimeType = opusMIME;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        this.state = "recording";
        this.ondataavailable?.({ data: new Blob([Uint8Array.from([1, 2, 3, 4])], { type: opusMIME }) });
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
      static isTypeSupported(mime: string) {
        return mime === opusMIME;
      }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => tracks) },
    });
    const capture = await startVoiceCapture();
    const take = await capture.stop();
    expect(take.mime).toBe(opusMIME);
    expect(take.durationSec).toBeGreaterThanOrEqual(1);
    expect(Array.from(take.audio)).toEqual([1, 2, 3, 4]);
  });

  it("captures PCM when webm opus is unavailable", async () => {
    class FakeRecorder {
      static isTypeSupported() {
        return false;
      }
    }
    const node = {
      onaudioprocess: null as ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null,
      connect() {},
      disconnect() {},
    };
    class FakeContext {
      sampleRate = 16000;
      destination = {};
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      createScriptProcessor() {
        queueMicrotask(() => {
          node.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array([0.5, -0.5]) } });
        });
        return node;
      }
      close() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: vi.fn(async () => tracks) },
    });
    const capture = await startVoiceCapture();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const take = await capture.stop();
    expect(take.mime).toBe("audio/pcm;rate=16000;channels=1");
    expect(take.audio.length).toBe(4);
  });

  it("reports denied microphone access", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(async () => {
          throw new DOMException("no", "NotAllowedError");
        }),
      },
    });
    await expect(startVoiceCapture()).rejects.toThrow("Microphone access was denied.");
  });
});
