import { useEffect, useRef, useState } from "react";
import { track } from "../lib/telemetry.client";
import { t, type Locale } from "../lib/i18n";

type RecorderStatus =
  | "checking"
  | "idle"
  | "requesting"
  | "ready"
  | "recording"
  | "paused"
  | "stopped"
  | "denied"
  | "no-device"
  | "unsupported";

type RecorderUploadResponse = {
  error?: string;
  source?: { id: string };
};

function parseRecorderUploadResponse(value: unknown): RecorderUploadResponse {
  if (typeof value !== "object" || value === null) return {};
  const candidate = value as Record<string, unknown>;
  const source = candidate.source;
  return {
    ...(typeof candidate.error === "string" ? { error: candidate.error } : {}),
    ...(typeof source === "object" &&
    source !== null &&
    typeof (source as Record<string, unknown>).id === "string"
      ? { source: { id: (source as Record<string, unknown>).id as string } }
      : {}),
  };
}

export function AudioRecorder({
  projectId,
  locale,
  disabled,
  onUploaded,
}: {
  projectId: string;
  locale: Locale;
  disabled: boolean;
  onUploaded: (sourceId: string) => void | Promise<void>;
}) {
  const [status, setStatus] = useState<RecorderStatus>("checking");
  const supported = status !== "checking" && status !== "unsupported";
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const elapsed = useRef(0);
  const uploadInFlight = useRef(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    const canRecord =
      "MediaRecorder" in window &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    setStatus(canRecord ? "idle" : "unsupported");
  }, []);
  useEffect(() => {
    if (status !== "recording") return;
    const timer = window.setInterval(
      () =>
        setSeconds((value) => {
          if (value >= 899) recorder.current?.stop();
          const next = Math.min(value + 1, 900);
          elapsed.current = next;
          return next;
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [status]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
      stream.current?.getTracks().forEach((trackItem) => trackItem.stop());
    },
    [url],
  );

  async function acquire(): Promise<MediaStream | null> {
    setStatus("requesting");
    setError(null);
    try {
      const acquired = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      stream.current = acquired;
      setStatus("ready");
      track("recorder.permission", {
        projectId,
        payload: { permission_state: "granted" },
      });
      return acquired;
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : "";
      const next = name === "NotFoundError" ? "no-device" : "denied";
      setStatus(next);
      setError(
        next === "no-device"
          ? t(locale, "recorder.noDevice")
          : t(locale, "recorder.denied"),
      );
      track("recorder.permission", {
        projectId,
        payload: { permission_state: next },
      });
      return null;
    }
  }

  async function start() {
    const active = stream.current ?? (await acquire());
    if (!active) return;
    chunks.current = [];
    elapsed.current = 0;
    setSeconds(0);
    setBlob(null);
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "";
    const next = new MediaRecorder(active, mimeType ? { mimeType } : undefined);
    next.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    next.onstop = () => {
      const completed = new Blob(chunks.current, {
        type: next.mimeType || "audio/webm",
      });
      setBlob(completed);
      setUrl(URL.createObjectURL(completed));
      setStatus("stopped");
      active.getTracks().forEach((item) => item.stop());
      stream.current = null;
      track("recorder.stop", {
        projectId,
        payload: {
          duration_bucket:
            elapsed.current < 60
              ? "short"
              : elapsed.current < 300
                ? "medium"
                : "long",
          size_bucket:
            completed.size < 1_000_000
              ? "small"
              : completed.size < 10_000_000
                ? "medium"
                : "large",
        },
      });
    };
    recorder.current = next;
    next.start(1000);
    setStatus("recording");
    track("recorder.start", { projectId });
  }

  function pauseResume() {
    if (recorder.current?.state === "recording") {
      recorder.current.pause();
      setStatus("paused");
      track("recorder.pause", { projectId });
    } else if (recorder.current?.state === "paused") {
      recorder.current.resume();
      setStatus("recording");
      track("recorder.resume", { projectId });
    }
  }
  function discard() {
    if (url) URL.revokeObjectURL(url);
    setUrl(null);
    setBlob(null);
    elapsed.current = 0;
    setSeconds(0);
    setStatus("idle");
    track("recorder.discard", { projectId });
  }
  async function confirm() {
    if (!blob || uploadInFlight.current) return;
    if (blob.size > 25_000_000) {
      setError(t(locale, "recorder.tooLarge"));
      return;
    }
    uploadInFlight.current = true;
    setIsUploading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/sources?kind=audio`,
        {
          method: "POST",
          headers: {
            "Content-Type": blob.type.split(";")[0] || "audio/webm",
            "X-Duration-Seconds": String(elapsed.current),
            "X-Source-Name": encodeURIComponent("Browser recording.webm"),
          },
          body: blob,
        },
      );
      const body = parseRecorderUploadResponse(await response.json());
      if (!response.ok) {
        setError(body.error ?? t(locale, "recorder.uploadError"));
        return;
      }
      const sourceId = body.source?.id;
      if (!sourceId?.trim()) {
        setError(t(locale, "recorder.uploadError"));
        return;
      }
      track("recorder.upload", {
        projectId,
        payload: { source_kind: "audio" },
      });
      await onUploaded(sourceId);
      discard();
    } catch {
      setError(t(locale, "recorder.uploadError"));
    } finally {
      uploadInFlight.current = false;
      setIsUploading(false);
    }
  }

  return (
    <section className="recorder" aria-labelledby="record-heading">
      <div className="subsection-heading">
        <h3 id="record-heading">{t(locale, "recorder.title")}</h3>
        <span className={`recorder-state ${status}`}>
          {t(locale, `recorder.status.${status}`)}
        </span>
      </div>
      <div className="record-clock" aria-live="polite">
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:
        {String(seconds % 60).padStart(2, "0")} <small>/ 15:00</small>
      </div>
      <div className="button-row">
        {status === "checking" ||
        status === "idle" ||
        status === "denied" ||
        status === "no-device" ? (
          <button
            className="button secondary"
            type="button"
            onClick={() => void acquire()}
            disabled={!supported || disabled}
          >
            {t(locale, "recorder.request")}
          </button>
        ) : null}
        {status === "checking" || status === "ready" || status === "idle" ? (
          <button
            className="button primary"
            type="button"
            onClick={() => void start()}
            disabled={!supported || disabled}
          >
            {t(locale, "recorder.start")}
          </button>
        ) : null}
        {status === "recording" || status === "paused" ? (
          <>
            <button
              className="button secondary"
              type="button"
              onClick={pauseResume}
            >
              {status === "paused"
                ? t(locale, "recorder.resume")
                : t(locale, "recorder.pause")}
            </button>
            <button
              className="button danger-quiet"
              type="button"
              onClick={() => recorder.current?.stop()}
            >
              {t(locale, "recorder.stop")}
            </button>
          </>
        ) : null}
      </div>
      {url ? (
        <>
          <audio
            controls
            src={url}
            onPlay={() => track("recorder.playback", { projectId })}
          />
          <div className="button-row">
            <button
              className="button primary"
              type="button"
              onClick={() => void confirm()}
              disabled={isUploading}
            >
              {t(locale, "recorder.confirm")}
            </button>
            <button className="button ghost" type="button" onClick={discard}>
              {t(locale, "recorder.discard")}
            </button>
          </div>
        </>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {status === "unsupported" ? (
        <p className="form-error">{t(locale, "recorder.unsupported")}</p>
      ) : null}
    </section>
  );
}
