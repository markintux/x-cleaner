/** A stable X identifier which is intentionally never represented as a number. */
declare const decimalStringBrand: unique symbol;

export type DecimalString = string & {
  readonly [decimalStringBrand]: "DecimalString";
};

export type XInteractionId = DecimalString & {
  readonly __xInteractionId: "XInteractionId";
};

export type XUserId = DecimalString & {
  readonly __xUserId: "XUserId";
};

export const archiveSourceKinds = ["ZIP", "DIRECTORY"] as const;

export type ArchiveSourceKind = (typeof archiveSourceKinds)[number];

export const archiveImportStatuses = ["PROCESSING", "COMPLETED", "FAILED"] as const;

export type ArchiveImportStatus = (typeof archiveImportStatuses)[number];

export const interactionTypes = ["POST", "REPLY", "REPOST", "LIKE"] as const;

export type InteractionType = (typeof interactionTypes)[number];

export interface Interaction {
  readonly id: number;
  readonly accountId: string;
  readonly xInteractionId: XInteractionId;
  readonly type: InteractionType;
  readonly interactionCreatedAt: string | null;
  readonly contentPreview: string | null;
  readonly sourceRelativePath: string;
  readonly sourceRecordKey: string | null;
  readonly firstSeenImportId: string;
  readonly lastSeenImportId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The single local X account associated with an application data directory. */
export interface ManagedAccount {
  readonly id: string;
  readonly xUserId: XUserId | null;
  readonly archiveHandle: string | null;
  readonly confirmedHandle: string | null;
  readonly confirmedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Metadata for one local, privacy-safe archive import attempt. */
export interface ArchiveImport {
  readonly id: string;
  readonly accountId: string | null;
  readonly sourceKind: ArchiveSourceKind;
  readonly sourceLabel: string;
  readonly sourceSha256: string;
  readonly adapterKey: string;
  readonly status: ArchiveImportStatus;
  readonly postsCount: number;
  readonly repliesCount: number;
  readonly repostsCount: number;
  readonly likesCount: number;
  readonly insertedCount: number;
  readonly reusedCount: number;
  readonly updatedCount: number;
  readonly errorCode: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function isInteractionType(value: string): value is InteractionType {
  return (interactionTypes as readonly string[]).includes(value);
}

export function isArchiveSourceKind(value: string): value is ArchiveSourceKind {
  return (archiveSourceKinds as readonly string[]).includes(value);
}

export function isArchiveImportStatus(value: string): value is ArchiveImportStatus {
  return (archiveImportStatuses as readonly string[]).includes(value);
}

export function isDecimalString(value: string): value is DecimalString {
  return /^\d+$/.test(value);
}

export function decimalString(value: string): DecimalString {
  if (!isDecimalString(value)) {
    throw new Error("INVALID_DECIMAL_STRING");
  }

  return value as DecimalString;
}

export function xInteractionId(value: string): XInteractionId {
  return decimalString(value) as XInteractionId;
}

export function xUserId(value: string): XUserId {
  return decimalString(value) as XUserId;
}
