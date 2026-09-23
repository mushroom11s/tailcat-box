import { cleanup, fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import App from "./App";
import ChatPage, { type ChatMessage } from "./pages/ChatPage";
import { LocaleProvider } from "./i18n";
import { opusMIME } from "./lib/voiceCapture";

beforeEach(() => {
  localStorage.setItem("tailcat-locale", "en");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const voice: ChatMessage = {
  id: "voice-1",
  direction: "in",
  type: "voice",
  mime: opusMIME,
  duration: 2,
  audio: "AQID",
  at: "2026-09-22T00:00:00.000Z",
};

function renderChat(extra: Partial<ComponentProps<typeof ChatPage>> = {}) {
  const onSendVoice = vi.fn().mockResolvedValue(undefined);
  const startCapture = vi.fn(async () => ({
    stop: async () => ({ mime: opusMIME, durationSec: 2, audio: Uint8Array.from([9, 8, 7]) }),
  }));
  const view = render(
    <LocaleProvider>
      <ChatPage
        address="tc:room"
        peer="tc:peer"
        messages={[]}
        roomError=""
        onConnect={vi.fn()}
        onSend={vi.fn()}
        onSendVoice={onSendVoice}
        startCapture={startCapture}
        canPlayMime={() => true}
        onRetry={vi.fn()}
        {...extra}
      />
    </LocaleProvider>,
  );
  return { ...view, onSendVoice, startCapture };
}

describe("phase 3 voice notes", () => {
  it("sends a voice note when the microphone button is released", async () => {
    const { onSendVoice, startCapture } = renderChat();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Record voice note" }));
    expect(await screen.findByRole("button", { name: "Recording" })).toBeTruthy();
    expect(startCapture).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(screen.getByRole("button", { name: "Recording" }));
    await vi.waitFor(() => expect(onSendVoice).toHaveBeenCalledTimes(1));
    expect(onSendVoice).toHaveBeenCalledWith(opusMIME, 2, expect.any(Uint8Array), false, 0);
  });

  it("starts recording from a mouse hold when pointer events are not used", async () => {
    const { onSendVoice } = renderChat();
    const button = screen.getByRole("button", { name: "Record voice note" });
    fireEvent.mouseDown(button);
    expect(await screen.findByRole("button", { name: "Recording" })).toBeTruthy();
    fireEvent.mouseUp(button);
    await vi.waitFor(() => expect(onSendVoice).toHaveBeenCalledTimes(1));
  });

  it("sends the composer burn choice with the voice note", async () => {
    const user = userEvent.setup();
    const { onSendVoice } = renderChat();
    await user.click(screen.getByRole("switch", { name: "Burn" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Record voice note" }));
    await screen.findByRole("button", { name: "Recording" });
    fireEvent.pointerUp(screen.getByRole("button", { name: "Recording" }));
    await vi.waitFor(() => expect(onSendVoice).toHaveBeenCalledWith(opusMIME, 2, expect.any(Uint8Array), true, 3));
  });

  it("focuses the peer field instead of recording when nobody is connected", () => {
    const startCapture = vi.fn();
    renderChat({ peer: "", startCapture });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Record voice note" }));
    expect(startCapture).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("Peer"));
  });

  it("shows the denied message when microphone access fails", async () => {
    renderChat({
      startCapture: vi.fn(async () => {
        throw new Error("Microphone access was denied.");
      }),
    });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Record voice note" }));
    expect(await screen.findByText(/System Settings → Privacy & Security → Microphone/)).toBeTruthy();
  });

  it("ignores a short Enter on an empty composer and records after a 100ms hold", async () => {
    vi.useFakeTimers();
    const { onSendVoice, startCapture } = renderChat();
    const composer = screen.getByLabelText("Message");
    fireEvent.keyDown(composer, { key: "Enter" });
    fireEvent.keyUp(composer, { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(startCapture).not.toHaveBeenCalled();
    expect(onSendVoice).not.toHaveBeenCalled();

    fireEvent.keyDown(composer, { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(startCapture).toHaveBeenCalledTimes(1);
    fireEvent.keyUp(composer, { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSendVoice).toHaveBeenCalledWith(opusMIME, 2, expect.any(Uint8Array), false, 0);
  });

  it("keeps Shift+Enter as a newline and Enter as send when the composer has text", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    renderChat({ onSend });
    const composer = screen.getByLabelText("Message");
    await user.type(composer, "hi");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect((composer as HTMLTextAreaElement).value).toBe("hi\n");
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("hi\n", false, 0);
  });

  it("autoplays an incoming voice note and says to tap play when blocked", async () => {
    HTMLMediaElement.prototype.play = vi.fn(
      () => Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" })),
    ) as typeof HTMLMediaElement.prototype.play;
    renderChat({ messages: [voice] });
    expect(await screen.findByText("Voice received — tap play")).toBeTruthy();
    expect(document.querySelector("audio")).toBeTruthy();
  });

  it("does not show the tap-play line when autoplay is allowed", async () => {
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as typeof HTMLMediaElement.prototype.play;
    renderChat({ messages: [voice] });
    expect(await screen.findByRole("button", { name: "Record voice note" })).toBeTruthy();
    await vi.waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
    expect(screen.queryByText("Voice received — tap play")).toBeNull();
  });

  it("decodes to wav when the webview cannot play the mime", async () => {
    const decodeVoice = vi.fn(async () => "AQIDBA==");
    renderChat({
      messages: [voice],
      canPlayMime: () => false,
      decodeVoice,
    });
    await vi.waitFor(() => expect(decodeVoice).toHaveBeenCalledWith(opusMIME, "AQID"));
    const audio = await vi.waitFor(() => {
      const el = document.querySelector("audio");
      if (!el) {
        throw new Error("audio missing");
      }
      return el;
    });
    expect(audio.getAttribute("src")).toContain("data:audio/wav;base64,");
  });

  it("keeps the bytes and explains when a voice note cannot be played", async () => {
    renderChat({
      messages: [voice],
      canPlayMime: () => false,
      decodeVoice: async () => null,
    });
    expect(await screen.findByText("Cannot play this voice message.")).toBeTruthy();
    expect(document.querySelector("audio")).toBeNull();
  });

  it("plays a burned voice note and discards it when playback ends", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as typeof HTMLMediaElement.prototype.play;
    renderChat({
      messages: [{ ...voice, burn: true, ttlSec: 0 }],
      onDiscard,
    });
    expect(screen.queryByText("Voice received — tap play")).toBeNull();
    expect(document.querySelector("audio")).toBeNull();
    expect(screen.getByText("Burn after reading")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Play" }));
    const audio = document.querySelector("audio");
    expect(audio).toBeTruthy();
    fireEvent.ended(audio!);
    expect(document.querySelector(".chat-msg.dissolving")).toBeTruthy();
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith("voice-1"));
  });

  it("discards a burned voice note when the countdown reaches zero", async () => {
    vi.useFakeTimers();
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve()) as typeof HTMLMediaElement.prototype.play;
    renderChat({
      messages: [{ ...voice, burn: true, ttlSec: 2 }],
      onDiscard,
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(document.querySelector("audio")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(onDiscard).toHaveBeenCalledWith("voice-1");
  });

  it("uses the Chinese voice strings", async () => {
    localStorage.setItem("tailcat-locale", "zh-CN");
    HTMLMediaElement.prototype.play = vi.fn(
      () => Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" })),
    ) as typeof HTMLMediaElement.prototype.play;
    renderChat({ messages: [voice] });
    expect(screen.getByRole("button", { name: "按住说话" })).toBeTruthy();
    expect(await screen.findByText("收到语音，点一下播放")).toBeTruthy();
  });
});

describe("phase 3 browser fake", () => {
  it("records through the app fake and echoes a burned voice note", async () => {
    const user = userEvent.setup();
    class FakeRecorder {
      state = "inactive";
      mimeType = opusMIME;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        this.state = "recording";
        this.ondataavailable?.({ data: new Blob([Uint8Array.from([4, 5, 6])], { type: opusMIME }) });
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
      static isTypeSupported(mime: string) {
        return mime === opusMIME;
      }
    }
    HTMLMediaElement.prototype.canPlayType = () => "";
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) },
    });
    render(
      <LocaleProvider>
        <App />
      </LocaleProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Create temporary room" }));
    await screen.findByRole("button", { name: "Copy" });
    await user.click(screen.getByRole("button", { name: "Show room details" }));
    await user.type(screen.getByLabelText("Peer"), "tc:fake-echo");
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("switch", { name: "Burn" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Record voice note" }));
    expect(await screen.findByRole("button", { name: "Recording" })).toBeTruthy();
    fireEvent.pointerUp(screen.getByRole("button", { name: "Recording" }));
    expect(await screen.findByText("They may keep a copy.")).toBeTruthy();
    expect(await screen.findByText("Burn after reading")).toBeTruthy();
    expect(screen.getAllByText("Cannot play this voice message.")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(screen.getAllByText("Cannot play this voice message.")).toHaveLength(2);
  });
});
