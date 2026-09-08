import { Inflate } from "fflate";
import {
  TABLE_SOURCE_LIMITS,
  TableSourceError,
  assertSafeArchiveName,
  type TableSourceFormat,
} from "./table-source";

type OfficeFormat = Exclude<TableSourceFormat, "csv">;

type CentralEntry = {
  name: string;
  canonicalName: string;
  flags: number;
  method: number;
  crc32: number;
  compressedBytes: number;
  uncompressedBytes: number;
  localOffset: number;
  payloadOffset: number;
};

const inflateInputChunkBytes = 1_024;

const crc32Table = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value & 1 ? 0xedb88320 : 0) ^ (value >>> 1);
    table[index] = value;
  }
  return table;
})();

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let value = crc;
  for (const byte of bytes)
    value = crc32Table[(value & 0xff) ^ byte] ^ (value >>> 8);
  return value;
}

function finishCrc32(crc: number): number {
  return ~crc >>> 0;
}

const signature = {
  local: 0x04034b50,
  central: 0x02014b50,
  end: 0x06054b50,
} as const;

function unsafe(format: OfficeFormat, category: string): never {
  throw new TableSourceError("table_unsafe_archive", format, category);
}

function exceeded(format: OfficeFormat, category: string): never {
  throw new TableSourceError("table_limit_exceeded", format, category);
}

function requireRange(
  bytes: Uint8Array,
  offset: number,
  length: number,
  format: OfficeFormat,
  category = "archive_directory",
): void {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > bytes.byteLength
  )
    unsafe(format, category);
}

function hasZip64Extra(bytes: Uint8Array, offset: number, length: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = offset + length;
  let cursor = offset;
  while (cursor < end) {
    if (cursor + 4 > end) return true;
    const id = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (cursor + size > end || id === 0x0001) return true;
    cursor += size;
  }
  return false;
}

function decodeName(
  bytes: Uint8Array,
  flags: number,
  format: OfficeFormat,
): string {
  if (!(flags & 0x0800) && bytes.some((byte) => byte > 0x7f))
    unsafe(format, "archive_name_encoding");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    unsafe(format, "archive_name_encoding");
  }
}

