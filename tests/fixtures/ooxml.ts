import { strToU8, zipSync } from "fflate";

const contentTypes = (mainType: string) => `<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="${mainType}"/>
</Types>`;

const packageRelationships = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

export const docxMainType =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";

export function makeDocx(
  documentXml: string,
  extra: Record<string, string | Uint8Array> = {},
): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries({
        "[Content_Types].xml": contentTypes(docxMainType),
        "_rels/.rels": packageRelationships,
        "word/document.xml": documentXml,
        ...extra,
      }).map(([name, value]) => [
        name,
        typeof value === "string" ? strToU8(value) : value,
      ]),
    ),
    { level: 6 },
  );
}

export function makeRawZip(
  entries: Record<string, string | Uint8Array>,
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 = 6,
): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, value]) => [
        name,
        typeof value === "string" ? strToU8(value) : value,
      ]),
    ),
    { level },
  );
}

export function setZipFlags(input: Uint8Array, flags: number): Uint8Array {
  const output = input.slice();
  const view = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  for (let offset = 0; offset <= output.length - 4; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) view.setUint16(offset + 6, flags, true);
    if (signature === 0x02014b50) view.setUint16(offset + 8, flags, true);
  }
  return output;
}

export function setFirstCentralDeclaredSize(
  input: Uint8Array,
  compressed: number,
  uncompressed: number,
): Uint8Array {
  const output = input.slice();
  const view = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  for (let offset = 0; offset <= output.length - 4; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      view.setUint32(offset + 20, compressed, true);
      view.setUint32(offset + 24, uncompressed, true);
      return output;
    }
  }
  throw new Error("Synthetic ZIP has no central entry.");
}

export function setFirstDeclaredUncompressedSize(
  input: Uint8Array,
  uncompressed: number,
): Uint8Array {
  let localDone = false;
  let centralDone = false;
  return eachZipHeader(input, (view, offset, kind) => {
    if (kind === "local" && !localDone) {
      view.setUint32(offset + 22, uncompressed, true);
      localDone = true;
    }
    if (kind === "central" && !centralDone) {
      view.setUint32(offset + 24, uncompressed, true);
      centralDone = true;
    }
  });
}

export function setFirstDeclaredCrc(
  input: Uint8Array,
  crc32: number,
): Uint8Array {
  let localDone = false;
  let centralDone = false;
  return eachZipHeader(input, (view, offset, kind) => {
    if (kind === "local" && !localDone) {
      view.setUint32(offset + 14, crc32, true);
      localDone = true;
    }
    if (kind === "central" && !centralDone) {
      view.setUint32(offset + 16, crc32, true);
      centralDone = true;
    }
  });
}

function eachZipHeader(
  input: Uint8Array,
  callback: (
    view: DataView,
    offset: number,
    kind: "local" | "central" | "end",
  ) => void,
): Uint8Array {
  const output = input.slice();
  const view = new DataView(
    output.buffer,
    output.byteOffset,
    output.byteLength,
  );
  for (let offset = 0; offset <= output.length - 4; offset += 1) {
    const value = view.getUint32(offset, true);
    if (value === 0x04034b50) callback(view, offset, "local");
    if (value === 0x02014b50) callback(view, offset, "central");
    if (value === 0x06054b50) callback(view, offset, "end");
  }
  return output;
}

export function setFirstCompressionMethod(
  input: Uint8Array,
  method: number,
): Uint8Array {
  let localDone = false;
  let centralDone = false;
  return eachZipHeader(input, (view, offset, kind) => {
    if (kind === "local" && !localDone) {
      view.setUint16(offset + 8, method, true);
      localDone = true;
    }
    if (kind === "central" && !centralDone) {
      view.setUint16(offset + 10, method, true);
      centralDone = true;
    }
  });
}

export function setZip64EntrySentinel(input: Uint8Array): Uint8Array {
  return eachZipHeader(input, (view, offset, kind) => {
    if (kind === "end") {
      view.setUint16(offset + 8, 0xffff, true);
      view.setUint16(offset + 10, 0xffff, true);
    }
  });
}

export function setFirstLocalOffset(
  input: Uint8Array,
  localOffset: number,
): Uint8Array {
  let done = false;
  return eachZipHeader(input, (view, offset, kind) => {
    if (kind === "central" && !done) {
      view.setUint32(offset + 42, localOffset, true);
      done = true;
    }
  });
}

export function expandFirstEntryDeclaredRange(
  input: Uint8Array,
  addedBytes: number,
): Uint8Array {
  let localDone = false;
  let centralDone = false;
  return eachZipHeader(input, (view, offset, kind) => {
    if (kind === "local" && !localDone) {
      const size = view.getUint32(offset + 18, true) + addedBytes;
      view.setUint32(offset + 18, size, true);
      view.setUint32(offset + 22, size, true);
      localDone = true;
    }
    if (kind === "central" && !centralDone) {
      const size = view.getUint32(offset + 20, true) + addedBytes;
      view.setUint32(offset + 20, size, true);
      view.setUint32(offset + 24, size, true);
      centralDone = true;
    }
  });
}

export function setAllCentralDeclaredSizes(
  input: Uint8Array,
  compressed: number,
  uncompressed: number,
): Uint8Array {
  return eachZipHeader(input, (view, offset, kind) => {
    if (kind === "central") {
      view.setUint32(offset + 20, compressed, true);
      view.setUint32(offset + 24, uncompressed, true);
    }
  });
}

export function wordDocument(body: string) {
  return `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;
}

export function wordCell(paragraphs: string[], properties = ""): string {
  return `<w:tc><w:tcPr>${properties}</w:tcPr>${paragraphs
    .map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`)
    .join("")}</w:tc>`;
}

export function wordRow(cells: string[]) {
  return `<w:tr>${cells.join("")}</w:tr>`;
}

export const xlsxMainType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

export function makeXlsx(input: {
  sheets: Array<{
    name: string;
    xml: string;
    state?: "visible" | "hidden" | "veryHidden";
  }>;
  sharedStrings?: string;
  styles?: string;
  date1904?: "1" | "true";
  extra?: Record<string, string | Uint8Array>;
}): Uint8Array {
  const overrides = input.sheets
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");
  const types = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${xlsxMainType}"/>${overrides}</Types>`;
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${input.date1904 ? `<workbookPr date1904="${input.date1904}"/>` : ""}<sheets>${input.sheets
    .map(
      (sheet, index) =>
        `<sheet name="${sheet.name}" sheetId="${index + 1}"${sheet.state && sheet.state !== "visible" ? ` state="${sheet.state}"` : ""} r:id="rId${index + 1}"/>`,
    )
    .join("")}</sheets></workbook>`;
  const workbookRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${input.sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join("")}${
    input.sharedStrings
      ? '<Relationship Id="rIdShared" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
      : ""
  }${input.styles ? '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' : ""}</Relationships>`;
  return makeRawZip({
    "[Content_Types].xml": types,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": workbook,
    "xl/_rels/workbook.xml.rels": workbookRels,
    ...Object.fromEntries(
      input.sheets.map((sheet, index) => [
        `xl/worksheets/sheet${index + 1}.xml`,
        sheet.xml,
      ]),
    ),
    ...(input.sharedStrings
      ? { "xl/sharedStrings.xml": input.sharedStrings }
      : {}),
    ...(input.styles ? { "xl/styles.xml": input.styles } : {}),
    ...(input.extra ?? {}),
  });
}
