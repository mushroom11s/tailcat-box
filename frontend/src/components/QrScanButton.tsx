import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { readQrPaste } from "../lib/qrClipboard";
import { acceptScannedText, decodeQrImageData } from "../lib/qr";
import { decodeQrFromFile } from "../lib/qrImage";
import QrDialog from "./QrDialog";

type AcceptResult = { ok: true; value: string } | { ok: false };

type Props = {
  onAccept: (value: string) => void;
  disabled?: boolean;
  decodeFile?: (file: File) => Promise<string | null>;
  accept?: (raw: string) => AcceptResult;
  invalidKey?: MessageKey;
  /** Turns clipboard text into the value accept() expects. Empty means the text is not usable. */
  normalizePastedText?: (text: string) => string;
};

export default function QrScanButton({
  onAccept,
  disabled = false,
  decodeFile = decodeQrFromFile,
  accept = acceptScannedText,
  invalidKey = "qrInvalid",
  normalizePastedText,
}: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef(0);
  const activeRef = useRef(false);
  const tokenRef = useRef(0);

  const pasteRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      tokenRef.current += 1;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.altKey || ev.shiftKey || (!ev.ctrlKey && !ev.metaKey)) {
        return;
      }
      if (ev.key !== "v" && ev.key !== "V") {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      pasteRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function stopCamera() {
    activeRef.current = false;
    tokenRef.current += 1;
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOn(false);
  }

  function close() {
    stopCamera();
    setOpen(false);
    setError("");
  }

  function finish(raw: string) {
    const accepted = accept(raw);
    if (!accepted.ok) {
      stopCamera();
      setError(t(invalidKey));
      return;
    }
    stopCamera();
    setOpen(false);
    setError("");
    onAccept(accepted.value);
  }

  function scanFrame() {
    if (!activeRef.current) {
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      const maxEdge = Math.max(video.videoWidth, video.videoHeight);
      const scale = Math.min(1, 720 / maxEdge);
      const w = Math.max(1, Math.round(video.videoWidth * scale));
      const h = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
        const image = ctx.getImageData(0, 0, w, h);
        const text = decodeQrImageData(image.data, w, h, "dontInvert");
        if (text) {
          finish(text);
          return;
        }
      }
    }
    frameRef.current = requestAnimationFrame(scanFrame);
  }

  async function startCamera() {
    setError("");
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t("qrNoCamera"));
      return;
    }
    const token = tokenRef.current;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        if (token !== tokenRef.current) {
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      if (token !== tokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      activeRef.current = true;
      setCameraOn(true);
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      frameRef.current = requestAnimationFrame(scanFrame);
    } catch {
      if (token === tokenRef.current) {
        setError(t("qrNoCamera"));
      }
    }
  }

  async function pasteFromClipboard() {
    setError("");
    stopCamera();
    const token = tokenRef.current;
    try {
      const result = await readQrPaste(undefined, normalizePastedText ? () => true : undefined);
      if (token !== tokenRef.current) {
        return;
      }
      if (!result.ok) {
        const key =
          result.reason === "empty" ? "qrPasteEmpty" : result.reason === "unusable" ? "qrPasteUnusable" : "qrPasteDenied";
        setError(t(key));
        return;
      }
      if (result.kind === "text") {
        const text = normalizePastedText ? normalizePastedText(result.text) : result.text;
        if (normalizePastedText && !text) {
          setError(t(invalidKey));
          return;
        }
        finish(text);
        return;
      }
      let text: string | null = null;
      try {
        text = await decodeFile(result.file);
      } catch {
        text = null;
      }
      if (token !== tokenRef.current) {
        return;
      }
      if (!text) {
        setError(t("qrNotFound"));
        return;
      }
      finish(text);
    } catch {
      if (token === tokenRef.current) {
        setError(t("qrPasteDenied"));
      }
    }
  }
  pasteRef.current = () => {
    void pasteFromClipboard();
  };

  async function onFile(ev: ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) {
      return;
    }
    setError("");
    stopCamera();
    try {
      const text = await decodeFile(file);
      if (!text) {
        setError(t("qrNotFound"));
        return;
      }
      finish(text);
    } catch {
      setError(t("qrNotFound"));
    }
  }

  return (
    <>
      <button
        className="btn btn-ghost"
        type="button"
        disabled={disabled}
        onClick={(ev) => {
          ev.stopPropagation();
          setError("");
          setOpen(true);
        }}
      >
        {t("qrScan")}
      </button>
      {open ? (
        <QrDialog titleId="qr-scan-title" title={t("qrScanTitle")} onClose={close}>
          <p className="chat-quiet">{cameraOn ? t("qrScanning") : t("qrScanHelp")}</p>
          <video ref={videoRef} className="qr-camera" hidden={!cameraOn} autoPlay muted playsInline />
          <canvas ref={canvasRef} hidden />
          {error ? (
            <p className="err" role="alert">
              {error}
            </p>
          ) : null}
          <div className="row">
            <button className="btn" type="button" onClick={() => void startCamera()}>
              {t("qrUseCamera")}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => fileRef.current?.click()}>
              {t("qrPickImage")}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => void pasteFromClipboard()}>
              {t("qrPaste")}
            </button>
            <button className="btn btn-ghost" type="button" onClick={close}>
              {t("qrClose")}
            </button>
          </div>
          <input ref={fileRef} className="sr-only" type="file" accept="image/*" onChange={(ev) => void onFile(ev)} />
        </QrDialog>
      ) : null}
    </>
  );
}
