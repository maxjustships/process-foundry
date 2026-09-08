import {
  TABLE_SOURCE_LIMITS,
  TableSourceError,
  columnName,
  serializeTableDocument,
  type StructuredTableDocument,
} from "./table-source";

type CsvExtraction = {
  document: StructuredTableDocument;
  text: string;
};

function malformed(category: string): never {
  throw new TableSourceError("table_malformed_file", "csv", category);
}

function exceeded(category: string): never {
  throw new TableSourceError("table_limit_exceeded", "csv", category);
}

function detectDelimiter(input: string): "," | ";" | "\t" {
  const counts = new Map<"," | ";" | "\t", number>([
    [",", 0],
    [";", 0],
    ["\t", 0],
  ]);
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && (character === "\n" || character === "\r")) {
      break;
    } else if (!quoted && counts.has(character as "," | ";" | "\t")) {
      const delimiter = character as "," | ";" | "\t";
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort(
    ([leftDelimiter, left], [rightDelimiter, right]) =>
      right - left ||
      [",", ";", "\t"].indexOf(leftDelimiter) -
        [",", ";", "\t"].indexOf(rightDelimiter),
  )[0][0];
}

function parseRows(input: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let afterQuote = false;
  let atCellStart = true;

  const finishCell = () => {
    if (cell.length > TABLE_SOURCE_LIMITS.cellCharacters)
      exceeded("cell_characters");
    row.push(cell);
    cell = "";
    atCellStart = true;
    afterQuote = false;
  };
  const finishRow = () => {
    finishCell();
    if (row.length > TABLE_SOURCE_LIMITS.columnsPerSection) exceeded("columns");
    rows.push(row);
    if (rows.length > TABLE_SOURCE_LIMITS.rowsPerSection) exceeded("rows");
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else if (character === "\r") {
        if (input[index + 1] === "\n") index += 1;
        cell += "\n";
      } else {
        cell += character;
      }
      if (cell.length > TABLE_SOURCE_LIMITS.cellCharacters)
        exceeded("cell_characters");
      continue;
    }

    if (afterQuote) {
      if (character === delimiter) {
        finishCell();
        continue;
      }
      if (character === "\n" || character === "\r") {
        if (character === "\r" && input[index + 1] === "\n") index += 1;
        finishRow();
        continue;
      }
      malformed("csv_quoting");
    }

    if (character === '"') {
      if (!atCellStart) malformed("csv_quoting");
      quoted = true;
      atCellStart = false;
    } else if (character === delimiter) {
      finishCell();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      cell += character;
      atCellStart = false;
      if (cell.length > TABLE_SOURCE_LIMITS.cellCharacters)
        exceeded("cell_characters");
    }
  }
  if (quoted) malformed("csv_quoting");
  if (row.length || cell.length || afterQuote || !atCellStart) finishRow();
  return rows;
}

export function parseCsvTable(
  bytes: Uint8Array,
  sourceId: string,
): CsvExtraction {
  if (bytes.byteLength > TABLE_SOURCE_LIMITS.rawBytes.csv)
    exceeded("file_bytes");
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    malformed("encoding");
  }
  const input = decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
  const delimiter = detectDelimiter(input);
  const rows = parseRows(input, delimiter);
  if (!rows.length) malformed("empty_document");
  const width = rows[0].length;
  if (rows.some((row) => row.length > width)) malformed("inconsistent_columns");

  const headers = rows[0];
  const document: StructuredTableDocument = {
    sourceId,
    format: "csv",
    sections: [
      {
        kind: "table",
        index: 1,
        name: "CSV",
        rows: rows.map((values, rowIndex) => ({
          number: rowIndex + 1,
          cells: values.map((value, columnIndex) => ({
            column: columnIndex + 1,
            coordinate: `${columnName(columnIndex + 1)}${rowIndex + 1}`,
            ...(rowIndex > 0 && headers[columnIndex]
              ? { header: headers[columnIndex] }
              : {}),
            value,
          })),
        })),
      },
    ],
  };
  return { document, text: serializeTableDocument(document) };
}
