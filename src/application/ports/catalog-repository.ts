import type {
  ArchiveImport,
  ArchiveImportStatus,
  ArchiveSourceKind,
  Interaction,
  InteractionType,
  ManagedAccount,
  XInteractionId,
  XUserId
} from "../../domain/interaction.js";
import type { SelectionFilters } from "../../domain/selection.js";
import type { RepositoryTransaction } from "./repository-transaction.js";

export interface ManagedAccountWrite {
  readonly id: string;
  readonly xUserId: XUserId | null;
  readonly archiveHandle: string | null;
  readonly confirmedHandle: string | null;
  readonly confirmedAt: string | null;
}

export interface ArchiveImportWrite {
  readonly id: string;
  readonly accountId: string | null;
  readonly sourceKind: ArchiveSourceKind;
  readonly sourceLabel: string;
  readonly sourceSha256: string;
  readonly adapterKey: string;
  readonly status: ArchiveImportStatus;
  readonly startedAt: string;
  readonly finishedAt?: string | null;
  readonly postsCount?: number;
  readonly repliesCount?: number;
  readonly repostsCount?: number;
  readonly likesCount?: number;
  readonly insertedCount?: number;
  readonly reusedCount?: number;
  readonly updatedCount?: number;
  readonly errorCode?: string | null;
}

export interface InteractionWrite {
  readonly accountId: string;
  readonly xInteractionId: XInteractionId;
  readonly type: InteractionType;
  readonly interactionCreatedAt: string | null;
  readonly contentPreview: string | null;
  readonly sourceRelativePath: string;
  readonly sourceRecordKey: string | null;
  readonly importId: string;
}

export type InteractionUpsertKind = "INSERTED" | "REUSED" | "UPDATED";

export interface InteractionUpsertResult {
  readonly interaction: Interaction;
  readonly kind: InteractionUpsertKind;
}

export interface CatalogSelectionItem {
  readonly id: number;
  readonly type: InteractionType;
  readonly interactionCreatedAt: string | null;
}

export interface CatalogStatusSnapshot {
  readonly account: ManagedAccount | null;
  readonly imports: {
    readonly total: number;
    readonly byStatus: Readonly<Record<ArchiveImportStatus, number>>;
    readonly bySourceKind: Readonly<Record<ArchiveSourceKind, number>>;
  };
  readonly interactions: {
    readonly total: number;
    readonly byType: Readonly<Record<InteractionType, number>>;
  };
  /** Import lifecycle counts are kept separate from catalog type counts. */
  readonly lifecycle: Readonly<Record<ArchiveImportStatus, number>>;
}

export interface CatalogRepository {
  getManagedAccount(): ManagedAccount | null;
  upsertManagedAccount(
    account: ManagedAccountWrite,
    transaction?: RepositoryTransaction
  ): ManagedAccount;
  getArchiveImport(id: string): ArchiveImport | null;
  createArchiveImport(
    archiveImport: ArchiveImportWrite,
    transaction?: RepositoryTransaction
  ): ArchiveImport;
  updateArchiveImport(
    id: string,
    update: Partial<
      Pick<
        ArchiveImportWrite,
        | "accountId"
        | "status"
        | "finishedAt"
        | "postsCount"
        | "repliesCount"
        | "repostsCount"
        | "likesCount"
        | "insertedCount"
        | "reusedCount"
        | "updatedCount"
        | "errorCode"
      >
    >,
    transaction?: RepositoryTransaction
  ): ArchiveImport;
  upsertInteraction(
    interaction: InteractionWrite,
    transaction?: RepositoryTransaction
  ): InteractionUpsertResult;
  getInteraction(id: number): Interaction | null;
  countInteractions(accountId: string): number;
  getCatalogStatus(): CatalogStatusSnapshot;
  getHighestInteractionId(accountId: string, transaction?: RepositoryTransaction): number | null;
  selectInteractions(
    accountId: string,
    filters: SelectionFilters,
    catalogCutoffId: number,
    transaction?: RepositoryTransaction
  ): readonly CatalogSelectionItem[];
}
