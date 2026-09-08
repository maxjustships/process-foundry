import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { addSource, getProject } from "../lib/repository.server";
import {
  cloudflareEnv,
  jsonError,
  readBoundedJson,
  requireMutationOrigin,
  requireSession,
} from "../lib/request.server";
import { SOURCE_LIMITS, validateSourceUpload } from "../lib/uploads";
import { resolveLocale, t } from "../lib/i18n";
import { ingestTableSource } from "../lib/table-ingestion.server";
import { TableSourceError } from "../lib/table-source";

const textInput = z
  .object({
    text: z.string().min(1).max(SOURCE_LIMITS.textCharacters),
    name: z.string().min(1).max(160).default("Pasted process description"),
    kind: z.enum(["text", "correction"]).default("text"),
  })
  .strict();

export async function action({ request, context, params }: ActionFunctionArgs) {
  await requireSession(request, context);
  requireMutationOrigin(request);
  const env = cloudflareEnv(context);
  const locale = resolveLocale(request);
  const projectId = params.projectId;
  if (!projectId || !(await getProject(env.DB, projectId)))
    return jsonError(t(locale, "error.projectNotFound"), 404);
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "text" || kind === "correction") {
    const parsed = textInput.safeParse(await readBoundedJson(request, 70_000));
    if (!parsed.success) return jsonError(t(locale, "error.textInput"), 400);
    const input = parsed.data;
    const id = crypto.randomUUID();
    const key = `projects/${projectId}/sources/${id}.txt`;
    await env.SOURCES.put(key, input.text, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });
    try {
      const source = await addSource(env.DB, {
        id,
        project_id: projectId,
        type: kind,
        name: input.name,
        mime_type: "text/plain",
        size_bytes: new TextEncoder().encode(input.text).byteLength,
        duration_seconds: null,
        r2_key: key,
      });
      return Response.json({ ok: true, source }, { status: 201 });
    } catch (error) {
      await env.SOURCES.delete(key);
      throw error;
    }
  }
  const rawName =
    request.headers.get("X-Source-Name") ?? t(locale, "source.generic.file");
  let name: string;
  try {
    name = decodeURIComponent(rawName).slice(0, 160);
  } catch {
    name = t(locale, "source.generic.file");
  }
  if (
    kind === "table" ||
    kind === "csv" ||
    kind === "docx" ||
    kind === "xlsx"
  ) {
    if (!request.body) return jsonError(t(locale, "error.emptyFile"), 400);
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    const mimeType =
      request.headers
        .get("Content-Type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() ?? "";
    try {
      const source = await ingestTableSource(env.DB, env.SOURCES, {
        projectId,
        sourceId: crypto.randomUUID(),
        name,
        mimeType,
        contentLength,
        body: request.body,
      });
      return Response.json({ ok: true, source }, { status: 201 });
    } catch (error) {
      if (!(error instanceof TableSourceError)) throw error;
      const message = (() => {
        if (error.code === "table_unsupported_format")
          return t(locale, "error.table.unsupported");
        if (error.code === "table_mime_mismatch")
          return t(locale, "error.table.mimeMismatch");
        if (error.code === "table_unsafe_archive")
          return t(locale, "error.table.unsafeArchive");
        if (error.code === "table_malformed_file")
          return t(locale, "error.table.malformed");
        const limitKeys = {
          file_bytes: "error.table.limit.fileBytes",
          archive_entries: "error.table.limit.archiveEntries",
          archive_uncompressed_bytes: "error.table.limit.archiveBytes",
          entry_compressed_bytes: "error.table.limit.entryBytes",
          entry_uncompressed_bytes: "error.table.limit.entryBytes",
          compression_ratio: "error.table.limit.compressionRatio",
          sheets: "error.table.limit.sheets",
          tables: "error.table.limit.tables",
          rows: "error.table.limit.rows",
          columns: "error.table.limit.columns",
          total_cells: "error.table.limit.totalCells",
          cell_characters: "error.table.limit.cellCharacters",
          extracted_characters: "error.table.limit.extractedCharacters",
          xml_depth: "error.table.limit.xmlDepth",
        } as const;
        return t(
          locale,
          limitKeys[error.category as keyof typeof limitKeys] ??
            "error.table.limit.generic",
        );
      })();
      return Response.json(
        {
          ok: false,
          error: message,
          errorCode: error.code,
          format: error.format,
          category: error.category,
        },
        { status: error.code === "table_limit_exceeded" ? 413 : 400 },
      );
    }
  }
  if (kind !== "audio" && kind !== "image")
    return jsonError(t(locale, "error.sourceType"), 400);
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  const durationSeconds =
    kind === "audio"
      ? Number(request.headers.get("X-Duration-Seconds") ?? Number.NaN)
      : undefined;
  const mimeType =
    request.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  const validation = validateSourceUpload(
    { kind, mimeType, sizeBytes: contentLength, durationSeconds },
    locale,
  );
  if (!validation.ok) return jsonError(validation.message, 400);
  const project = await getProject(env.DB, projectId);
  const currentCount =
    project?.sources.filter((source) => source.type === kind).length ?? 0;
  if (
    (kind === "audio" && currentCount >= SOURCE_LIMITS.audioCount) ||
    (kind === "image" && currentCount >= SOURCE_LIMITS.imageCount)
  )
    return jsonError(
      t(locale, "error.sourceMaximum", {
        kind: t(locale, `source.type.${kind}`),
      }),
      409,
    );
  if (!request.body) return jsonError(t(locale, "error.emptyFile"), 400);
  const id = crypto.randomUUID();
  const key = `projects/${projectId}/sources/${id}`;
  if (name === t(locale, "source.generic.file"))
    name = t(locale, `source.generic.${kind}`);
  await env.SOURCES.put(key, request.body, {
    httpMetadata: { contentType: mimeType },
    customMetadata: { sourceId: id, kind },
  });
  try {
    const source = await addSource(env.DB, {
      id,
      project_id: projectId,
      type: kind,
      name,
      mime_type: mimeType,
      size_bytes: contentLength,
      duration_seconds: durationSeconds ?? null,
      r2_key: key,
    });
    return Response.json({ ok: true, source }, { status: 201 });
  } catch (error) {
    await env.SOURCES.delete(key);
    throw error;
  }
}
