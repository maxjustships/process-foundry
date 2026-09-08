import { describe, expect, it } from "vitest";
import {
  TABLE_SOURCE_LIMITS,
  TableSourceError,
  assertSafeArchiveName,
  serializeTableDocument,
} from "../../app/lib/table-source";

describe("structured table-source contract", () => {
  it("pins explicit raw, archive, XML, and extracted-data limits", () => {
    expect(TABLE_SOURCE_LIMITS).toEqual({
      rawBytes: { csv: 2_097_152, docx: 8_388_608, xlsx: 10_485_760 },
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
    });
  });

  it("serializes stable source, section, row, coordinate, header, and merge structure", () => {
    const document = {
      sourceId: "source-synthetic-1",
      format: "docx" as const,
      sections: [
        {
          kind: "table" as const,
          index: 1,
          name: "Approval matrix",
          rows: [
            {
              number: 1,
              cells: [
                {
                  column: 1,
                  coordinate: "A1",
                  value: "Role",
                  columnSpan: 2,
                  rowSpan: 1,
                },
              ],
            },
            {
              number: 2,
              cells: [
                {
                  column: 1,
                  coordinate: "A2",
                  header: "Role",
                  value: "Reviewer\nBackup",
                  columnSpan: 1,
                  rowSpan: 1,
                },
                {
                  column: 2,
                  coordinate: "B2",
                  header: "Role",
                  value: "Complete",
                  columnSpan: 1,
                  rowSpan: 1,
                },
              ],
            },
          ],
        },
      ],
    };

    const first = serializeTableDocument(document);
    expect(first).toBe(serializeTableDocument(structuredClone(document)));
    expect(first).toBe(
      "[source:source-synthetic-1]\n" +
        '{"format":"docx","sectionKind":"table","sectionIndex":1,"sectionName":"Approval matrix"}\n' +
        '{"row":1,"cells":[{"coordinate":"A1","column":"A","value":"Role","columnSpan":2,"rowSpan":1}]}\n' +
        '{"row":2,"cells":[{"coordinate":"A2","column":"A","header":"Role","value":"Reviewer\\nBackup","columnSpan":1,"rowSpan":1},{"coordinate":"B2","column":"B","header":"Role","value":"Complete","columnSpan":1,"rowSpan":1}]}',
    );
  });

  it.each([
    "../document.xml",
    "/word/document.xml",
    "C:/word/document.xml",
    "word\\document.xml",
    "word/../document.xml",
    "word/document.xml\0shadow",
    "word//document.xml",
  ])("rejects unsafe archive name without echoing it: %s", (name) => {
    let error: unknown;
    try {
      assertSafeArchiveName(name, "docx");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TableSourceError);
    expect(error).toMatchObject({
      code: "table_unsafe_archive",
      format: "docx",
      category: "archive_name",
    });
    expect(JSON.stringify(error)).not.toContain(name);
  });

  it("keeps safe errors free of private content and implementation details", () => {
    const error = new TableSourceError(
      "table_limit_exceeded",
      "xlsx",
      "cell_characters",
    );
    expect(error.message).toBe("table_limit_exceeded:xlsx:cell_characters");
    expect(JSON.stringify(error)).toBe(
      '{"code":"table_limit_exceeded","format":"xlsx","category":"cell_characters","name":"TableSourceError"}',
    );
    expect(JSON.stringify(error)).not.toMatch(
      /sensitive|formula|archive|\.xml|\/home\//u,
    );
  });
});
