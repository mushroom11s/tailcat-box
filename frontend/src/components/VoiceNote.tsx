import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { decodeChatVoice } from "../lib/wails";

type Props = {
  mime: string;
  audio: string;
  autoPlay: boolean;
  onEnded?: () => void;
  canPlayMime?: (mime: string) => boolean;
  decodeVoice?: (mime: string, audio: string) => Promise<string | null>;
};

function defaultCanPlay(mime: string): boolean {
  const audio = document.createElement("audio");
  return audio.canPlayType(mime) !== "";
}

async function defaultDecode(mime: string, audio: string): Promise<string | null> {
  try {
    const wav = await decodeChatVoice(mime, audio);
    return wav || null;
  } catch {
    return null;
  }
}

export default function VoiceNote({ mime, audio, autoPlay, onEnded, canPlayMime, decodeVoice }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "blocked" | "unplayable">("loading");

  useEffect(() => {
    let cancel = false;
    const canPlay = canPlayMime ?? defaultCanPlay;
    const decode = decodeVoice ?? defaultDecode;
    void (async () => {
      if (!audio) {
        if (!cancel) {
          setState("unplayable");
        }
        return;
      }
      let playMime = mime;
      let playAudio = audio;
      if (!canPlay(playMime)) {
        const wav = await decode(playMime, playAudio);
        if (cancel) {
          return;
        }
        if (!wav) {
          setState("unplayable");
          return;
        }
        playMime = "audio/wav";
        playAudio = wav;
      }
      if (cancel) {
        return;
      }
      setSrc(`data:${playMime};base64,${playAudio}`);
      setState("ready");
    })();
    return () => {
      cancel = true;
    };
  }, [mime, audio, canPlayMime, decodeVoice]);

  useEffect(() => {
    const el = ref.current;
    if (!src || !autoPlay || !el) {
      return;
    }
    let cancel = false;
    void el
      .play()
      .then(() => {
        if (!cancel) {
          setState("ready");
        }
      })
      .catch(async (err: unknown) => {
        if (cancel) {
          return;
        }
        const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
        if (name === "NotAllowedError") {
          setState("blocked");
          return;
        }
        const decode = decodeVoice ?? defaultDecode;
        const wav = await decode(mime, audio);
        if (cancel) {
          return;
        }
        if (!wav || src.startsWith("data:audio/wav")) {
          setState("unplayable");
          return;
        }
        setSrc(`data:audio/wav;base64,${wav}`);
        setState("ready");
      });
    return () => {
      cancel = true;
    };
  }, [src, autoPlay, mime, audio, decodeVoice]);

  if (state === "unplayable") {
    return <p>{t("chatVoiceUnplayable")}</p>;
  }
  return (
    <div className="chat-voice">
      {src ? <audio ref={ref} src={src} controls onEnded={onEnded} /> : null}
      {state === "blocked" ? <p>{t("chatVoiceReceived")}</p> : null}
    </div>
  );
}
