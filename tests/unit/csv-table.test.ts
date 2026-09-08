import { describe, expect, it } from "vitest";
import { parseCsvTable } from "../../app/lib/csv-table";
import { TableSourceError } from "../../app/lib/table-source";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("CSV structured extraction", () => {
  it.each([
    ["comma", "Step,Owner,Result\nReceive,Clerk,Open", "B2", "Owner"],
    ["semicolon", "Step;Owner;Result\r\nReview;Lead;Done", "B2", "Owner"],
    ["tab", "Step\tOwner\tResult\nArchive\tRecords\tClosed", "B2", "Owner"],
  ])(
    "detects %s and preserves coordinates and headers",
    (_, input, coordinate, header) => {
      const extraction = parseCsvTable(bytes(input), "csv-source");
      expect(extraction.document.format).toBe("csv");
      expect(extraction.document.sections).toHaveLength(1);
      expect(extraction.text).toContain("[source:csv-source]");
      expect(extraction.text).toContain(`"coordinate":"${coordinate}"`);
      expect(extraction.text).toContain(`"header":"${header}"`);
    },
  );

  it("supports UTF-8 BOM, quoted delimiters, escaped quotes, embedded newlines, and blanks", () => {
    const input =
      '\ufeffStep,Owner,Note,Optional\r\n"Review, verify","Ops ""A""","Line one\r\nLine two",\r\n,,,\r\nArchive,Records,,Done';
    const extraction = parseCsvTable(bytes(input), "csv-complex");

    expect(extraction.document.sections[0].rows).toHaveLength(4);
    expect(extraction.text).toContain('"value":"Review, verify"');
    expect(extraction.text).toContain('"value":"Ops \\"A\\""');
    expect(extraction.text).toContain('"value":"Line one\\nLine two"');
    expect(extraction.text).toContain('"row":3,"cells":[{"coordinate":"A3"');
    expect(extraction.text).toContain('"coordinate":"D4"');
  });

  it.each([
    ['Step,Owner\n"unterminated,Lead', "csv_quoting"],
    ['Step,Owner\nRe"view,Lead', "csv_quoting"],
    ['Step,Owner\n"Review"tail,Lead', "csv_quoting"],
  ])(
    "rejects malformed quoting without reflecting cells",
    (input, category) => {
      expect(() => parseCsvTable(bytes(input), "csv-bad")).toThrowError(
        expect.objectContaining({
          code: "table_malformed_file",
          format: "csv",
          category,
        }),
      );
      try {
        parseCsvTable(bytes(input), "csv-bad");
      } catch (error) {
        expect(JSON.stringify(error)).not.toContain("unterminated");
        expect(error).toBeInstanceOf(TableSourceError);
      }
    },
  );

  it("rejects non-UTF-8 bytes deterministically", () => {
    expect(() =>
      parseCsvTable(Uint8Array.from([0x53, 0x2c, 0xff]), "csv-encoding"),
    ).toThrowError(
      expect.objectContaining({
        code: "table_malformed_file",
        category: "encoding",
      }),
    );
  });

  it.each([
    ["file_bytes", new Uint8Array(2_097_153)],
    [
      "rows",
      bytes(
        `Header\n${Array.from({ length: 1_000 }, () => "value").join("\n")}`,
      ),
    ],
    [
      "columns",
      bytes(Array.from({ length: 65 }, (_, index) => `C${index}`).join(",")),
    ],
    ["cell_characters", bytes(`Header\n${"x".repeat(2_001)}`)],
    [
      "total_cells",
      bytes(
        Array.from({ length: 313 }, () =>
          Array.from({ length: 64 }, () => "x").join(","),
        ).join("\n") +
          "\n" +
          Array.from({ length: 33 }, () => "x").join(","),
      ),
    ],
    [
      "extracted_characters",
      bytes(
        Array.from({ length: 101 }, () =>
          Array.from({ length: 64 }, () => "x".repeat(31)).join(","),
        ).join("\n"),
      ),
    ],
  ])("rejects the %s limit", (category, input) => {
    expect(() => parseCsvTable(input, "csv-limit")).toThrowError(
      expect.objectContaining({
        code: "table_limit_exceeded",
        format: "csv",
        category,
      }),
    );
  });

  it("accepts shorter sparse rows but rejects a pathological wider row", () => {
    expect(() =>
      parseCsvTable(bytes("A,B,C\n1,,\n2"), "csv-sparse"),
    ).not.toThrow();
    expect(() => parseCsvTable(bytes("A,B\n1,2,3"), "csv-wide")).toThrowError(
      expect.objectContaining({
        code: "table_malformed_file",
        category: "inconsistent_columns",
      }),
    );
  });
});
