import type { ArchiveParser, ParsedArchiveResult } from "../../application/ports/archive-parser.js";
import type { ArchiveSource } from "../../application/ports/archive-source.js";
import type { ArchiveDetector } from "./archive-detector.js";

/** Bridges content detection and format-specific parsing behind one Core port. */
export class DetectedArchiveParser implements ArchiveParser {
  constructor(private readonly detector: ArchiveDetector) {}

  async parse(source: ArchiveSource): Promise<ParsedArchiveResult> {
    const detected = await this.detector.detect(source);
    return {
      adapterKey: detected.adapter.key,
      archive: await detected.adapter.parse(source, detected.evidence)
    };
  }
}
