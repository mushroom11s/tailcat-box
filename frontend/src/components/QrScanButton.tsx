import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useI18n } from "../i18n";
import { acceptScannedText, decodeQrImageData } from "../lib/qr";
import { decodeQrFromFile } from "../lib/qrImage";
import QrDialog from "./QrDialog";

type Props = {
  onAccept: (value: string) => void;
  disabled?: boolean;
  decodeFile?: (file: File) => Promise<string | null>;
};

export default function QrScanButton({ onAccept, disabled = false, decodeFile = decodeQrFromFile }: Props) {
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
    const accepted = acceptScannedText(raw);
    if (!accepted.ok) {
      stopCamera();
      setError(t("qrInvalid"));
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
