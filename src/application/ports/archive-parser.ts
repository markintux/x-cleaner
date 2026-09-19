import type { InteractionType, XInteractionId, XUserId } from "../../domain/interaction.js";
import type { ArchiveSource } from "./archive-source.js";

export interface ParsedArchiveAccount {
  readonly xUserId: XUserId | null;
  readonly handle: string | null;
}

export interface NormalizedArchiveInteraction {
  readonly xInteractionId: XInteractionId;
  readonly type: InteractionType;
  readonly interactionCreatedAt: string | null;
  readonly contentPreview: string | null;
  readonly sourceRelativePath: string;
  readonly sourceRecordKey: string;
}

export interface ParsedArchive {
  readonly account: ParsedArchiveAccount;
  readonly interactions: readonly NormalizedArchiveInteraction[];
}

export interface ParsedArchiveResult {
  readonly adapterKey: string;
  readonly archive: ParsedArchive;
}

/** Content-driven parsing boundary implemented by archive infrastructure. */
export interface ArchiveParser {
  parse(source: ArchiveSource): Promise<ParsedArchiveResult>;
}