export function readSafeZip(
  bytes: Uint8Array,
  format: OfficeFormat,
  isAllowedPart: (canonicalName: string) => boolean,
): Map<string, Uint8Array> {
  if (bytes.byteLength > TABLE_SOURCE_LIMITS.rawBytes[format])
    exceeded(format, "file_bytes");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let endOffset = -1;
  const minimumOffset = Math.max(0, bytes.byteLength - 65_557);
  for (
    let offset = bytes.byteLength - 22;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === signature.end) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) unsafe(format, "archive_directory");
  requireRange(bytes, endOffset, 22, format);
  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const entriesCount = view.getUint16(endOffset + 10, true);
  const centralBytes = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const commentBytes = view.getUint16(endOffset + 20, true);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entriesCount ||
    entriesCount === 0xffff ||
    centralBytes === 0xffffffff ||
    centralOffset === 0xffffffff ||
    endOffset + 22 + commentBytes !== bytes.byteLength ||
    centralOffset + centralBytes !== endOffset
  )
    unsafe(format, "zip64_or_multidisk");
  if (entriesCount > TABLE_SOURCE_LIMITS.archiveEntries)
    exceeded(format, "archive_entries");

  const entries: CentralEntry[] = [];
  const names = new Set<string>();
  let totalUncompressed = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entriesCount; index += 1) {
    requireRange(bytes, cursor, 46, format);
    if (view.getUint32(cursor, true) !== signature.central)
      unsafe(format, "archive_directory");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const uncompressedBytes = view.getUint32(cursor + 24, true);
    const nameBytes = view.getUint16(cursor + 28, true);
    const extraBytes = view.getUint16(cursor + 30, true);
    const entryCommentBytes = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const recordBytes = 46 + nameBytes + extraBytes + entryCommentBytes;
    requireRange(bytes, cursor, recordBytes, format);
    if (flags & 0x0001) unsafe(format, "encrypted");
    if (flags & 0x0008) unsafe(format, "data_descriptor");
    if (method !== 0 && method !== 8) unsafe(format, "compression_method");
    if (diskStart !== 0 || localOffset === 0xffffffff)
      unsafe(format, "zip64_or_multidisk");
    if (compressedBytes > TABLE_SOURCE_LIMITS.archiveEntryCompressedBytes)
      exceeded(format, "entry_compressed_bytes");
    if (uncompressedBytes > TABLE_SOURCE_LIMITS.archiveEntryUncompressedBytes)
      exceeded(format, "entry_uncompressed_bytes");
    if (
      uncompressedBytes > 0 &&
      (compressedBytes === 0 ||
        uncompressedBytes / compressedBytes >
          TABLE_SOURCE_LIMITS.archiveCompressionRatio)
    )
      exceeded(format, "compression_ratio");
    totalUncompressed += uncompressedBytes;
    if (totalUncompressed > TABLE_SOURCE_LIMITS.archiveTotalUncompressedBytes)
      exceeded(format, "archive_uncompressed_bytes");
    if (hasZip64Extra(bytes, cursor + 46 + nameBytes, extraBytes))
      unsafe(format, "zip64_or_multidisk");
    const name = decodeName(
      bytes.subarray(cursor + 46, cursor + 46 + nameBytes),
      flags,
      format,
    );
    const canonicalName = assertSafeArchiveName(name, format);
    if (names.has(canonicalName)) unsafe(format, "duplicate_entry");
    names.add(canonicalName);
    entries.push({
      name,
      canonicalName,
      flags,
      method,
      crc32,
      compressedBytes,
      uncompressedBytes,
      localOffset,
      payloadOffset: -1,
    });
    cursor += recordBytes;
  }
  if (cursor !== endOffset) unsafe(format, "archive_directory");
  if (entries.some((entry) => !isAllowedPart(entry.canonicalName)))
    unsafe(format, "unexpected_part");

  const occupied: Array<{ start: number; end: number }> = [];
  for (const entry of entries) {
    requireRange(bytes, entry.localOffset, 30, format, "local_header");
    if (view.getUint32(entry.localOffset, true) !== signature.local)
      unsafe(format, "local_header");
    const localFlags = view.getUint16(entry.localOffset + 6, true);
    const localMethod = view.getUint16(entry.localOffset + 8, true);
    const localCrc = view.getUint32(entry.localOffset + 14, true);
    const localCompressed = view.getUint32(entry.localOffset + 18, true);
    const localUncompressed = view.getUint32(entry.localOffset + 22, true);
    const nameBytes = view.getUint16(entry.localOffset + 26, true);
    const extraBytes = view.getUint16(entry.localOffset + 28, true);
    requireRange(
      bytes,
      entry.localOffset,
      30 + nameBytes + extraBytes + entry.compressedBytes,
      format,
      "local_header",
    );
    const localName = decodeName(
      bytes.subarray(
        entry.localOffset + 30,
        entry.localOffset + 30 + nameBytes,
      ),
      localFlags,
      format,
    );
    if (
      localFlags !== entry.flags ||
      localMethod !== entry.method ||
      localCrc !== entry.crc32 ||
      localCompressed !== entry.compressedBytes ||
      localUncompressed !== entry.uncompressedBytes ||
      localName !== entry.name ||
      hasZip64Extra(bytes, entry.localOffset + 30 + nameBytes, extraBytes)
    )
      unsafe(format, "local_header");
    const end =
      entry.localOffset + 30 + nameBytes + extraBytes + entry.compressedBytes;
    if (end > centralOffset) unsafe(format, "entry_bounds");
    entry.payloadOffset = entry.localOffset + 30 + nameBytes + extraBytes;
    occupied.push({ start: entry.localOffset, end });
  }
  occupied.sort((left, right) => left.start - right.start);
  for (let index = 1; index < occupied.length; index += 1)
    if (occupied[index].start < occupied[index - 1].end)
      unsafe(format, "entry_overlap");

  const result = new Map<string, Uint8Array>();
  let actualArchiveBytes = 0;
  for (const entry of entries) {
    const payload = bytes.subarray(
      entry.payloadOffset,
      entry.payloadOffset + entry.compressedBytes,
    );
    if (entry.method === 0) {
      const actualBytes = payload.byteLength;
      if (actualBytes > TABLE_SOURCE_LIMITS.archiveEntryUncompressedBytes)
        exceeded(format, "entry_uncompressed_bytes");
      if (
        actualArchiveBytes + actualBytes >
        TABLE_SOURCE_LIMITS.archiveTotalUncompressedBytes
      )
        exceeded(format, "archive_uncompressed_bytes");
      if (
        entry.compressedBytes > 0 &&
        actualBytes / entry.compressedBytes >
          TABLE_SOURCE_LIMITS.archiveCompressionRatio
      )
        exceeded(format, "compression_ratio");
      if (actualBytes !== entry.uncompressedBytes)
        unsafe(format, "archive_inflate");
      if (finishCrc32(updateCrc32(-1, payload)) !== entry.crc32)
        unsafe(format, "archive_crc");
      actualArchiveBytes += actualBytes;
      result.set(entry.canonicalName, payload.slice());
      continue;
    }

    const chunks: Uint8Array[] = [];
    let actualBytes = 0;
    let crc = -1;
    let finished = false;
    try {
      const inflater = new Inflate((chunk, final) => {
        const nextActualBytes = actualBytes + chunk.byteLength;
        if (nextActualBytes > TABLE_SOURCE_LIMITS.archiveEntryUncompressedBytes)
          exceeded(format, "entry_uncompressed_bytes");
        if (
          actualArchiveBytes + nextActualBytes >
          TABLE_SOURCE_LIMITS.archiveTotalUncompressedBytes
        )
          exceeded(format, "archive_uncompressed_bytes");
        if (
          entry.compressedBytes > 0 &&
          nextActualBytes / entry.compressedBytes >
            TABLE_SOURCE_LIMITS.archiveCompressionRatio
        )
          exceeded(format, "compression_ratio");
        if (nextActualBytes > entry.uncompressedBytes)
          unsafe(format, "archive_inflate");
        actualBytes = nextActualBytes;
        crc = updateCrc32(crc, chunk);
        if (chunk.byteLength) chunks.push(chunk);
        if (final) finished = true;
      });
      if (!payload.byteLength) inflater.push(payload, true);
      for (
        let offset = 0;
        offset < payload.byteLength;
        offset += inflateInputChunkBytes
      ) {
        const end = Math.min(
          offset + inflateInputChunkBytes,
          payload.byteLength,
        );
        inflater.push(
          payload.subarray(offset, end),
          end === payload.byteLength,
        );
      }
    } catch (error) {
      if (error instanceof TableSourceError) throw error;
      unsafe(format, "archive_inflate");
    }
    if (!finished || actualBytes !== entry.uncompressedBytes)
      unsafe(format, "archive_inflate");
    if (finishCrc32(crc) !== entry.crc32) unsafe(format, "archive_crc");
    const value = new Uint8Array(actualBytes);
    let outputOffset = 0;
    for (const chunk of chunks) {
      value.set(chunk, outputOffset);
      outputOffset += chunk.byteLength;
    }
    actualArchiveBytes += actualBytes;
    result.set(entry.canonicalName, value);
  }
  return result;
}
