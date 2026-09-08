import { addSource, type SourceRow } from "./repository.server";
import { parseCsvTable } from "./csv-table";
import { extractDocxTables, extractXlsxTables } from "./ooxml-table";
import {
  TABLE_SOURCE_LIMITS,
  TableSourceError,
  type StructuredTableDocument,
  type TableSourceFormat,
} from "./table-source";

const MIME_TYPES: Record<TableSourceFormat, ReadonlySet<string>> = {
  csv: new Set(["text/csv", "application/csv"]),
  docx: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  xlsx: new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
};
const CANONICAL_MIME: Record<TableSourceFormat, string> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function validateTableUploadMetadata(
  name: string,
  mimeType: string,
): { format: TableSourceFormat } {
  const extension = /\.([^.]+)$/u
    .exec(name.trim())?.[1]
    ?.toLocaleLowerCase("en-US");
  if (extension !== "csv" && extension !== "docx" && extension !== "xlsx")
    throw new TableSourceError(
      "table_unsupported_format",
      "unknown",
      "extension",
    );
  const normalizedMime = mimeType
    .split(";", 1)[0]
    .trim()
    .toLocaleLowerCase("en-US");
  if (normalizedMime && !MIME_TYPES[extension].has(normalizedMime))
    throw new TableSourceError("table_mime_mismatch", extension, "mime");
  return { format: extension };
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
  format: TableSourceFormat,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes)
        throw new TableSourceError(
          "table_limit_exceeded",
          format,
          "file_bytes",
        );
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total)
    throw new TableSourceError("table_malformed_file", format, "empty_file");
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function extractionMetadata(
  format: TableSourceFormat,
  document: StructuredTableDocument,
) {
  return JSON.stringify({
    format,
    sectionCount: document.sections.length,
    rowCount: document.sections.reduce(
      (count, section) => count + section.rows.length,
      0,
    ),
    cellCount: document.sections.reduce(
      (count, section) =>
        count +
        section.rows.reduce((rowCount, row) => rowCount + row.cells.length, 0),
      0,
    ),
  });
}

type TableBucket = Pick<R2Bucket, "put" | "delete">;

export async function ingestTableSource(
  db: D1Database,
  bucket: TableBucket,
  input: {
    projectId: string;
    sourceId: string;
    name: string;
    mimeType: string;
    contentLength: number;
    body: ReadableStream<Uint8Array>;
  },
): Promise<SourceRow> {
  const { format } = validateTableUploadMetadata(input.name, input.mimeType);
  const maximumBytes = TABLE_SOURCE_LIMITS.rawBytes[format];
  if (
    !Number.isFinite(input.contentLength) ||
    input.contentLength < 0 ||
    input.contentLength > maximumBytes
  )
    throw new TableSourceError("table_limit_exceeded", format, "file_bytes");
  const bytes = await readBoundedBody(input.body, maximumBytes, format);
  const extraction =
    format === "csv"
      ? parseCsvTable(bytes, input.sourceId)
      : format === "docx"
        ? extractDocxTables(bytes, input.sourceId)
        : extractXlsxTables(bytes, input.sourceId);
  const rawKey = `projects/${input.projectId}/sources/${input.sourceId}.${format}`;
  const extractedKey = `projects/${input.projectId}/extracted/${input.sourceId}.txt`;
  try {
    await bucket.put(rawKey, bytes.slice().buffer, {
      httpMetadata: { contentType: input.mimeType || CANONICAL_MIME[format] },
      customMetadata: { sourceId: input.sourceId, kind: format },
    });
    await bucket.put(extractedKey, extraction.text, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
      customMetadata: {
        sourceId: input.sourceId,
        kind: "structured-extraction",
      },
    });
    return await addSource(db, {
      id: input.sourceId,
      project_id: input.projectId,
      type: format,
      name: input.name.slice(0, 160),
      mime_type: input.mimeType || CANONICAL_MIME[format],
      size_bytes: bytes.byteLength,
      duration_seconds: null,
      r2_key: rawKey,
      extracted_r2_key: extractedKey,
      extracted_metadata_json: extractionMetadata(format, extraction.document),
    });
  } catch (error) {
    await bucket.delete([rawKey, extractedKey]);
    throw error;
  }
}
