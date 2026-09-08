import { describe, expect, it } from "vitest";
import { extractXlsxTables } from "../../app/lib/ooxml-table";
import { makeXlsx, setZipFlags } from "../fixtures/ooxml";

const worksheet = (rows: string) =>
  `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
const row = (number: number, cells: string) =>
  `<row r="${number}">${cells}</row>`;

describe("XLSX structured extraction", () => {
  it("preserves visible workbook order/names, shared and inline strings, typed values, sparse coordinates, and dates", () => {
    const shared = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Stage</t></si><si><r><t>Ow</t></r><r><t>ner</t></r></si></sst>`;
    const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;
    const first = worksheet(
      row(
        1,
        '<c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Result</t></is></c>',
      ) +
        row(
          3,
          '<c r="A3" t="s"><v>1</v></c><c r="B3"><v>17.50</v></c><c r="C3" t="b"><v>1</v></c><c r="D3" s="1"><v>45292</v></c><c r="E3" t="e"><v>#VALUE!</v></c>',
        ),
    );
    const hidden = worksheet(
      row(1, '<c r="A1" t="inlineStr"><is><t>Hidden value</t></is></c>'),
    );
    const second = worksheet(
      row(1, '<c r="A1" t="inlineStr"><is><t>Handoff</t></is></c>'),
    );
    const extraction = extractXlsxTables(
      makeXlsx({
        sheets: [
          { name: "Intake", xml: first },
          { name: "Private helper", xml: hidden, state: "hidden" },
          { name: "Handoffs", xml: second },
        ],
        sharedStrings: shared,
        styles,
      }),
      "xlsx-source",
    );

    expect(extraction.document.sections.map((section) => section.name)).toEqual(
      ["Intake", "Handoffs"],
    );
    expect(extraction.metadata).toEqual({
      sheetCount: 3,
      visibleSheetCount: 2,
    });
    expect(extraction.text).toContain('"coordinate":"C3"');
    expect(extraction.text).toContain('"value":"Owner"');
    expect(extraction.text).toContain('"value":"17.50"');
    expect(extraction.text).toContain('"value":"true"');
    expect(extraction.text).toContain('"value":"2024-01-01"');
    expect(extraction.text).toContain('"value":"#ERROR:VALUE"');
    expect(extraction.text).not.toContain("Hidden value");
  });

  it("uses a cached formula value and otherwise records formula presence without formula text", () => {
    const xml = worksheet(
      row(
        1,
        '<c r="A1"><f>PRIVATE(A9)</f><v>42</v></c><c r="B1"><f>LEAK(B9)</f></c>',
      ),
    );
    const extraction = extractXlsxTables(
      makeXlsx({ sheets: [{ name: "Calculations", xml }] }),
      "xlsx-formula",
    );
    expect(extraction.text).toContain('"value":"42"');
    expect(extraction.text).toContain(
      '"value":"[formula:cached-value-unavailable]"',
    );
    expect(extraction.text).not.toMatch(/PRIVATE|LEAK|A9|B9/u);
  });

  it.each(["1", "true"] as const)(
    "uses the 1904 date epoch for workbookPr date1904=%s without changing numeric cells",
    (date1904) => {
      const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`;
      const xml = worksheet(
        row(1, '<c r="A1" s="1"><v>45292</v></c><c r="B1"><v>45292</v></c>'),
      );
      const defaultEpoch = extractXlsxTables(
        makeXlsx({ sheets: [{ name: "Dates", xml }], styles }),
        `xlsx-1900-${date1904}`,
      );
      const epoch1904 = extractXlsxTables(
        makeXlsx({
          sheets: [{ name: "Dates", xml }],
          styles,
          date1904,
        }),
        `xlsx-1904-${date1904}`,
      );

      expect(defaultEpoch.document.sections[0].rows[0].cells).toMatchObject([
        { coordinate: "A1", value: "2024-01-01" },
        { coordinate: "B1", value: "45292" },
      ]);
      expect(epoch1904.document.sections[0].rows[0].cells).toMatchObject([
        { coordinate: "A1", value: "2028-01-02" },
        { coordinate: "B1", value: "45292" },
      ]);
      expect(Date.parse("2028-01-02") - Date.parse("2024-01-01")).toBe(
        1_462 * 86_400_000,
      );
    },
  );

  it.each([
    [
      "bad row",
      worksheet('<row r="0"><c r="A0"><v>1</v></c></row>'),
      "cell_reference",
    ],
    [
      "bad coordinate",
      worksheet(row(1, '<c r="1A"><v>1</v></c>')),
      "cell_reference",
    ],
    [
      "duplicate coordinate",
      worksheet(row(1, '<c r="A1"><v>1</v></c><c r="A1"><v>2</v></c>')),
      "cell_reference",
    ],
    [
      "too-wide coordinate",
      worksheet(row(1, '<c r="BM1"><v>1</v></c>')),
      "columns",
    ],
    ["malformed XML", "<worksheet>", "xml"],
  ])("rejects %s", (_, xml, category) => {
    expect(() =>
      extractXlsxTables(
        makeXlsx({ sheets: [{ name: "Sheet", xml }] }),
        "xlsx-bad",
      ),
    ).toThrowError(expect.objectContaining({ format: "xlsx", category }));
  });

  it("rejects macro content, external links, encryption, traversal, and archive limits", () => {
    const valid = makeXlsx({
      sheets: [
        { name: "Sheet", xml: worksheet(row(1, '<c r="A1"><v>1</v></c>')) },
      ],
    });
    expect(() =>
      extractXlsxTables(setZipFlags(valid, 1), "xlsx-encrypted"),
    ).toThrowError(expect.objectContaining({ category: "encrypted" }));

    expect(() =>
      extractXlsxTables(
        makeXlsx({
          sheets: [
            { name: "Sheet", xml: worksheet(row(1, '<c r="A1"><v>1</v></c>')) },
          ],
          extra: { "../shadow.xml": "x" },
        }),
        "xlsx-traversal",
      ),
    ).toThrowError(expect.objectContaining({ category: "archive_name" }));

    expect(() =>
      extractXlsxTables(
        makeXlsx({
          sheets: [
            { name: "Sheet", xml: worksheet(row(1, '<c r="A1"><v>1</v></c>')) },
          ],
          extra: {
            "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="external" TargetMode="External" Target="https://invalid.example/book.xlsx"/></Relationships>`,
          },
        }),
        "xlsx-external",
      ),
    ).toThrowError(
      expect.objectContaining({ category: "external_relationship" }),
    );

    expect(() =>
      extractXlsxTables(
        makeXlsx({
          sheets: [
            { name: "Sheet", xml: worksheet(row(1, '<c r="A1"><v>1</v></c>')) },
          ],
          extra: {
            "[Content_Types].xml": `<?xml version="1.0"?><Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>`,
          },
        }),
        "xlsx-macro",
      ),
    ).toThrowError(expect.objectContaining({ category: "macro_content" }));
  });

  it("rejects malformed shared-string indexes and sheet relationship references", () => {
    expect(() =>
      extractXlsxTables(
        makeXlsx({
          sheets: [
            {
              name: "Sheet",
              xml: worksheet(row(1, '<c r="A1" t="s"><v>9</v></c>')),
            },
          ],
          sharedStrings: `<?xml version="1.0"?><sst><si><t>Only</t></si></sst>`,
        }),
        "xlsx-shared",
      ),
    ).toThrowError(expect.objectContaining({ category: "shared_string" }));

    const bytes = makeXlsx({
      sheets: [
        { name: "Sheet", xml: worksheet(row(1, '<c r="A1"><v>1</v></c>')) },
      ],
      extra: {
        "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Sheet" sheetId="1" r:id="missing"/></sheets></workbook>`,
      },
    });
    expect(() => extractXlsxTables(bytes, "xlsx-rel")).toThrowError(
      expect.objectContaining({ category: "sheet_relationship" }),
    );
  });
});
