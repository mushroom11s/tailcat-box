import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { LocaleProvider } from "./i18n";
import { en } from "./i18n/en";
import { liveMediaError, micDeniedError, type SignalMeta } from "./lib/liveCall";
import ChatPage from "./pages/ChatPage";

class FakePC {
  static instances: FakePC[] = [];
  iceGatheringState: RTCIceGatheringState = "complete";
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  localDescription: { type: string; sdp: string } | null = null;
  private listeners = new Map<string, Set<(event?: unknown) => void>>();

  constructor() {
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

  close(): void {
    this.connectionState = "closed";
  }

  addTrack(): void {}

  async createOffer(): Promise<{ type: string; sdp: string }> {
    return { type: "offer", sdp: "v=0" };
  }

  async createAnswer(): Promise<{ type: string; sdp: string }> {
    return { type: "answer", sdp: "v=0" };
  }

  async setLocalDescription(desc: { type: string; sdp: string }): Promise<void> {
    this.localDescription = desc;
    this.iceGatheringState = "complete";
  }

  async setRemoteDescription(): Promise<void> {}

  fail(): void {
    this.connectionState = "failed";
    this.listeners.get("connectionstatechange")?.forEach((fn) => fn());
  }
}

function stream(kinds: Array<"audio" | "video">) {
  const tracks = kinds.map((kind) => ({
    kind,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  } as unknown as MediaStream;
}

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
  FakePC.instances = [];
});

afterEach(() => {
  cleanup();
});

function renderChat(extra: Partial<ComponentProps<typeof ChatPage>> = {}) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  const onSendSignal = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <LocaleProvider>
      <ChatPage
        address="tc:room"
        peer="tc:peer"
        messages={[]}
        roomError=""
        onConnect={vi.fn()}
        onSend={onSend}
        onSendSignal={onSendSignal}
        onRetry={vi.fn()}
        liveMedia={{ getUserMedia: async () => stream(["audio"]) }}
        peerConnection={FakePC as unknown as new (config?: RTCConfiguration) => RTCPeerConnection}
        {...extra}
      />
    </LocaleProvider>,
  );
  return { ...view, onSend, onSendSignal };
}

describe("phase 4 live media dock", () => {
  it("keeps the composer usable and can expand and hang up", async () => {
    const user = userEvent.setup();
    const { onSend, onSendSignal } = renderChat();
    expect(screen.getByRole("button", { name: "Voice" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Video" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Screen share" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Voice" }));
    expect(await screen.findByRole("complementary", { name: "Live media" })).toBeTruthy();
    expect(screen.getByText("Local preview")).toBeTruthy();
    expect(screen.getByText("Remote media")).toBeTruthy();
    expect(document.querySelector(".chat-stage .chat-log")).toBeTruthy();
    expect(document.querySelector(".chat-stage .media-dock")).toBeTruthy();
    const composer = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(composer.disabled).toBe(false);
    await user.type(composer, "during");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("during", false, 0);
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByRole("button", { name: "Collapse" }).getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".media-dock.expanded")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hang up" }));
    expect(screen.queryByRole("complementary", { name: "Live media" })).toBeNull();
    const sent = onSendSignal.mock.calls.map((call) => JSON.parse(call[0] as string) as SignalMeta);
    expect(sent.map((meta) => meta.type)).toEqual(["rtc-offer", "rtc-hangup"]);
    expect(composer.value).toBe("");
  });

  it("focuses the peer field when a call starts with no peer", async () => {
    const user = userEvent.setup();
    const { onSendSignal } = renderChat({ peer: "" });
    const peer = screen.getByLabelText("Peer");
    await user.click(screen.getByRole("button", { name: "Voice" }));
    expect(document.activeElement).toBe(peer);
    expect(onSendSignal).not.toHaveBeenCalled();
  });

  it("shows the relay error and still sends chat after the link fails", async () => {
    const user = userEvent.setup();
    const { onSend } = renderChat();
    await user.click(screen.getByRole("button", { name: "Voice" }));
    await screen.findByRole("complementary", { name: "Live media" });
    FakePC.instances.at(-1)?.fail();
    expect(await screen.findByText(liveMediaError)).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Live media" })).toBeNull();
    const composer = screen.getByLabelText("Message");
    await user.type(composer, "still");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("still", false, 0);
    expect(en.chatLiveFailed).toBe(liveMediaError);
    expect(en.chatMicDenied).toBe(micDeniedError);
  });

  it("uses the Chinese call strings", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    const user = userEvent.setup();
    renderChat({
      liveMedia: {
        getUserMedia: async () => {
          throw new Error("no");
        },
      },
    });
    expect(screen.getByRole("button", { name: "语音" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "视频" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "共享屏幕" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "语音" }));
    expect(await screen.findByText("没有麦克风权限。")).toBeTruthy();
    expect(screen.getByLabelText("消息")).toBeTruthy();
  });

  it("does not restore toolbox navigation", async () => {
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );
    expect(await screen.findByRole("button", { name: "Voice" })).toBeTruthy();
    expect(Array.from(document.querySelectorAll(".nav-btn")).map((node) => node.textContent)).toEqual([
      "Chat",
      "Tunnel",
      "Settings",
    ]);
    expect(screen.queryByRole("heading", { name: "Services" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start SSH serve" })).toBeNull();
  });
});
