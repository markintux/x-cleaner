import type { InteractionType, XInteractionId, XUserId } from "../../../domain/interaction.js";

export interface ParsedAccount {
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
  readonly account: ParsedAccount;
  readonly interactions: readonly NormalizedArchiveInteraction[];
}
