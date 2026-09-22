export const opusMIME = "audio/webm;codecs=opus";

export type VoiceTake = {
  mime: string;
  durationSec: number;
  audio: Uint8Array;
};

export type VoiceCapture = {
  stop: () => Promise<VoiceTake>;
};

type RecorderLike = {
  state: string;
  mimeType: string;
  start: () => void;
  stop: () => void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
};

export function opusRecorderAvailable(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(opusMIME)
  );
}

export async function startVoiceCapture(): Promise<VoiceCapture> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access was denied.");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error("Microphone access was denied.");
  }
  try {
    if (opusRecorderAvailable()) {
      return await recordOpus(stream);
    }
    return await recordPCM(stream);
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    if (err instanceof Error && err.message === "Microphone access was denied.") {
      throw err;
    }
    throw new Error("Microphone access was denied.");
  }
}

async function recordOpus(stream: MediaStream): Promise<VoiceCapture> {
  const rec = new MediaRecorder(stream, { mimeType: opusMIME }) as RecorderLike;
  const chunks: Blob[] = [];
  rec.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };
  const stopped = new Promise<void>((resolve, reject) => {
    rec.onstop = () => resolve();
    rec.onerror = () => reject(new Error("Microphone access was denied."));
  });
  const started = performance.now();
  rec.start();
  return {
    async stop() {
      if (rec.state !== "inactive") {
        rec.stop();
      }
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || opusMIME });
      return {
        mime: blob.type || opusMIME,
        durationSec: elapsedSeconds(started),
        audio: new Uint8Array(await blob.arrayBuffer()),
      };
    },
  };
}

async function recordPCM(stream: MediaStream): Promise<VoiceCapture> {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    throw new Error("Microphone access was denied.");
  }
  const ctx = new Ctx({ sampleRate: 48000 });
  const source = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  proc.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(proc);
  proc.connect(ctx.destination);
  const started = performance.now();
  const rate = ctx.sampleRate || 48000;
  return {
    async stop() {
      proc.disconnect();
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await ctx.close();
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const audio = new Uint8Array(total * 2);
      const view = new DataView(audio.buffer);
      let offset = 0;
      for (const chunk of chunks) {
        for (let i = 0; i < chunk.length; i++) {
          const sample = Math.max(-1, Math.min(1, chunk[i]));
          view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
          offset += 2;
        }
      }
      return {
        mime: `audio/pcm;rate=${Math.round(rate)};channels=1`,
        durationSec: elapsedSeconds(started),
        audio,
      };
    },
  };
}

function elapsedSeconds(started: number): number {
  return Math.max(1, Math.round((performance.now() - started) / 1000));
}
