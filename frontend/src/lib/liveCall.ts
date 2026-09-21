export const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
export const gatherTimeoutMs = 5000;

export const micDeniedError = "Microphone access was denied.";
export const cameraDeniedError = "Camera access was denied.";
export const screenDeniedError = "Screen sharing was denied.";
export const screenUnavailableError = "Screen sharing is unavailable on this system.";
export const liveMediaError =
  "Live media failed. Restrictive networks have no relay for calls, so voice and video can fail while chat still works.";

export type CallMode = "voice" | "video" | "screen";

export type SignalMeta = {
  v: 1;
  type: "rtc-offer" | "rtc-answer" | "rtc-hangup";
  mode?: CallMode;
  description?: { type: RTCSdpType; sdp: string };
};

export type CallView = {
  phase: "idle" | "building" | "live";
  mode: CallMode | null;
  role: "caller" | "answerer" | null;
  expanded: boolean;
  error: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
};

export type LiveDevices = {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getDisplayMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
};

export type LiveCall = {
  start: (mode: CallMode) => Promise<void>;
  hangup: () => Promise<void>;
  receive: (raw: string) => Promise<void>;
  toggleExpanded: () => void;
  snapshot: () => CallView;
};

type PeerCtor = new (config?: RTCConfiguration) => RTCPeerConnection;

type Options = {
  send: (meta: SignalMeta) => Promise<void>;
  devices?: () => LiveDevices | null | undefined;
  PeerConnection?: () => PeerCtor;
  gatherTimeoutMs?: number;
  onChange?: (view: CallView) => void;
};

