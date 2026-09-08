export const TABLE_SOURCE_LIMITS = {
  rawBytes: {
    csv: 2_097_152,
    docx: 8_388_608,
    xlsx: 10_485_760,
  },
  archiveEntries: 128,
  archiveTotalUncompressedBytes: 16_777_216,
  archiveEntryCompressedBytes: 8_388_608,
  archiveEntryUncompressedBytes: 8_388_608,
  archiveCompressionRatio: 100,
  sheets: 16,
  tables: 32,
  rowsPerSection: 1_000,
  columnsPerSection: 64,
  totalCells: 20_000,
  cellCharacters: 2_000,
  extractedCharacters: 200_000,
  xmlDepth: 64,
} as const;

export type TableSourceFormat = keyof typeof TABLE_SOURCE_LIMITS.rawBytes;
export type TableSourceErrorCode =
  | "table_unsupported_format"
  | "table_mime_mismatch"
  | "table_malformed_file"
  | "table_unsafe_archive"
  | "table_limit_exceeded";

export class TableSourceError extends Error {
  constructor(
    readonly code: TableSourceErrorCode,
    readonly format: TableSourceFormat | "unknown",
    readonly category: string,
  ) {
    super(`${code}:${format}:${category}`);
    this.name = "TableSourceError";
  }

  toJSON() {
    return {
      code: this.code,
      format: this.format,
      category: this.category,
      name: this.name,
    };
  }
}

export type StructuredCell = {
  column: number;
  coordinate: string;
  header?: string;
  value: string;
  columnSpan?: number;
  rowSpan?: number;
};

export type StructuredRow = {
  number: number;
  cells: StructuredCell[];
};

export type StructuredSection = {
  kind: "table" | "sheet";
  index: number;
  name: string;
  rows: StructuredRow[];
};

export type StructuredTableDocument = {
  sourceId: string;
  format: TableSourceFormat;
  sections: StructuredSection[];
};

function limitError(format: TableSourceFormat, category: string): never {
  throw new TableSourceError("table_limit_exceeded", format, category);
}

export function columnName(column: number): string {
  if (!Number.isInteger(column) || column < 1) return "?";
  let value = column;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

export function assertSafeArchiveName(
  name: string,
  format: Exclude<TableSourceFormat, "csv">,
): string {
  const normalized = name.normalize("NFC");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/u.test(normalized) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new TableSourceError("table_unsafe_archive", format, "archive_name");
  return normalized.toLocaleLowerCase("en-US");
}

export function serializeTableDocument(
  document: StructuredTableDocument,
): string {
  const { format } = document;
  if (!/^[a-zA-Z0-9_-]{1,160}$/u.test(document.sourceId))
    throw new TableSourceError("table_malformed_file", format, "source_id");
  const maximumSections =
    format === "xlsx" ? TABLE_SOURCE_LIMITS.sheets : TABLE_SOURCE_LIMITS.tables;
  if (document.sections.length > maximumSections)
    limitError(format, format === "xlsx" ? "sheets" : "tables");

  let totalCells = 0;
  const lines = [`[source:${document.sourceId}]`];
  for (const section of document.sections) {
    if (section.rows.length > TABLE_SOURCE_LIMITS.rowsPerSection)
      limitError(format, "rows");
    lines.push(
      JSON.stringify({
        format,
        sectionKind: section.kind,
        sectionIndex: section.index,
        sectionName: section.name,
      }),
    );
    for (const row of section.rows) {
      if (row.cells.length > TABLE_SOURCE_LIMITS.columnsPerSection)
        limitError(format, "columns");
      totalCells += row.cells.length;
      if (totalCells > TABLE_SOURCE_LIMITS.totalCells)
        limitError(format, "total_cells");
      const cells = row.cells.map((cell) => {
        if (cell.value.length > TABLE_SOURCE_LIMITS.cellCharacters)
          limitError(format, "cell_characters");
        if (
          cell.header !== undefined &&
          cell.header.length > TABLE_SOURCE_LIMITS.cellCharacters
        )
          limitError(format, "cell_characters");
        return {
          coordinate: cell.coordinate,
          column: columnName(cell.column),
          ...(cell.header === undefined ? {} : { header: cell.header }),
          value: cell.value,
          ...(cell.columnSpan === undefined
            ? {}
            : { columnSpan: cell.columnSpan }),
          ...(cell.rowSpan === undefined ? {} : { rowSpan: cell.rowSpan }),
        };
      });
      lines.push(JSON.stringify({ row: row.number, cells }));
    }
  }
  const result = lines.join("\n");
  if (result.length > TABLE_SOURCE_LIMITS.extractedCharacters)
    limitError(format, "extracted_characters");
  return result;
}
