import { XMLParser, XMLValidator } from "fast-xml-parser";
import { readSafeZip } from "./safe-zip";
import {
  TABLE_SOURCE_LIMITS,
  TableSourceError,
  columnName,
  serializeTableDocument,
  type StructuredCell,
  type StructuredTableDocument,
  type TableSourceFormat,
} from "./table-source";

type OrderedNode = Record<string, unknown> & {
  ":@"?: Record<string, string>;
};

const parser = new XMLParser({
  preserveOrder: true,
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  trimValues: false,
  parseTagValue: false,
});

function malformed(
  format: Exclude<TableSourceFormat, "csv">,
  category: string,
): never {
  throw new TableSourceError("table_malformed_file", format, category);
}

function decodeXml(
  value: Uint8Array | undefined,
  format: Exclude<TableSourceFormat, "csv">,
  required = true,
): string | null {
  if (!value) {
    if (required) malformed(format, "missing_part");
    return null;
  }
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    malformed(format, "xml_encoding");
  }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(xml))
    malformed(format, "xml_entities");
  let depth = 0;
  let maximumDepth = 0;
  for (const match of xml.matchAll(
    /<\s*(\/)?\s*([A-Za-z_][\w:.-]*)([^>]*)>/gu,
  )) {
    const closing = Boolean(match[1]);
    const selfClosing = /\/\s*>$/u.test(match[0]);
    if (closing) depth -= 1;
    else if (!selfClosing) {
      depth += 1;
      maximumDepth = Math.max(maximumDepth, depth);
    }
    if (depth < 0) malformed(format, "xml");
    if (maximumDepth > TABLE_SOURCE_LIMITS.xmlDepth)
      throw new TableSourceError("table_limit_exceeded", format, "xml_depth");
  }
  if (XMLValidator.validate(xml) !== true) malformed(format, "xml");
  return xml;
}

function parseOrdered(xml: string, format: "docx" | "xlsx"): OrderedNode[] {
  try {
    return parser.parse(xml) as OrderedNode[];
  } catch {
    malformed(format, "xml");
  }
}

function nodeChildren(node: OrderedNode, name: string): OrderedNode[] {
  const value = node[name];
  return Array.isArray(value) ? (value as OrderedNode[]) : [];
}

function namedChildren(nodes: OrderedNode[], name: string): OrderedNode[] {
  return nodes.filter((node) => Object.hasOwn(node, name));
}

function firstNamed(nodes: OrderedNode[], name: string): OrderedNode | null {
  return namedChildren(nodes, name)[0] ?? null;
}

function descendants(nodes: OrderedNode[], name: string): OrderedNode[] {
  const found: OrderedNode[] = [];
  for (const node of nodes) {
    if (Object.hasOwn(node, name)) found.push(node);
    for (const [key, value] of Object.entries(node))
      if (key !== ":@" && Array.isArray(value))
        found.push(...descendants(value as OrderedNode[], name));
  }
  return found;
}

function textFromNodes(nodes: OrderedNode[]): string {
  let value = "";
  for (const node of nodes) {
    if (
      typeof node["#text"] === "string" ||
      typeof node["#text"] === "number" ||
      typeof node["#text"] === "boolean"
    )
      value += String(node["#text"]);
    if (Object.hasOwn(node, "br")) value += "\n";
    for (const [key, children] of Object.entries(node))
      if (key !== ":@" && Array.isArray(children))
        value += textFromNodes(children as OrderedNode[]);
  }
  return value;
}

function paragraphText(node: OrderedNode): string {
  return textFromNodes(nodeChildren(node, "p"));
}

function headingText(node: OrderedNode): string | null {
  const styles = descendants(nodeChildren(node, "p"), "pStyle");
  const style = styles[0]?.[":@"]?.val ?? "";
  if (!/^(?:Heading[1-6]|Title)$/u.test(style)) return null;
  const text = paragraphText(node).trim();
  return text && text.length <= TABLE_SOURCE_LIMITS.cellCharacters
    ? text
    : null;
}