export function createLiveCall(options: Options): LiveCall {
  const timeout = options.gatherTimeoutMs ?? gatherTimeoutMs;
  let generation = 0;
  let buildingOffer = false;
  let signaled = false;
  let expanded = false;
  let phase: CallView["phase"] = "idle";
  let mode: CallMode | null = null;
  let role: CallView["role"] = null;
  let error = "";
  let localStream: MediaStream | null = null;
  let remoteStream: MediaStream | null = null;
  let pc: RTCPeerConnection | null = null;
  const retired = new WeakSet<RTCPeerConnection>();

  function snapshot(): CallView {
    return { phase, mode, role, expanded, error, localStream, remoteStream };
  }

  function publish(): void {
    options.onChange?.(snapshot());
  }

  function devices(): LiveDevices {
    return options.devices?.() ?? defaultDevices();
  }

  function stopStream(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  function retire(current: RTCPeerConnection | null): void {
    if (!current) {
      return;
    }
    retired.add(current);
    if (pc === current) {
      pc = null;
    }
    current.close();
  }

  function resetMedia(): void {
    retire(pc);
    stopStream(localStream);
    localStream = null;
    remoteStream = null;
  }

  async function capture(nextMode: CallMode): Promise<MediaStream> {
    const media = devices();
    if (nextMode === "screen") {
      if (typeof media.getDisplayMedia !== "function") {
        throw new Error(screenUnavailableError);
      }
      try {
        return await media.getDisplayMedia({ video: true, audio: true });
      } catch {
        throw new Error(screenDeniedError);
      }
    }
    if (typeof media.getUserMedia !== "function") {
      throw new Error(nextMode === "voice" ? micDeniedError : cameraDeniedError);
    }
    try {
      if (nextMode === "voice") {
        return await media.getUserMedia({ audio: true });
      }
      return await media.getUserMedia({ audio: true, video: true });
    } catch (err) {
      if (nextMode === "voice") {
        throw new Error(micDeniedError);
      }
      const text = err instanceof Error ? `${err.name} ${err.message}`.toLowerCase() : "";
      if (text.includes("microphone") || (text.includes("audio") && !text.includes("video") && !text.includes("camera"))) {
        throw new Error(micDeniedError);
      }
      throw new Error(cameraDeniedError);
    }
  }

  function watchEnded(track: MediaStreamTrack, gen: number): void {
    track.addEventListener("ended", () => {
      if (gen !== generation || mode !== "screen") {
        return;
      }
      void api.hangup();
    });
  }

  function openPeer(gen: number): RTCPeerConnection {
    const Ctor = options.PeerConnection?.() ?? RTCPeerConnection;
    if (typeof Ctor !== "function") {
      throw new Error(liveMediaError);
    }
    const next = new Ctor({ iceServers });
    pc = next;
    next.addEventListener("track", (event) => {
      if (pc !== next) {
        return;
      }
      const trackEvent = event as RTCTrackEvent;
      const remote =
        trackEvent.streams?.[0] ??
        (trackEvent.track && typeof MediaStream === "function" ? new MediaStream([trackEvent.track]) : null);
      if (remote) {
        remoteStream = remote;
        publish();
      }
      if (mode === "screen" && trackEvent.track?.kind === "video") {
        watchEnded(trackEvent.track, gen);
      }
    });
    const onState = () => {
      if (retired.has(next) || pc !== next || gen !== generation) {
        return;
      }
      if (next.connectionState === "failed" || next.connectionState === "closed" || next.iceConnectionState === "failed") {
        failLive();
      }
    };
    next.addEventListener("connectionstatechange", onState);
    next.addEventListener("iceconnectionstatechange", onState);
    return next;
  }

  function addLocal(next: RTCPeerConnection, stream: MediaStream): void {
    stream.getTracks().forEach((track) => next.addTrack(track, stream));
  }

  function failLive(): void {
    const notify = signaled;
    generation += 1;
    buildingOffer = false;
    signaled = false;
    resetMedia();
    phase = "idle";
    mode = null;
    role = null;
    error = liveMediaError;
    publish();
    if (notify) {
      void options.send({ v: 1, type: "rtc-hangup" }).catch(() => undefined);
    }
  }

  async function describeLocal(next: RTCPeerConnection, gen: number): Promise<{ type: RTCSdpType; sdp: string } | null> {
    await waitGathering(next, timeout);
    if (gen !== generation) {
      return null;
    }
    const desc = next.localDescription;
    if (!desc?.sdp || !desc.type) {
      throw new Error(liveMediaError);
    }
    return { type: desc.type, sdp: desc.sdp };
  }

  const api: LiveCall = {
    async start(nextMode) {
      const gen = ++generation;
      buildingOffer = true;
      signaled = false;
      resetMedia();
      phase = "building";
      mode = nextMode;
      role = "caller";
      error = "";
      publish();
      try {
        const stream = await capture(nextMode);
        if (gen !== generation) {
          stopStream(stream);
          return;
        }
        localStream = stream;
        if (nextMode === "screen") {
          stream.getVideoTracks().forEach((track) => watchEnded(track, gen));
        }
        publish();
        const next = openPeer(gen);
        addLocal(next, stream);
        const offer = await next.createOffer();
        if (gen !== generation) {
          return;
        }
        await next.setLocalDescription(offer);
        if (gen !== generation) {
          return;
        }
        const description = await describeLocal(next, gen);
        if (gen !== generation || !description?.sdp) {
          return;
        }
        await options.send({ v: 1, type: "rtc-offer", mode: nextMode, description });
        if (gen !== generation) {
          return;
        }
        signaled = true;
        buildingOffer = false;
        phase = "live";
        publish();
      } catch (err) {
        if (gen !== generation) {
          return;
        }
        buildingOffer = false;
        signaled = false;
        resetMedia();
        phase = "idle";
        mode = null;
        role = null;
        error = failureText(err);
        publish();
      }
    },
    async hangup() {
      generation += 1;
      buildingOffer = false;
      const notify = signaled;
      signaled = false;
      resetMedia();
      phase = "idle";
      mode = null;
      role = null;
      publish();
      if (notify) {
        try {
          await options.send({ v: 1, type: "rtc-hangup" });
        } catch (err) {
          error = failureText(err);
          publish();
        }
      }
    },
    async receive(raw) {
      let meta: Partial<SignalMeta>;
      try {
        meta = JSON.parse(raw) as Partial<SignalMeta>;
      } catch {
        return;
      }
      if (meta.type === "rtc-hangup") {
        generation += 1;
        buildingOffer = false;
        signaled = false;
        resetMedia();
        phase = "idle";
        mode = null;
        role = null;
        publish();
        return;
      }
      if (meta.type === "rtc-answer") {
        if (!pc || !meta.description?.sdp || !meta.description.type) {
          return;
        }
        const current = pc;
        try {
          await current.setRemoteDescription(meta.description);
          if (pc === current) {
            phase = "live";
            publish();
          }
        } catch {
          if (pc === current) {
            failLive();
          }
        }
        return;
      }
      if (meta.type !== "rtc-offer" || buildingOffer) {
        return;
      }
      if (!meta.description?.sdp || !meta.description.type) {
        return;
      }
      if (meta.mode !== "voice" && meta.mode !== "video" && meta.mode !== "screen") {
        return;
      }
      const gen = ++generation;
      const offerMode = meta.mode;
      const description = meta.description;
      signaled = false;
      resetMedia();
      signaled = true;
      buildingOffer = false;
      phase = "building";
      mode = offerMode;
      role = "answerer";
      error = "";
      publish();
      try {
        if (offerMode !== "screen") {
          const stream = await capture(offerMode);
          if (gen !== generation) {
            stopStream(stream);
            return;
          }
          localStream = stream;
          publish();
        }
        if (gen !== generation) {
          return;
        }
        const next = openPeer(gen);
        if (localStream) {
          addLocal(next, localStream);
        }
        await next.setRemoteDescription(description);
        if (gen !== generation) {
          return;
        }
        const answer = await next.createAnswer();
        if (gen !== generation) {
          return;
        }
        await next.setLocalDescription(answer);
        if (gen !== generation) {
          return;
        }
        const local = await describeLocal(next, gen);
        if (gen !== generation || !local?.sdp) {
          return;
        }
        await options.send({ v: 1, type: "rtc-answer", description: local });
        if (gen !== generation) {
          return;
        }
        phase = "live";
        publish();
      } catch (err) {
        if (gen !== generation) {
          return;
        }
        const notify = signaled;
        signaled = false;
        buildingOffer = false;
        resetMedia();
        phase = "idle";
        mode = null;
        role = null;
        error = failureText(err);
        publish();
        if (notify) {
          await options.send({ v: 1, type: "rtc-hangup" }).catch(() => undefined);
        }
      }
    },
    toggleExpanded() {
      expanded = !expanded;
      publish();
    },
    snapshot,
  };
  return api;
}

function defaultDevices(): LiveDevices {
  const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!media) {
    return {};
  }
  return {
    getUserMedia: (constraints) => media.getUserMedia(constraints),
    getDisplayMedia: typeof media.getDisplayMedia === "function" ? (constraints) => media.getDisplayMedia(constraints) : undefined,
  };
}

function failureText(err: unknown): string {
  if (!(err instanceof Error)) {
    return liveMediaError;
  }
  if (
    err.message === micDeniedError ||
    err.message === cameraDeniedError ||
    err.message === screenDeniedError ||
    err.message === screenUnavailableError ||
    err.message === liveMediaError ||
    err.message === "Could not reach peer. Check the address and that they are online." ||
    err.message === "no peer"
  ) {
    return err.message;
  }
  return liveMediaError;
}

function waitGathering(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === "complete") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      pc.removeEventListener("icegatheringstatechange", onState);
      window.clearTimeout(timer);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === "complete") {
        finish();
      }
    };
    pc.addEventListener("icegatheringstatechange", onState);
    const timer = window.setTimeout(finish, ms);
    if (pc.iceGatheringState === "complete") {
      finish();
    }
  });
}
