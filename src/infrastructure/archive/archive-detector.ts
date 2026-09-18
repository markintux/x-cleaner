import type { ArchiveSource } from "../../application/ports/archive-source.js";
import {
  YtdArchiveAdapter,
  isSupportedCategory,
  type ArchiveAdapter,
  type YtdAssignmentEvidence
} from "./adapters/ytd-archive-adapter.js";

export class UnsupportedArchiveError extends Error {
  constructor() {
    super("UNSUPPORTED_ARCHIVE");
    this.name = "UnsupportedArchiveError";
  }
}

export interface DetectedArchive {
  readonly adapter: ArchiveAdapter;
  readonly evidence: readonly YtdAssignmentEvidence[];
}

/** Detects an adapter from decoded content, never from a fixed filename. */
export class ArchiveDetector {
  constructor(private readonly adapters: readonly ArchiveAdapter[] = [new YtdArchiveAdapter()]) {}

  async detect(source: ArchiveSource): Promise<DetectedArchive> {
    for (const adapter of this.adapters) {
      const evidence = await adapter.discover(source);
      if (evidence.some((item) => isSupportedCategory(item.assignment.category))) {
        return { adapter, evidence };
      }
    }
    throw new UnsupportedArchiveError();
  }

  async detectAdapter(source: ArchiveSource): Promise<ArchiveAdapter> {
    return (await this.detect(source)).adapter;
  }

  async parse(source: ArchiveSource) {
    const detected = await this.detect(source);
    return detected.adapter.parse(source, detected.evidence);
  }
}

export async function detectArchive(source: ArchiveSource): Promise<DetectedArchive> {
  return new ArchiveDetector().detect(source);
}
