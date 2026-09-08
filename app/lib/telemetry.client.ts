export type SafePayload = Record<string, string | number | undefined>;

type PendingEvent = {
  event_id: string;
  client_session_id: string;
  client_sequence: number;
  occurred_at_client: string;
  event_type: string;
  route: string;
  project_id?: string;
  job_id?: string;
  diagram_version_id?: string;
  app_version: string;
  safe_payload: SafePayload;
};

let queue: PendingEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function sessionId(): string {
  const key = "bpmn_client_session";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  sessionStorage.setItem(key, value);
  return value;
}

function nextSequence(): number {
  const key = "bpmn_client_sequence";
  const next = Number(sessionStorage.getItem(key) ?? 0) + 1;
  sessionStorage.setItem(key, String(next));
  return next;
}

async function flush(): Promise<void> {
  if (!queue.length || typeof window === "undefined") return;
  const events = queue.splice(0, 100);
  try {
    const response = await fetch("/api/events/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
    if (!response.ok) queue = [...events, ...queue].slice(0, 300);
  } catch {
    queue = [...events, ...queue].slice(0, 300);
  }
}

export function track(
  eventType: string,
  context: {
    projectId?: string;
    jobId?: string;
    versionId?: string;
    payload?: SafePayload;
  } = {},
): void {
  if (typeof window === "undefined") return;
  queue.push({
    event_id: crypto.randomUUID(),
    client_session_id: sessionId(),
    client_sequence: nextSequence(),
    occurred_at_client: new Date().toISOString(),
    event_type: eventType,
    route: location.pathname.replace(
      /\/projects\/[^/]+/u,
      "/projects/:projectId",
    ),
    project_id: context.projectId,
    job_id: context.jobId,
    diagram_version_id: context.versionId,
    app_version: "0.1.0",
    safe_payload: context.payload ?? {},
  });
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 1200);
}

if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
