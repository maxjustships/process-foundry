import {
  Link,
  useLoaderData,
  useRevalidator,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AudioRecorder } from "../components/AudioRecorder";
import { BpmnEditor } from "../components/BpmnEditor";
import { formatDisplayDate } from "../lib/display-date";
import {
  displaySourceName,
  displayStatus,
  resolveLocale,
  t,
  type Locale,
} from "../lib/i18n";
import { getProject } from "../lib/repository.server";
import { cloudflareEnv, requireSession } from "../lib/request.server";
import { track } from "../lib/telemetry.client";
import type { ProcessIR } from "../../domain/process-ir";

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: t(loaderData?.locale ?? "ru", "project.metaTitle") },
];

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await requireSession(request, context);
  const locale = resolveLocale(request);
  const env = cloudflareEnv(context);
  const result = await getProject(env.DB, params.projectId ?? "", env.SOURCES);
  if (!result)
    throw new Response(t(locale, "error.projectNotFound"), { status: 404 });
  return { ...result, locale };
}

const activeStatuses = new Set([
  "queued",
  "transcribing",
  "extracting",
  "validating",
  "compiling",
  "cancelling",
]);
const stages = [
  "queued",
  "transcribing",
  "extracting",
  "validating",
  "compiling",
];

type GenerationMode = "refine" | "alternative";

function sourceCountKey(count: number) {
  return count === 1 ? "generation.source.one" : "generation.source.many";
}

function clarificationCountKey(count: number) {
  return count === 1
    ? "generation.clarification.one"
    : "generation.clarification.many";
}

async function audioDuration(file: File, locale: Locale): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t(locale, "error.audioDuration")));
    };
    audio.src = url;
  });
}

async function resizeImage(file: File): Promise<Blob> {
  if (
    file.size < 1_000_000 ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    typeof createImageBitmap !== "function"
  )
    return file;
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(blob ?? file), "image/webp", 0.84),
  );
}