function documentTable(
  tableNode: OrderedNode,
  tableIndex: number,
  heading: string | null,
): StructuredTableDocument["sections"][number] {
  const rowNodes = namedChildren(nodeChildren(tableNode, "tbl"), "tr");
  const verticalMerges = new Map<number, StructuredCell>();
  const headers = new Map<number, string>();
  const rows = rowNodes.map((rowNode, rowIndex) => {
    let column = 1;
    const cells = namedChildren(nodeChildren(rowNode, "tr"), "tc").map(
      (cellNode) => {
        const properties = firstNamed(nodeChildren(cellNode, "tc"), "tcPr");
        const propertyChildren = properties
          ? nodeChildren(properties, "tcPr")
          : [];
        const spanNode = firstNamed(propertyChildren, "gridSpan");
        const parsedSpan = Number(spanNode?.[":@"]?.val ?? 1);
        const columnSpan =
          Number.isInteger(parsedSpan) && parsedSpan > 0 ? parsedSpan : 1;
        const paragraphs = namedChildren(nodeChildren(cellNode, "tc"), "p");
        const value = paragraphs.map(paragraphText).join("\n");
        const cell: StructuredCell = {
          column,
          coordinate: `${columnName(column)}${rowIndex + 1}`,
          ...(rowIndex > 0 && headers.get(column)
            ? { header: headers.get(column) }
            : {}),
          value,
          columnSpan,
          rowSpan: 1,
        };
        if (rowIndex === 0)
          for (let offset = 0; offset < columnSpan; offset += 1)
            headers.set(column + offset, value);
        const mergeNode = firstNamed(propertyChildren, "vMerge");
        if (mergeNode) {
          const mergeValue = mergeNode[":@"]?.val;
          if (mergeValue === "restart") verticalMerges.set(column, cell);
          else {
            const origin = verticalMerges.get(column);
            if (!origin) malformed("docx", "merged_cell");
            origin.rowSpan = (origin.rowSpan ?? 1) + 1;
          }
        } else verticalMerges.delete(column);
        column += columnSpan;
        return cell;
      },
    );
    if (column - 1 > TABLE_SOURCE_LIMITS.columnsPerSection)
      throw new TableSourceError("table_limit_exceeded", "docx", "columns");
    return { number: rowIndex + 1, cells };
  });
  return {
    kind: "table",
    index: tableIndex,
    name: heading ?? `Table ${tableIndex}`,
    rows,
  };
}

const allowedDocxPart = (name: string) =>
  name === "[content_types].xml" ||
  name === "_rels/.rels" ||
  name === "word/document.xml" ||
  name === "word/_rels/document.xml.rels" ||
  /^docprops\/(?:app|core|custom)\.xml$/u.test(name) ||
  /^word\/(?:fonttable|numbering|settings|styles|websettings)\.xml$/u.test(
    name,
  ) ||
  /^word\/theme\/theme\d+\.xml$/u.test(name);

function validateRelationships(
  parts: Map<string, Uint8Array>,
  format: "docx" | "xlsx",
) {
  const allowedSuffixes =
    format === "docx"
      ? [
          "/officeDocument",
          "/styles",
          "/numbering",
          "/settings",
          "/theme",
          "/fontTable",
          "/webSettings",
          "/core-properties",
          "/extended-properties",
          "/custom-properties",
        ]
      : [
          "/officeDocument",
          "/worksheet",
          "/sharedStrings",
          "/styles",
          "/theme",
          "/core-properties",
          "/extended-properties",
          "/custom-properties",
        ];
  for (const [name, bytes] of parts) {
    if (!name.endsWith(".rels")) continue;
    const xml = decodeXml(bytes, format)!;
    const parsed = parseOrdered(xml, format);
    for (const relationship of descendants(parsed, "Relationship")) {
      const attributes = relationship[":@"] ?? {};
      if (attributes.TargetMode?.toLocaleLowerCase("en-US") === "external")
        malformed(format, "external_relationship");
      const type = attributes.Type ?? "";
      if (!allowedSuffixes.some((suffix) => type.endsWith(suffix)))
        malformed(format, "relationship_type");
      const target = attributes.Target ?? "";
      if (
        !target ||
        target.includes("\\") ||
        target.split("/").includes("..") ||
        target.startsWith("/") ||
        /^[a-z][a-z0-9+.-]*:/iu.test(target)
      )
        malformed(format, "relationship_target");
    }
  }
}

