import { lstat } from "node:fs/promises";

import {
  ArchiveSourceError,
  type ArchiveSource
} from "../../src/application/ports/archive-source.js";
import { YtdArchiveAdapter } from "../../src/infrastructure/archive/adapters/ytd-archive-adapter.js";
import { ArchiveDetector } from "../../src/infrastructure/archive/archive-detector.js";
import { DetectedArchiveParser } from "../../src/infrastructure/archive/archive-parser.js";
import { DirectoryArchiveSource } from "../../src/infrastructure/archive/directory-archive-source.js";
import { ZipArchiveSource } from "../../src/infrastructure/archive/zip-archive-source.js";

export function createArchiveParser(): DetectedArchiveParser {
  return new DetectedArchiveParser(new ArchiveDetector([new YtdArchiveAdapter()]));
}

export async function createArchiveSource(input: string): Promise<ArchiveSource> {
  const stats = await lstat(input).catch(() => null);
  if (stats === null || stats.isSymbolicLink()) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
  }
  if (stats.isDirectory()) return new DirectoryArchiveSource(input);
  if (stats.isFile()) return new ZipArchiveSource(input);
  throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
}