export default function ProjectWorkspace() {
  const data = useLoaderData<typeof loader>();
  const { locale } = data;
  const revalidator = useRevalidator();
  const latest = data.versions[0] ?? null;
  const [selectedVersionId, setSelectedVersionId] = useState(latest?.id ?? "");
  const previousLatestVersionId = useRef(latest?.id ?? "");
  const selectedVersion =
    data.versions.find((version) => version.id === selectedVersionId) ?? latest;
  const ir = useMemo(
    () =>
      selectedVersion?.ir_json
        ? (JSON.parse(selectedVersion.ir_json) as ProcessIR)
        : null,
    [selectedVersion],
  );
  const latestJob = data.jobs[0] ?? null;
  const isActive = Boolean(latestJob && activeStatuses.has(latestJob.status));
  const clarificationSourceIds = useMemo(
    () =>
      new Set(
        data.clarifications.map((clarification) => clarification.source_id),
      ),
    [data.clarifications],
  );
  const selectableSources = useMemo(
    () =>
      data.sources.filter((source) => !clarificationSourceIds.has(source.id)),
    [clarificationSourceIds, data.sources],
  );
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [confirmingQuestion, setConfirmingQuestion] = useState<string | null>(
    null,
  );
  const [correction, setCorrection] = useState("");
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(
    latest ? "refine" : "alternative",
  );
  const hydratedSourceSelection = useRef(false);
  const sourceRailRef = useRef<HTMLElement>(null);
  const generationCtaRef = useRef<HTMLButtonElement>(null);
  const pendingRevealTokenRef = useRef<string[] | null>(null);
  const [pendingRevealSourceIds, setPendingRevealSourceIds] = useState<
    string[] | null
  >(null);

  useEffect(() => {
    track("route.view", { projectId: data.project.id });
  }, [data.project.id]);
  useEffect(() => {
    const previousLatest = previousLatestVersionId.current;
    if (latest && (!selectedVersionId || selectedVersionId === previousLatest))
      setSelectedVersionId(latest.id);
    if (latest && latest.id !== previousLatest) setGenerationMode("refine");
    previousLatestVersionId.current = latest?.id ?? "";
  }, [latest, selectedVersionId]);
  useEffect(() => {
    if (hydratedSourceSelection.current || !latestJob?.sources.length) return;
    hydratedSourceSelection.current = true;
    if (!selectedSourceIds.length)
      setSelectedSourceIds(
        latestJob.sources
          .filter((source) => !clarificationSourceIds.has(source.id))
          .map((source) => source.id),
      );
  }, [clarificationSourceIds, latestJob, selectedSourceIds.length]);
  useLayoutEffect(() => {
    if (!pendingRevealSourceIds?.length) return;
    const selectableSourceIds = new Set(
      selectableSources.map((source) => source.id),
    );
    if (
      !pendingRevealSourceIds.every(
        (sourceId) =>
          selectableSourceIds.has(sourceId) &&
          selectedSourceIds.includes(sourceId),
      )
    )
      return;

    const pendingToken = pendingRevealSourceIds;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    firstFrame = window.requestAnimationFrame(() => {
      firstFrame = null;
      secondFrame = window.requestAnimationFrame(() => {
        secondFrame = null;
        const sourceRail = sourceRailRef.current;
        if (sourceRail && sourceRail.scrollHeight > sourceRail.clientHeight) {
          sourceRail.scrollTo({
            behavior: "auto",
            top: sourceRail.scrollHeight,
          });
        } else {
          generationCtaRef.current?.scrollIntoView({
            behavior: "auto",
            block: "end",
            inline: "nearest",
          });
        }
        if (pendingRevealTokenRef.current !== pendingToken) return;
        pendingRevealTokenRef.current = null;
        setPendingRevealSourceIds((current) =>
          current === pendingToken ? null : current,
        );
      });
    });
    return () => {
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [pendingRevealSourceIds, selectableSources, selectedSourceIds]);
  useEffect(() => {
    if (!isActive || !latestJob) return;
    async function pollJob() {
      try {
        const response = await fetch(`/api/jobs/${latestJob.id}`);
        const body = (await response.json()) as { job?: { status: string } };
        if (body.job && !activeStatuses.has(body.job.status))
          await revalidator.revalidate();
        else if (body.job?.status !== latestJob.status)
          await revalidator.revalidate();
      } catch {
        /* polling is non-blocking */
      }
    }
    const timer = window.setInterval(() => void pollJob(), 1800);
    return () => window.clearInterval(timer);
  }, [isActive, latestJob, revalidator]);

  async function revealUploadedSources(sourceIds: string[]) {
    await revalidator.revalidate();
    if (!sourceIds.length) return;
    setSelectedSourceIds((current) => [...new Set([...current, ...sourceIds])]);
    pendingRevealTokenRef.current = sourceIds;
    setPendingRevealSourceIds(sourceIds);
  }

  async function uploadText(
    kind: "text" | "correction" = "text",
    value = text,
  ): Promise<string | null> {
    if (!value.trim()) return null;
    setBusy(kind);
    setMessage(null);
    const response = await fetch(
      `/api/projects/${data.project.id}/sources?kind=${kind}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: value,
          name:
            kind === "correction"
              ? "Reviewer correction"
              : "Pasted process description",
          kind,
        }),
      },
    );
    const body = (await response.json()) as {
      error?: string;
      source?: { id: string };
    };
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? t(locale, "error.textUpload"));
      return null;
    }
    track("source.upload_complete", {
      projectId: data.project.id,
      payload: {
        source_kind: kind,
        size_bucket:
          value.length < 1000
            ? "small"
            : value.length < 10000
              ? "medium"
              : "large",
      },
    });
    if (kind === "text") setText("");
    else setCorrection("");
    await revealUploadedSources(body.source?.id ? [body.source.id] : []);
    return body.source?.id ?? null;
  }

  async function uploadFiles() {
    setBusy("files");
    setMessage(null);
    try {
      const uploadedSourceIds: string[] = [];
      for (const file of files) {
        const extension = file.name.split(".").pop()?.toLocaleLowerCase();
        const kind =
          extension === "csv" || extension === "docx" || extension === "xlsx"
            ? extension
            : file.type.startsWith("audio/")
              ? "audio"
              : file.type.startsWith("image/")
                ? "image"
                : "table";
        const duration =
          kind === "audio" ? await audioDuration(file, locale) : undefined;
        const body = kind === "image" ? await resizeImage(file) : file;
        const response = await fetch(
          `/api/projects/${data.project.id}/sources?kind=${kind}`,
          {
            method: "POST",
            headers: {
              "Content-Type": body.type || file.type,
              ...(duration ? { "X-Duration-Seconds": String(duration) } : {}),
              "X-Source-Name": encodeURIComponent(file.name),
            },
            body,
          },
        );
        const result = (await response.json()) as {
          error?: string;
          source?: {
            id: string;
            type: "audio" | "image" | "csv" | "docx" | "xlsx";
          };
        };
        if (!response.ok) {
          throw new Error(
            result.error ?? t(locale, "error.fileUpload", { name: file.name }),
          );
        }
        if (!result.source)
          throw new Error(t(locale, "error.fileUpload", { name: file.name }));
        const uploadedKind = result.source.type;
        track("source.upload_complete", {
          projectId: data.project.id,
          payload: {
            source_kind: uploadedKind,
            mime_family:
              uploadedKind === "csv" ||
              uploadedKind === "docx" ||
              uploadedKind === "xlsx"
                ? "table"
                : uploadedKind,
            size_bucket:
              body.size < 1_000_000
                ? "small"
                : body.size < 10_000_000
                  ? "medium"
                  : "large",
          },
        });
        uploadedSourceIds.push(result.source.id);
      }
      setFiles([]);
      await revealUploadedSources(uploadedSourceIds);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t(locale, "error.filesUpload"),
      );
    }
    setBusy(null);
  }

  const pendingClarifications = data.clarifications.filter(
    (clarification) =>
      clarification.status === "answered" &&
      clarification.question_version_id === latest?.id,
  );
  const selectedSources = selectableSources.filter((source) =>
    selectedSourceIds.includes(source.id),
  );
  const preflightClarifications =
    generationMode === "refine" ? pendingClarifications : [];
  const appliedClarificationHistory = data.clarifications.filter(
    (clarification) =>
      clarification.status === "applied" &&
      clarification.applied_version_id === selectedVersion?.id &&
      clarification.question_version_id !== selectedVersion?.id,
  );
  const nextVersionNumber = (latest?.version_number ?? 0) + 1;

  async function generate() {
    if (!selectedSources.length) return;
    setBusy("generate");
    setMessage(null);
    const response = await fetch(`/api/projects/${data.project.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        generationMode === "refine"
          ? {
              mode: generationMode,
              baseVersionId: latest?.id,
              sourceIds: selectedSources.map((source) => source.id),
            }
          : {
              mode: generationMode,
              sourceIds: selectedSources.map((source) => source.id),
            },
      ),
    });
    const body = (await response.json()) as { jobId?: string; error?: string };
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? t(locale, "error.generationStart"));
      return;
    }
    track(latest ? "generation.regenerate" : "generation.start", {
      projectId: data.project.id,
      jobId: body.jobId,
      payload: {
        stage: "queued",
        count: preflightClarifications.length,
      },
    });
    await revalidator.revalidate();
  }

  async function cancelGeneration() {
    if (!latestJob) return;
    setBusy("cancel");
    setMessage(null);
    const response = await fetch(`/api/jobs/${latestJob.id}/cancel`, {
      method: "POST",
    });
    const body = (await response.json()) as {
      error?: string | { message?: string };
    };
    setBusy(null);
    if (!response.ok) {
      setMessage(
        typeof body.error === "string"
          ? body.error
          : (body.error?.message ?? t(locale, "error.cancelFailed")),
      );
      return;
    }
    await revalidator.revalidate();
  }

  async function retryGeneration() {
    if (!latestJob) return;
    setBusy("retry");
    setMessage(null);
    const response = await fetch(`/api/jobs/${latestJob.id}/retry`, {
      method: "POST",
    });
    const body = (await response.json()) as { error?: string };
    setBusy(null);
    if (!response.ok) {
      setMessage(body.error ?? t(locale, "error.retryUnavailable"));
      return;
    }
    await revalidator.revalidate();
  }

  function versionLabel(version: (typeof data.versions)[number]) {
    const prefix = `v${version.version_number}`;
    const created = formatDisplayDate(version.created_at, locale);
    if (version.created_by === "human")
      return `${prefix} · ${t(locale, "generation.mode.human")} · ${t(locale, "generation.provenanceUnavailable")} · ${created}`;
    if (!version.generation_mode)
      return `${prefix} · ${t(locale, "generation.mode.legacy")} · ${t(locale, "generation.provenanceUnavailable")} · ${created}`;
    let sourceSummary: string;
    try {
      const snapshot = JSON.parse(
        version.source_snapshot_json ?? "[]",
      ) as Array<{
        name: string;
        type: "text" | "audio" | "image" | "correction";
      }>;
      sourceSummary = snapshot
        .map(
          (source) =>
            `${displaySourceName(locale, source.type, source.name)} · ${t(locale, `source.type.${source.type}`)}`,
        )
        .join(", ");
    } catch {
      sourceSummary = t(locale, "generation.provenanceUnavailable");
    }
    const base = version.base_version_id
      ? t(locale, "generation.baseVersion", {
          number:
            data.versions.find(
              (candidate) => candidate.id === version.base_version_id,
            )?.version_number ?? "—",
        })
      : t(locale, "generation.noBase");
    return `${prefix} · ${t(locale, `generation.mode.${version.generation_mode}`)} · ${base} · ${t(locale, sourceCountKey(version.source_count ?? 0), { count: version.source_count ?? 0 })} · ${sourceSummary} · ${t(locale, clarificationCountKey(version.clarification_count ?? 0), { count: version.clarification_count ?? 0 })} · ${created}`;
  }

  async function confirmAnswer(questionId: string) {
    if (!selectedVersion) return;
    const draftKey = `${selectedVersion.id}:${questionId}`;
    const answer = answerDrafts[draftKey]?.trim();
    if (!answer) return;
    setConfirmingQuestion(draftKey);
    setMessage(null);
    const response = await fetch(
      `/api/projects/${data.project.id}/versions/${selectedVersion.id}/questions/${encodeURIComponent(questionId)}/answer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      },
    );
    const body = (await response.json()) as {
      created?: boolean;
      status?: string;
      error?: string;
    };
    setConfirmingQuestion(null);
    if (!response.ok) {
      setMessage(body.error ?? t(locale, "error.questionUnavailable"));
      return;
    }
    track("question.answer_confirmed", {
      projectId: data.project.id,
      versionId: selectedVersion.id,
      payload: {
        result: "success",
        count: body.created ? 1 : 0,
        status: "answered",
      },
    });
    await revalidator.revalidate();
  }

  async function submitFeedback() {
    setBusy("feedback");
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: data.project.id,
        diagramVersionId: selectedVersion?.id ?? null,
        jobId: latestJob?.id ?? null,
        rating,
        text: feedback,
      }),
    });
    const body = (await response.json()) as {
      feedbackId?: string;
      error?: string;
    };
    setBusy(null);
    if (!response.ok || !body.feedbackId) {
      setMessage(body.error ?? t(locale, "error.feedbackSave"));
      return;
    }
    setFeedbackId(body.feedbackId);
    track("feedback.submitted", {
      projectId: data.project.id,
      versionId: selectedVersion?.id,
      payload: { rating },
    });
  }

  async function deleteProject() {
    setBusy("delete");
    const response = await fetch(`/api/projects/${data.project.id}/delete`, {
      method: "POST",
    });
    if (!response.ok) {
      setBusy(null);
      setMessage(t(locale, "error.deleteVerify"));
      return;
    }
    track("project.deleted", {
      projectId: data.project.id,
      payload: { result: "success" },
    });
    window.location.assign("/projects");
  }

  return (
    <main className={`workspace-page${selectedVersion ? " has-version" : ""}`}>
      <header className="topbar workspace-topbar">
        <Link to="/projects" className="wordmark">
          <span>PF</span> Process Foundry
        </Link>
        <div className="project-identity">
          <small>{t(locale, "project.label")}</small>
          <strong>{data.project.title}</strong>
        </div>
        <nav>
          <Link to="/admin/telemetry">{t(locale, "nav.telemetry")}</Link>
          <Link to="/projects">{t(locale, "nav.allProjects")}</Link>
        </nav>
      </header>
      <div className="workspace-grid">
        <aside ref={sourceRailRef} className="source-rail">
          <div className="rail-heading">
            <p className="step-marker">{t(locale, "project.evidenceStep")}</p>
            <h2>{t(locale, "project.sourceDesk")}</h2>
            <p>{t(locale, "project.sourceHint")}</p>
            <p className="bpmn-boundary">
              {t(locale, "generation.bpmnBoundary")}
            </p>
          </div>
          <label htmlFor="process-text">
            {t(locale, "project.description")}
          </label>
          <textarea
            id="process-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={50_000}
            rows={7}
            placeholder={t(locale, "project.descriptionPlaceholder")}
            disabled={isActive}
          />
          <div className="field-foot">
            <span>{text.length.toLocaleString()} / 50,000</span>
            <button
              className="button secondary"
              type="button"
              onClick={() => void uploadText()}
              disabled={!text.trim() || Boolean(busy) || isActive}
            >
              {busy === "text"
                ? t(locale, "project.adding")
                : t(locale, "project.confirmText")}
            </button>
          </div>
          <div className="divider">
            <span>{t(locale, "project.orFiles")}</span>
          </div>
          <label className="file-drop" htmlFor="source-files">
            <strong>{t(locale, "project.chooseFiles")}</strong>
            <span>{t(locale, "project.fileLimits")}</span>
          </label>
          <p className="table-upload-contract">
            {t(locale, "project.tableStructure")}
          </p>
          <input
            className="sr-only"
            id="source-files"
            type="file"
            multiple
            accept="audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav,image/jpeg,image/png,image/webp,image/heic,image/heif,.csv,text/csv,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            disabled={isActive}
          />
          {files.length ? (
            <div className="pending-files">
              {files.map((file) => (
                <span key={`${file.name}-${file.size}`}>
                  {file.name}
                  <small>{(file.size / 1_000_000).toFixed(1)} MB</small>
                </span>
              ))}
              <button
                className="button primary"
                type="button"
                onClick={() => void uploadFiles()}
                disabled={Boolean(busy)}
              >
                {busy === "files"
                  ? t(locale, "project.uploading")
                  : t(
                      locale,
                      files.length === 1
                        ? "project.confirmFiles.one"
                        : "project.confirmFiles.many",
                      { count: files.length },
                    )}
              </button>
            </div>
          ) : null}
          <AudioRecorder
            projectId={data.project.id}
            locale={locale}
            disabled={isActive}
            onUploaded={(sourceId) => revealUploadedSources([sourceId])}
          />
          <section className="confirmed-sources">
            <div className="subsection-heading">
              <h3>{t(locale, "project.confirmedSources")}</h3>
              <span>{selectableSources.length}</span>
            </div>
            {selectableSources.length ? (
              selectableSources.map((source) => (
                <label className="source-row source-choice" key={source.id}>
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.includes(source.id)}
                    onChange={(event) =>
                      setSelectedSourceIds((current) =>
                        event.target.checked
                          ? [...new Set([...current, source.id])]
                          : current.filter((id) => id !== source.id),
                      )
                    }
                    disabled={isActive}
                    aria-label={t(locale, "project.useSource", {
                      name: displaySourceName(locale, source.type, source.name),
                    })}
                  />
                  <span className={`source-kind ${source.type}`}>
                    {source.type.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>
                      {displaySourceName(locale, source.type, source.name)}
                    </strong>
                    <small>
                      <span className="source-type-label">
                        {t(locale, `source.type.${source.type}`)}
                      </span>{" "}
                      · {(source.size_bytes / 1000).toFixed(0)} KB
                    </small>
                  </span>
                </label>
              ))
            ) : (
              <p className="quiet">{t(locale, "project.noSources")}</p>
            )}
          </section>
          {message ? (
            <p className="form-error" role="alert">
              {message}
            </p>
          ) : null}
          <section
            className="generation-surface preflight"
            aria-label={t(locale, "generation.preflightAria")}
          >
            {latest ? (
              <fieldset className="generation-mode-choice">
                <legend>{t(locale, "generation.approach")}</legend>
                <label>
                  <input
                    type="radio"
                    name="generation-mode"
                    value="refine"
                    checked={generationMode === "refine"}
                    onChange={() => setGenerationMode("refine")}
                    disabled={isActive || Boolean(busy)}
                  />
                  <span>{t(locale, "generation.refineAction")}</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="generation-mode"
                    value="alternative"
                    checked={generationMode === "alternative"}
                    onChange={() => setGenerationMode("alternative")}
                    disabled={isActive || Boolean(busy)}
                  />
                  <span>{t(locale, "generation.alternativeAction")}</span>
                </label>
              </fieldset>
            ) : null}
            <div>
              <p className="step-marker">{t(locale, "generation.preflight")}</p>
              <h2>
                {t(locale, "generation.version", {
                  number: nextVersionNumber,
                })}
              </h2>
              <p>
                {t(locale, `generation.mode.${generationMode}`)} ·{" "}
                {generationMode === "refine"
                  ? t(locale, "generation.baseVersion", {
                      number: latest?.version_number ?? "—",
                    })
                  : t(locale, "generation.noBase")}
              </p>
            </div>
            <ul className="preflight-sources">
              {selectedSources.map((source) => (
                <li key={source.id}>
                  {displaySourceName(locale, source.type, source.name)} ·{" "}
                  {t(locale, `source.type.${source.type}`)}
                </li>
              ))}
            </ul>
            <div className="preflight-contract">
              <strong>
                {t(locale, sourceCountKey(selectedSources.length), {
                  count: selectedSources.length,
                })}
              </strong>
              <span>
                {t(
                  locale,
                  clarificationCountKey(preflightClarifications.length),
                  { count: preflightClarifications.length },
                )}
              </span>
              <span>{t(locale, "generation.preserveVersions")}</span>
              <span>{t(locale, "generation.bpmnOnly")}</span>
            </div>
            <div className="preflight-clarifications">
              <strong>{t(locale, "generation.autoAnswers")}</strong>
              {preflightClarifications.length ? (
                <ul>
                  {preflightClarifications.map((clarification) => (
                    <li key={clarification.id}>
                      <span>{clarification.question_text}</span>
                      <span>{clarification.answer}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span>{t(locale, "generation.noAutoAnswers")}</span>
              )}
            </div>
            <div className="button-row">
              <button
                ref={generationCtaRef}
                className="button primary generate"
                type="button"
                disabled={!selectedSources.length || isActive || Boolean(busy)}
                onClick={() => void generate()}
              >
                {busy === "generate"
                  ? t(locale, "project.starting")
                  : t(locale, "generation.confirm", {
                      number: nextVersionNumber,
                    })}
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </section>
        </aside>
        <section className="diagram-column">
          {latestJob ? (
            <div
              className={`generation-surface progress ${latestJob.status}`}
              role={
                isActive
                  ? "status"
                  : latestJob.status === "failed"
                    ? "alert"
                    : undefined
              }
              aria-label={
                isActive ? t(locale, "generation.progressAria") : undefined
              }
            >
              <div>
                <p className="step-marker">
                  {t(locale, "project.generationLabel")}
                </p>
                <strong>
                  {latestJob.status === "failed"
                    ? latestJob.error_code === "generation_failed"
                      ? t(locale, "project.generationFailed")
                      : latestJob.error_safe_message
                    : latestJob.status === "cancelled"
                      ? t(locale, "generation.cancelled")
                      : latestJob.status === "ready"
                        ? t(locale, "project.diagramReady")
                        : t(locale, "project.currentStatus", {
                            status: displayStatus(locale, latestJob.status),
                          })}
                </strong>
              </div>
              <div
                className="stage-track"
                aria-label={t(locale, "project.generationAria", {
                  status: displayStatus(locale, latestJob.status),
                })}
              >
                {stages.map((stage) => (
                  <span
                    key={stage}
                    className={
                      stages.indexOf(stage) <= stages.indexOf(latestJob.status)
                        ? "complete"
                        : ""
                    }
                  >
                    {displayStatus(locale, stage)}
                  </span>
                ))}
              </div>
              <p className="job-provenance">
                {t(locale, "generation.version", {
                  number: latestJob.planned_version_number ?? nextVersionNumber,
                })}{" "}
                ·{" "}
                {latestJob.generation_mode === "legacy"
                  ? t(locale, "generation.mode.legacy")
                  : t(
                      locale,
                      `generation.mode.${latestJob.generation_mode}`,
                    )}{" "}
                ·{" "}
                {latestJob.base_version_id
                  ? t(locale, "generation.baseVersion", {
                      number:
                        data.versions.find(
                          (version) => version.id === latestJob.base_version_id,
                        )?.version_number ?? "—",
                    })
                  : t(locale, "generation.noBase")}{" "}
                ·{" "}
                {t(locale, sourceCountKey(latestJob.source_count), {
                  count: latestJob.source_count,
                })}
                {latestJob.sources.length
                  ? ` · ${latestJob.sources
                      .map(
                        (source) =>
                          `${displaySourceName(locale, source.type, source.name)} · ${t(locale, `source.type.${source.type}`)}`,
                      )
                      .join(", ")}`
                  : ""}{" "}
                ·{" "}
                {t(
                  locale,
                  clarificationCountKey(latestJob.clarification_count),
                  { count: latestJob.clarification_count },
                )}
              </p>
              <div className="job-actions">
                {isActive ? (
                  <button
                    className="button danger-quiet"
                    type="button"
                    disabled={
                      busy === "cancel" || latestJob.status === "cancelling"
                    }
                    onClick={() => void cancelGeneration()}
                  >
                    {latestJob.status === "cancelling"
                      ? t(locale, "generation.cancelling")
                      : t(locale, "generation.cancel")}
                  </button>
                ) : null}
                {latestJob.status === "failed" ||
                latestJob.status === "cancelled" ? (
                  <>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy === "retry"}
                      onClick={() => void retryGeneration()}
                    >
                      {t(locale, "generation.retrySnapshot")}
                    </button>
                  </>
                ) : null}
              </div>
              {latestJob.status === "failed" ? (
                <p className="safe-error-detail">
                  {t(locale, "generation.failureDetail", {
                    code: latestJob.error_code ?? "generation_failed",
                    stage: displayStatus(
                      locale,
                      latestJob.error_stage ?? "queued",
                    ),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
          {selectedVersion ? (
            <>
              <div className="version-bar">
                <label htmlFor="version-select">
                  {t(locale, "project.version")}
                </label>
                <select
                  id="version-select"
                  value={selectedVersion.id}
                  onChange={(event) => {
                    setSelectedVersionId(event.target.value);
                    track("diagram.version_switched", {
                      projectId: data.project.id,
                      versionId: event.target.value,
                    });
                  }}
                >
                  {data.versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {versionLabel(version)}
                    </option>
                  ))}
                </select>
              </div>
              <BpmnEditor
                key={`${selectedVersion.id}-${locale}`}
                xml={selectedVersion.bpmn_xml}
                locale={locale}
                projectId={data.project.id}
                versionId={selectedVersion.id}
                versionNumber={selectedVersion.version_number}
                projectTitle={data.project.title}
                onSaved={(id) => {
                  setSelectedVersionId(id);
                  void revalidator.revalidate();
                }}
              />
            </>
          ) : (
            <div className="diagram-empty">
              <p className="eyebrow">{t(locale, "project.canvasWaiting")}</p>
              <h2>
                {t(locale, "project.evidenceFirst")}
                <br />
                {t(locale, "project.diagramSecond")}
              </h2>
              <p>{t(locale, "project.emptyCanvas")}</p>
            </div>
          )}
        </section>
        <aside className="review-rail">
          <div className="rail-heading">
            <p className="step-marker">{t(locale, "project.reviewStep")}</p>
            <h2>{t(locale, "project.evidenceNotes")}</h2>
            <p>{t(locale, "project.reviewHint")}</p>
          </div>
          <section>
            <div className="subsection-heading">
              <h3>{t(locale, "project.questions")}</h3>
              <span>{ir?.questions.length ?? 0}</span>
            </div>
            {ir?.questions.length ? (
              ir.questions.map((question) => {
                const clarification = data.clarifications.find(
                  (candidate) =>
                    candidate.question_id === question.id &&
                    candidate.question_version_id === selectedVersion?.id,
                );
                const draftKey = `${selectedVersion?.id ?? ""}:${question.id}`;
                return (
                  <article
                    className="review-item question-item"
                    key={question.id}
                  >
                    <div className="question-state-row">
                      <span className={`severity ${question.severity}`}>
                        {t(locale, `severity.${question.severity}`)}
                      </span>
                      <span
                        className={`question-status ${clarification?.status ?? "open"}`}
                      >
                        {clarification?.status === "applied"
                          ? t(locale, "question.status.applied", {
                              number:
                                clarification.applied_version_number ?? "—",
                            })
                          : t(
                              locale,
                              clarification
                                ? "question.status.answered"
                                : "question.status.open",
                            )}
                      </span>
                    </div>
                    <p>{question.text}</p>
                    <small>
                      {t(
                        locale,
                        question.relatedElementIds.length === 1
                          ? "project.related.one"
                          : "project.related.many",
                        { count: question.relatedElementIds.length },
                      )}
                    </small>
                    <label htmlFor={`answer-${draftKey}`}>
                      {t(locale, "question.answerLabel")}
                    </label>
                    <textarea
                      id={`answer-${draftKey}`}
                      value={
                        clarification?.answer ?? answerDrafts[draftKey] ?? ""
                      }
                      onChange={(event) =>
                        setAnswerDrafts((current) => ({
                          ...current,
                          [draftKey]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => event.stopPropagation()}
                      maxLength={5000}
                      rows={3}
                      placeholder={t(locale, "question.answerPlaceholder")}
                      readOnly={Boolean(clarification)}
                    />
                    {!clarification ? (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={
                          !answerDrafts[draftKey]?.trim() ||
                          Boolean(busy) ||
                          Boolean(confirmingQuestion) ||
                          isActive
                        }
                        onClick={() => void confirmAnswer(question.id)}
                      >
                        {confirmingQuestion === draftKey
                          ? t(locale, "question.confirming")
                          : t(locale, "question.confirm")}
                      </button>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <p className="quiet">{t(locale, "project.noQuestions")}</p>
            )}
            {pendingClarifications.length ? (
              <div className="clarification-rebuild">
                <p>
                  {t(
                    locale,
                    pendingClarifications.length === 1
                      ? "question.pending.one"
                      : "question.pending.many",
                    { count: pendingClarifications.length },
                  )}
                </p>
              </div>
            ) : null}
          </section>
          {appliedClarificationHistory.length ? (
            <section
              className="clarification-history"
              aria-label={t(locale, "question.history")}
            >
              <div className="subsection-heading">
                <h3>{t(locale, "question.history")}</h3>
                <span>{appliedClarificationHistory.length}</span>
              </div>
              {appliedClarificationHistory.map((clarification) => (
                <article className="review-item" key={clarification.id}>
                  <p>{clarification.question_text}</p>
                  <p>{clarification.answer}</p>
                  <small>
                    {t(locale, "question.historyOrigin", {
                      number: clarification.question_version_number,
                    })}
                    {" · "}
                    {t(locale, "question.status.applied", {
                      number: clarification.applied_version_number ?? "—",
                    })}
                  </small>
                </article>
              ))}
            </section>
          ) : null}
          <section>
            <div className="subsection-heading">
              <h3>{t(locale, "project.assumptions")}</h3>
              <span>
                {ir?.nodes.reduce(
                  (count, node) => count + node.assumptions.length,
                  0,
                ) ?? 0}
              </span>
            </div>
            {ir?.nodes.flatMap((node) =>
              node.assumptions.map((assumption) => (
                <article
                  className="review-item assumption"
                  key={`${node.id}-${assumption}`}
                >
                  <p>{assumption}</p>
                  <small>
                    {t(locale, "project.modelElement", { type: node.type })}
                  </small>
                </article>
              )),
            )}
          </section>
          <section>
            <div className="subsection-heading">
              <h3>{t(locale, "project.sourceReferences")}</h3>
              <span>
                {ir?.nodes.reduce(
                  (count, node) => count + node.sourceRefs.length,
                  0,
                ) ?? 0}
              </span>
            </div>
            {ir?.nodes
              .flatMap((node) =>
                node.sourceRefs.slice(0, 1).map((ref) => (
                  <article
                    className="review-item source-ref"
                    key={`${node.id}-${ref.sourceId}`}
                  >
                    <p>
                      {(() => {
                        const source = data.sources.find(
                          (candidate) => candidate.id === ref.sourceId,
                        );
                        return source
                          ? displaySourceName(locale, source.type, source.name)
                          : t(locale, "project.sourceFallback");
                      })()}
                    </p>
                    <small>
                      {ref.locator} · {node.type}
                    </small>
                  </article>
                )),
              )
              .slice(0, 10)}
          </section>
          {latest ? (
            <section className="correction-box">
              <h3>{t(locale, "project.correctionTitle")}</h3>
              <label htmlFor="correction">
                {t(locale, "project.correctionLabel")}
              </label>
              <textarea
                id="correction"
                value={correction}
                onChange={(event) => setCorrection(event.target.value)}
                maxLength={50_000}
                rows={4}
                placeholder={t(locale, "project.correctionPlaceholder")}
              />
              <button
                className="button secondary"
                type="button"
                disabled={!correction.trim() || Boolean(busy) || isActive}
                onClick={() =>
                  void uploadText("correction", correction).then((sourceId) => {
                    if (sourceId) setGenerationMode("refine");
                  })
                }
              >
                {t(locale, "project.regenerate")}
              </button>
            </section>
          ) : null}
          {latest ? (
            <section className="feedback-box">
              <h3>{t(locale, "project.rate")}</h3>
              <div
                className="rating"
                role="radiogroup"
                aria-label={t(locale, "project.ratingAria")}
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={rating === value ? "selected" : ""}
                    onClick={() => {
                      setRating(value);
                      track("rating.selected", {
                        projectId: data.project.id,
                        versionId: selectedVersion?.id,
                        payload: { rating: value },
                      });
                    }}
                    aria-label={t(locale, "project.ratingValue", { value })}
                    aria-pressed={rating === value}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <label htmlFor="feedback">{t(locale, "project.feedback")}</label>
              <textarea
                id="feedback"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                maxLength={5000}
                rows={4}
                placeholder={t(locale, "project.feedbackPlaceholder")}
              />
              <button
                className="button primary"
                type="button"
                onClick={() => void submitFeedback()}
                disabled={!rating || !feedback.trim() || Boolean(busy)}
              >
                {busy === "feedback"
                  ? t(locale, "project.feedbackSaving")
                  : t(locale, "project.feedbackSave")}
              </button>
              {feedbackId ? (
                <p className="success-note">
                  {t(locale, "project.feedbackSaved", { id: feedbackId })}
                </p>
              ) : null}
            </section>
          ) : null}
          <details className="delete-zone">
            <summary>{t(locale, "project.deleteSummary")}</summary>
            <p>{t(locale, "project.deleteExplanation")}</p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmDelete}
                onChange={(event) => setConfirmDelete(event.target.checked)}
              />{" "}
              {t(locale, "project.deleteConfirm")}
            </label>
            <button
              className="button danger"
              type="button"
              disabled={!confirmDelete || Boolean(busy)}
              onClick={() => void deleteProject()}
            >
              {busy === "delete"
                ? t(locale, "project.deleting")
                : t(locale, "project.deleteButton")}
            </button>
          </details>
        </aside>
      </div>
    </main>
  );
}