export function extractDocxTables(
  bytes: Uint8Array,
  sourceId: string,
): { document: StructuredTableDocument; text: string } {
  const parts = readSafeZip(bytes, "docx", allowedDocxPart);
  const contentTypes = decodeXml(parts.get("[content_types].xml"), "docx")!;
  if (
    /macroenabled|vba|oleobject|application\/vnd\.openxmlformats-officedocument\.oleobject|application\/vnd\.openxmlformats-officedocument\.package/iu.test(
      contentTypes,
    )
  )
    malformed("docx", "macro_content");
  if (
    !contentTypes.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    )
  )
    malformed("docx", "content_type");
  validateRelationships(parts, "docx");
  const documentXml = decodeXml(parts.get("word/document.xml"), "docx")!;
  const parsed = parseOrdered(documentXml, "docx");
  const documentNode = firstNamed(parsed, "document");
  const bodyNode = documentNode
    ? firstNamed(nodeChildren(documentNode, "document"), "body")
    : null;
  if (!bodyNode) malformed("docx", "xml");
  const body = nodeChildren(bodyNode, "body");
  const sections: StructuredTableDocument["sections"] = [];
  let nearbyHeading: string | null = null;
  for (const node of body) {
    if (Object.hasOwn(node, "p")) nearbyHeading = headingText(node);
    else if (Object.hasOwn(node, "tbl")) {
      sections.push(documentTable(node, sections.length + 1, nearbyHeading));
      nearbyHeading = null;
    } else nearbyHeading = null;
  }
  if (!sections.length) malformed("docx", "no_tables");
  const document: StructuredTableDocument = {
    sourceId,
    format: "docx",
    sections,
  };
  return { document, text: serializeTableDocument(document) };
}

const allowedXlsxPart = (name: string) =>
  name === "[content_types].xml" ||
  name === "_rels/.rels" ||
  name === "xl/workbook.xml" ||
  name === "xl/_rels/workbook.xml.rels" ||
  name === "xl/sharedstrings.xml" ||
  name === "xl/styles.xml" ||
  /^docprops\/(?:app|core|custom)\.xml$/u.test(name) ||
  /^xl\/worksheets\/sheet\d+\.xml$/u.test(name) ||
  /^xl\/theme\/theme\d+\.xml$/u.test(name);

function spreadsheetColumn(reference: string): {
  column: number;
  row: number;
} {
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(reference);
  if (!match) malformed("xlsx", "cell_reference");
  let column = 0;
  for (const character of match[1])
    column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (column > TABLE_SOURCE_LIMITS.columnsPerSection)
    throw new TableSourceError("table_limit_exceeded", "xlsx", "columns");
  if (row > TABLE_SOURCE_LIMITS.rowsPerSection)
    throw new TableSourceError("table_limit_exceeded", "xlsx", "rows");
  return { column, row };
}

function nodeText(node: OrderedNode | null, name: string): string {
  return node ? textFromNodes(nodeChildren(node, name)).trim() : "";
}

function sharedStringValues(xml: string | null): string[] {
  if (!xml) return [];
  const parsed = parseOrdered(xml, "xlsx");
  return descendants(parsed, "si").map((item) =>
    descendants(nodeChildren(item, "si"), "t")
      .map((textNode) => textFromNodes(nodeChildren(textNode, "t")))
      .join(""),
  );
}

