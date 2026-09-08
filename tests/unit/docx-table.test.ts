import { describe, expect, it } from "vitest";
import { extractDocxTables } from "../../app/lib/ooxml-table";
import {
  docxMainType,
  makeDocx,
  makeRawZip,
  setFirstCentralDeclaredSize,
  setZipFlags,
  wordCell,
  wordDocument,
  wordRow,
} from "../fixtures/ooxml";

const table = (rows: string[]) => `<w:tbl>${rows.join("")}</w:tbl>`;

describe("DOCX table extraction", () => {
  it("preserves table order, a deterministic heading, paragraphs, and merged-cell semantics", () => {
    const first = table([
      wordRow([
        wordCell(["Stage"], '<w:gridSpan w:val="2"/>'),
        wordCell(["Owner"]),
      ]),
      wordRow([
        wordCell(["Review", "Validate"], '<w:vMerge w:val="restart"/>'),
        wordCell(["Complete"]),
        wordCell(["Operations"]),
      ]),
      wordRow([
        wordCell([], "<w:vMerge/>"),
        wordCell(["Archive"]),
        wordCell(["Records"]),
      ]),
    ]);
    const second = table([
      wordRow([wordCell(["Handoff"]), wordCell(["Team B"])]),
    ]);
    const document = wordDocument(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Approval matrix</w:t></w:r></w:p>' +
        first +
        "<w:p><w:r><w:t>Ignored ordinary prose</w:t></w:r></w:p>" +
        second,
    );

    const extraction = extractDocxTables(makeDocx(document), "docx-source");

    expect(extraction.document.sections).toHaveLength(2);
    expect(extraction.document.sections.map((section) => section.name)).toEqual(
      ["Approval matrix", "Table 2"],
    );
    expect(extraction.text).toContain('"value":"Review\\nValidate"');
    expect(extraction.text).toContain('"columnSpan":2');
    expect(extraction.text).toContain('"rowSpan":2');
    expect(extraction.text).not.toContain("Ignored ordinary prose");
  });

  it("rejects a valid document with no tables", () => {
    expect(() =>
      extractDocxTables(
        makeDocx(wordDocument("<w:p><w:r><w:t>Prose only</w:t></w:r></w:p>")),
        "docx-empty",
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "table_malformed_file",
        category: "no_tables",
      }),
    );
  });

  it.each([
    ["traversal", { "../shadow.xml": "x" }, "archive_name"],
    ["absolute", { "/shadow.xml": "x" }, "archive_name"],
    ["backslash", { "word\\shadow.xml": "x" }, "archive_name"],
    [
      "duplicate canonical",
      { "word/a.xml": "x", "word/A.xml": "y" },
      "duplicate_entry",
    ],
    [
      "embedded object",
      { "word/embeddings/oleObject1.bin": "x" },
      "unexpected_part",
    ],
  ])("rejects %s archive content", (_, extra, category) => {
    expect(() =>
      extractDocxTables(
        makeDocx(table([wordRow([wordCell(["A"])])]), extra),
        "docx-attack",
      ),
    ).toThrowError(expect.objectContaining({ format: "docx", category }));
  });

  it("rejects encrypted and data-descriptor flags before inflation", () => {
    const valid = makeDocx(wordDocument(table([wordRow([wordCell(["A"])])])));
    for (const [flags, category] of [
      [0x0001, "encrypted"],
      [0x0008, "data_descriptor"],
    ] as const)
      expect(() =>
        extractDocxTables(setZipFlags(valid, flags), "docx-flags"),
      ).toThrowError(expect.objectContaining({ category }));
  });

  it.each([
    [
      "macro content type",
      {
        "[Content_Types].xml": `<?xml version="1.0"?><Types><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>`,
      },
      "macro_content",
    ],
    [
      "external relationship",
      {
        "word/_rels/document.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="r1" TargetMode="External" Target="https://invalid.example/resource"/></Relationships>`,
      },
      "external_relationship",
    ],
    [
      "DOCTYPE",
      {
        "word/document.xml": `<!DOCTYPE x [<!ENTITY e "unsafe">]>${wordDocument(table([wordRow([wordCell(["&e;"])])]))}`,
      },
      "xml_entities",
    ],
    ["malformed XML", { "word/document.xml": "<w:document>" }, "xml"],
  ])("rejects %s", (_, extra, category) => {
    expect(() =>
      extractDocxTables(
        makeDocx(wordDocument(table([wordRow([wordCell(["A"])])])), extra),
        "docx-xml",
      ),
    ).toThrowError(expect.objectContaining({ format: "docx", category }));
  });

  it("rejects archive entry count, declared size, compression ratio, and truncation", () => {
    const manyEntries = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [
        `word/item-${index}.xml`,
        "x",
      ]),
    );
    expect(() =>
      extractDocxTables(makeRawZip(manyEntries), "docx-count"),
    ).toThrowError(expect.objectContaining({ category: "archive_entries" }));

    const valid = makeDocx(wordDocument(table([wordRow([wordCell(["A"])])])));
    expect(() =>
      extractDocxTables(
        setFirstCentralDeclaredSize(valid, 1, 8_388_609),
        "docx-size",
      ),
    ).toThrowError(
      expect.objectContaining({ category: "entry_uncompressed_bytes" }),
    );

    expect(() =>
      extractDocxTables(
        makeDocx(wordDocument(table([wordRow([wordCell(["A"])])])), {
          "word/styles.xml": "A".repeat(200_000),
        }),
        "docx-ratio",
      ),
    ).toThrowError(expect.objectContaining({ category: "compression_ratio" }));

    expect(() =>
      extractDocxTables(valid.slice(0, -12), "docx-truncated"),
    ).toThrowError(expect.objectContaining({ category: "archive_directory" }));
  });

  it("accepts only the declared DOCX main content type", () => {
    const extraction = extractDocxTables(
      makeDocx(wordDocument(table([wordRow([wordCell([docxMainType])])]))),
      "docx-type",
    );
    expect(extraction.document.format).toBe("docx");
  });
});
