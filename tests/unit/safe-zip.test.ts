import { describe, expect, it } from "vitest";
import { readSafeZip } from "../../app/lib/safe-zip";
import { TABLE_SOURCE_LIMITS } from "../../app/lib/table-source";
import {
  makeDocx,
  makeRawZip,
  makeXlsx,
  setFirstDeclaredCrc,
  setFirstDeclaredUncompressedSize,
  wordDocument,
} from "../fixtures/ooxml";

const readSingle = (bytes: Uint8Array) =>
  readSafeZip(bytes, "xlsx", (name) => name === "xl/workbook.xml");

function firstCompressedSize(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1)
    if (view.getUint32(offset, true) === 0x02014b50)
      return view.getUint32(offset + 20, true);
  throw new Error("Synthetic ZIP has no central entry.");
}

function moderatelyCompressibleBytes(length: number): Uint8Array {
  const result = new Uint8Array(length);
  let state = 0x12345678;
  for (let offset = 0; offset < length; offset += 2) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const value = state & 0xff;
    result[offset] = value;
    if (offset + 1 < length) result[offset + 1] = value;
  }
  return result;
}

describe("bounded safe ZIP extraction", () => {
  it("rejects a deflate entry whose actual output exceeds its forged declaration", () => {
    const archive = makeRawZip({
      "xl/workbook.xml": moderatelyCompressibleBytes(32_768),
    });
    const forged = setFirstDeclaredUncompressedSize(archive, 24_000);

    expect(() => readSingle(forged)).toThrowError(
      expect.objectContaining({
        code: "table_unsafe_archive",
        category: "archive_inflate",
      }),
    );
  });

  it("rejects a deflate entry with a corrupted declared CRC", () => {
    const archive = makeRawZip({ "xl/workbook.xml": "valid deflate data" });

    expect(() => readSingle(setFirstDeclaredCrc(archive, 0))).toThrowError(
      expect.objectContaining({ category: "archive_crc" }),
    );
  });

  it("rejects actual deflate expansion beyond the compression-ratio limit", () => {
    const archive = makeRawZip({
      "xl/workbook.xml": "A".repeat(200_000),
    });
    const forged = setFirstDeclaredUncompressedSize(
      archive,
      firstCompressedSize(archive) *
        TABLE_SOURCE_LIMITS.archiveCompressionRatio,
    );

    expect(() => readSingle(forged)).toThrowError(
      expect.objectContaining({
        code: "table_limit_exceeded",
        category: "compression_ratio",
      }),
    );
  });

  it("rejects actual deflate output beyond the per-entry size limit", () => {
    const actualBytes = TABLE_SOURCE_LIMITS.archiveEntryUncompressedBytes + 1;
    const archive = makeRawZip({
      "xl/workbook.xml": moderatelyCompressibleBytes(actualBytes),
    });
    const forged = setFirstDeclaredUncompressedSize(
      archive,
      TABLE_SOURCE_LIMITS.archiveEntryUncompressedBytes,
    );

    expect(() => readSingle(forged)).toThrowError(
      expect.objectContaining({
        code: "table_limit_exceeded",
        category: "entry_uncompressed_bytes",
      }),
    );
  });

  it("rejects a stored entry with a mismatched CRC", () => {
    const archive = makeRawZip({ "xl/workbook.xml": "valid stored data" }, 0);

    expect(() => readSingle(setFirstDeclaredCrc(archive, 0))).toThrowError(
      expect.objectContaining({ category: "archive_crc" }),
    );
  });

  it("extracts valid stored and deflate entries", () => {
    for (const level of [0, 6] as const) {
      const archive = makeRawZip(
        { "xl/workbook.xml": "valid office package part" },
        level,
      );
      expect(
        new TextDecoder().decode(readSingle(archive).get("xl/workbook.xml")),
      ).toBe("valid office package part");
    }
  });

  it("keeps valid DOCX and XLSX package parts extractable", () => {
    const docx = readSafeZip(
      makeDocx(wordDocument("<w:tbl/>")),
      "docx",
      () => true,
    );
    const xlsx = readSafeZip(
      makeXlsx({
        sheets: [
          {
            name: "Sheet",
            xml: '<?xml version="1.0"?><worksheet><sheetData/></worksheet>',
          },
        ],
      }),
      "xlsx",
      () => true,
    );

    expect(docx.has("word/document.xml")).toBe(true);
    expect(xlsx.has("xl/workbook.xml")).toBe(true);
    expect(xlsx.has("xl/worksheets/sheet1.xml")).toBe(true);
  });
});