function dateStyleIndexes(xml: string | null): Set<number> {
  const indexes = new Set<number>();
  if (!xml) return indexes;
  const parsed = parseOrdered(xml, "xlsx");
  const customDateFormats = new Set<number>();
  for (const format of descendants(parsed, "numFmt")) {
    const id = Number(format[":@"]?.numFmtId);
    const code = format[":@"]?.formatCode ?? "";
    if (
      Number.isInteger(id) &&
      /[ymdhis]/iu.test(code.replace(/"[^"]*"/gu, ""))
    )
      customDateFormats.add(id);
  }
  const cellFormats = descendants(parsed, "cellXfs")[0];
  if (!cellFormats) return indexes;
  namedChildren(nodeChildren(cellFormats, "cellXfs"), "xf").forEach(
    (format, index) => {
      const id = Number(format[":@"]?.numFmtId ?? 0);
      if ((id >= 14 && id <= 22) || customDateFormats.has(id))
        indexes.add(index);
    },
  );
  return indexes;
}

function excelDate(value: string, date1904: boolean): string | null {
  if (!/^[0-9]+(?:\.[0-9]+)?$/u.test(value)) return null;
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86_400_000);
  if (!Number.isFinite(date.getTime())) return null;
  const iso = date.toISOString();
  return serial % 1 === 0 ? iso.slice(0, 10) : iso.replace(/\.000Z$/u, "Z");
}

function cellValue(
  cell: OrderedNode,
  sharedStrings: string[],
  dateStyles: Set<number>,
  date1904: boolean,
): string {
  const children = nodeChildren(cell, "c");
  const attributes = cell[":@"] ?? {};
  const type = attributes.t ?? "n";
  const raw = nodeText(firstNamed(children, "v"), "v");
  const formula = firstNamed(children, "f") !== null;
  if (!raw && formula) return "[formula:cached-value-unavailable]";
  if (type === "inlineStr") {
    const inline = firstNamed(children, "is");
    return inline
      ? descendants(nodeChildren(inline, "is"), "t")
          .map((textNode) => textFromNodes(nodeChildren(textNode, "t")))
          .join("")
      : "";
  }
  if (type === "s") {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) malformed("xlsx", "shared_string");
    const value = sharedStrings[Number(raw)];
    if (value === undefined) malformed("xlsx", "shared_string");
    return value;
  }
  if (type === "b") {
    if (raw === "1") return "true";
    if (raw === "0") return "false";
    malformed("xlsx", "boolean");
  }
  if (type === "e") {
    const known: Record<string, string> = {
      "#NULL!": "NULL",
      "#DIV/0!": "DIV0",
      "#VALUE!": "VALUE",
      "#REF!": "REF",
      "#NAME?": "NAME",
      "#NUM!": "NUM",
      "#N/A": "NA",
      "#GETTING_DATA": "GETTING_DATA",
    };
    return `#ERROR:${known[raw] ?? "UNKNOWN"}`;
  }
  if (type === "d") {
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) malformed("xlsx", "date");
    return date.toISOString();
  }
  if (type === "str") return raw;
  if (!raw) return "";
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/u.test(raw))
    malformed("xlsx", "number");
  const styleIndex = Number(attributes.s ?? 0);
  if (dateStyles.has(styleIndex)) return excelDate(raw, date1904) ?? raw;
  return raw;
}

function worksheetSection(
  xml: string,
  index: number,
  name: string,
  sharedStrings: string[],
  dateStyles: Set<number>,
  date1904: boolean,
): StructuredTableDocument["sections"][number] {
  const parsed = parseOrdered(xml, "xlsx");
  const worksheetNode = firstNamed(parsed, "worksheet");
  const sheetData = worksheetNode
    ? descendants(nodeChildren(worksheetNode, "worksheet"), "sheetData")[0]
    : null;
  if (!sheetData) malformed("xlsx", "xml");
  const rowNodes = namedChildren(nodeChildren(sheetData, "sheetData"), "row");
  if (rowNodes.length > TABLE_SOURCE_LIMITS.rowsPerSection)
    throw new TableSourceError("table_limit_exceeded", "xlsx", "rows");
  const seen = new Set<string>();
  const headers = new Map<number, string>();
  const rows = rowNodes.map((rowNode) => {
    const rowNumber = Number(rowNode[":@"]?.r);
    if (
      !Number.isInteger(rowNumber) ||
      rowNumber < 1 ||
      rowNumber > TABLE_SOURCE_LIMITS.rowsPerSection
    )
      malformed("xlsx", "cell_reference");
    const cells = namedChildren(nodeChildren(rowNode, "row"), "c").map(
      (cellNode) => {
        const coordinate = cellNode[":@"]?.r ?? "";
        const position = spreadsheetColumn(coordinate);
        if (position.row !== rowNumber || seen.has(coordinate))
          malformed("xlsx", "cell_reference");
        seen.add(coordinate);
        const value = cellValue(cellNode, sharedStrings, dateStyles, date1904);
        if (rowNumber === 1) headers.set(position.column, value);
        return {
          column: position.column,
          coordinate,
          ...(rowNumber > 1 && headers.get(position.column)
            ? { header: headers.get(position.column) }
            : {}),
          value,
        };
      },
    );
    cells.sort((left, right) => left.column - right.column);
    return { number: rowNumber, cells };
  });
  rows.sort((left, right) => left.number - right.number);
  return { kind: "sheet", index, name, rows };
}

