import { describe, expect, it } from "vitest";
import { extractDocxTables } from "../../app/lib/ooxml-table";
import {
  expandFirstEntryDeclaredRange,
  makeDocx,
  setAllCentralDeclaredSizes,
  setFirstCentralDeclaredSize,
  setFirstCompressionMethod,
  setFirstLocalOffset,
  setZip64EntrySentinel,
  wordCell,
  wordDocument,
  wordRow,
} from "../fixtures/ooxml";

const validDocx = () =>
  makeDocx(wordDocument(`<w:tbl>${wordRow([wordCell(["Stage"])])}</w:tbl>`));

describe("OOXML archive pre-inflation security", () => {
  it.each([
    [
      "unsupported compression",
      () => setFirstCompressionMethod(validDocx(), 12),
      "compression_method",
    ],
    [
      "ZIP64 sentinel",
      () => setZip64EntrySentinel(validDocx()),
      "zip64_or_multidisk",
    ],
    [
      "out-of-bounds local offset",
      () => setFirstLocalOffset(validDocx(), validDocx().byteLength + 10),
      "local_header",
    ],
    [
      "local/central size mismatch",
      () => setFirstCentralDeclaredSize(validDocx(), 2, 2),
      "local_header",
    ],
    [
      "overlapping entry ranges",
      () => expandFirstEntryDeclaredRange(validDocx(), 80),
      "entry_overlap",
    ],
    [
      "per-entry compressed bytes",
      () => setFirstCentralDeclaredSize(validDocx(), 8_388_609, 8_388_609),
      "entry_compressed_bytes",
    ],
    [
      "total declared bytes",
      () => setAllCentralDeclaredSizes(validDocx(), 6_000_000, 6_000_000),
      "archive_uncompressed_bytes",
    ],
  ])("rejects %s", (_, fixture, category) => {
    expect(() => extractDocxTables(fixture(), "archive-security")).toThrowError(
      expect.objectContaining({ format: "docx", category }),
    );
  });

  it("rejects XML deeper than the explicit bound", () => {
    const nested = `${"<w:sdt>".repeat(65)}${"</w:sdt>".repeat(65)}`;
    expect(() =>
      extractDocxTables(makeDocx(wordDocument(nested)), "xml-depth"),
    ).toThrowError(expect.objectContaining({ category: "xml_depth" }));
  });

  it("rejects relationship types outside the OOXML allowlist", () => {
    expect(() =>
      extractDocxTables(
        makeDocx(
          wordDocument(`<w:tbl>${wordRow([wordCell(["Stage"])])}</w:tbl>`),
          {
            "word/_rels/document.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="r1" Type="urn:synthetic:unexpected" Target="styles.xml"/></Relationships>`,
          },
        ),
        "relationship-type",
      ),
    ).toThrowError(expect.objectContaining({ category: "relationship_type" }));
  });
});