export function extractXlsxTables(
  bytes: Uint8Array,
  sourceId: string,
): {
  document: StructuredTableDocument;
  text: string;
  metadata: { sheetCount: number; visibleSheetCount: number };
} {
  const parts = readSafeZip(bytes, "xlsx", allowedXlsxPart);
  const contentTypes = decodeXml(parts.get("[content_types].xml"), "xlsx")!;
  if (
    /macroenabled|vba|oleobject|externalLink|application\/vnd\.openxmlformats-officedocument\.oleobject|application\/vnd\.openxmlformats-officedocument\.package/iu.test(
      contentTypes,
    )
  )
    malformed("xlsx", "macro_content");
  if (
    !contentTypes.includes(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    )
  )
    malformed("xlsx", "content_type");
  validateRelationships(parts, "xlsx");
  const workbookXml = decodeXml(parts.get("xl/workbook.xml"), "xlsx")!;
  const workbook = parseOrdered(workbookXml, "xlsx");
  const date1904Value = descendants(workbook, "workbookPr")[0]?.[":@"]
    ?.date1904;
  const date1904 = date1904Value === "1" || date1904Value === "true";
  const sheetsNode = descendants(workbook, "sheets")[0];
  if (!sheetsNode) malformed("xlsx", "xml");
  const sheets = namedChildren(nodeChildren(sheetsNode, "sheets"), "sheet");
  if (!sheets.length) malformed("xlsx", "no_sheets");
  if (sheets.length > TABLE_SOURCE_LIMITS.sheets)
    throw new TableSourceError("table_limit_exceeded", "xlsx", "sheets");

  const relationshipsXml = decodeXml(
    parts.get("xl/_rels/workbook.xml.rels"),
    "xlsx",
  )!;
  const relationships = parseOrdered(relationshipsXml, "xlsx");
  const targets = new Map<string, string>();
  for (const relationship of descendants(relationships, "Relationship")) {
    const attributes = relationship[":@"] ?? {};
    if ((attributes.Type ?? "").endsWith("/worksheet"))
      targets.set(
        attributes.Id ?? "",
        `xl/${attributes.Target ?? ""}`.toLocaleLowerCase("en-US"),
      );
  }
  const sharedStrings = sharedStringValues(
    decodeXml(parts.get("xl/sharedstrings.xml"), "xlsx", false),
  );
  const dateStyles = dateStyleIndexes(
    decodeXml(parts.get("xl/styles.xml"), "xlsx", false),
  );
  const visible = sheets.filter(
    (sheet) =>
      !["hidden", "veryHidden"].includes(sheet[":@"]?.state ?? "visible"),
  );
  const sections = visible.map((sheet, visibleIndex) => {
    const attributes = sheet[":@"] ?? {};
    const target = targets.get(attributes.id ?? "");
    if (!target || !allowedXlsxPart(target))
      malformed("xlsx", "sheet_relationship");
    const xml = decodeXml(parts.get(target), "xlsx")!;
    return worksheetSection(
      xml,
      visibleIndex + 1,
      attributes.name ?? `Sheet ${visibleIndex + 1}`,
      sharedStrings,
      dateStyles,
      date1904,
    );
  });
  if (!sections.length) malformed("xlsx", "no_visible_sheets");
  const document: StructuredTableDocument = {
    sourceId,
    format: "xlsx",
    sections,
  };
  return {
    document,
    text: serializeTableDocument(document),
    metadata: { sheetCount: sheets.length, visibleSheetCount: visible.length },
  };
}
