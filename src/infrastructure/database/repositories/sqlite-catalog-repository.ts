import type {
  ArchiveImportWrite,
  CatalogRepository,
  InteractionUpsertResult,
  InteractionWrite,
  ManagedAccountWrite
} from "../../../application/ports/catalog-repository.js";
import type { RepositoryTransaction } from "../../../application/ports/repository-transaction.js";
import type {
  ArchiveImport,
  ArchiveImportStatus,
  ArchiveSourceKind,
  Interaction,
  InteractionType,
  ManagedAccount,
  XInteractionId,
  XUserId
} from "../../../domain/interaction.js";
import type { SqliteDatabase } from "../database.js";
import { connectionFor } from "../repository-transaction.js";

type Row = Record<string, unknown>;

export interface SqliteCatalogRepositoryOptions {
  readonly now?: () => string;
}

export class SqliteCatalogRepository implements CatalogRepository {
  readonly #now: () => string;

  constructor(
    private readonly database: SqliteDatabase,
    options: SqliteCatalogRepositoryOptions = {}
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  getManagedAccount(): ManagedAccount | null {
    const row = this.database.connection.prepare("SELECT * FROM managed_accounts LIMIT 1").get();
    return row === undefined ? null : mapManagedAccount(row as Row);
  }

  upsertManagedAccount(
    account: ManagedAccountWrite,
    transaction?: RepositoryTransaction
  ): ManagedAccount {
    const connection = connectionFor(this.database.connection, transaction);
    const existing = connection.prepare("SELECT id FROM managed_accounts LIMIT 1").get() as
      Row | undefined;
    const now = this.#now();

    if (existing === undefined) {
      connection
        .prepare(
          `INSERT INTO managed_accounts (
             id, x_user_id, archive_handle, confirmed_handle, confirmed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          account.id,
          account.xUserId,
          account.archiveHandle,
          account.confirmedHandle,
          account.confirmedAt,
          now,
          now
        );
      return this.getManagedAccountFrom(connection);
    }

    const id = requiredString(existing.id, "INVALID_MANAGED_ACCOUNT");
    connection
      .prepare(
        `UPDATE managed_accounts
         SET x_user_id = ?, archive_handle = ?, confirmed_handle = ?, confirmed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        account.xUserId,
        account.archiveHandle,
        account.confirmedHandle,
        account.confirmedAt,
        now,
        id
      );
    return this.getManagedAccountFrom(connection);
  }

  getArchiveImport(id: string): ArchiveImport | null {
    const row = this.database.connection
      .prepare("SELECT * FROM archive_imports WHERE id = ?")
      .get(id);
    return row === undefined ? null : mapArchiveImport(row as Row);
  }

  createArchiveImport(
    archiveImport: ArchiveImportWrite,
    transaction?: RepositoryTransaction
  ): ArchiveImport {
    const connection = connectionFor(this.database.connection, transaction);
    const now = this.#now();
    connection
      .prepare(
        `INSERT INTO archive_imports (
          id, account_id, source_kind, source_label, source_sha256, adapter_key, status,
          posts_count, replies_count, reposts_count, likes_count, inserted_count, reused_count,
          updated_count, error_code, started_at, finished_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        archiveImport.id,
        archiveImport.accountId,
        archiveImport.sourceKind,
        archiveImport.sourceLabel,
        archiveImport.sourceSha256,
        archiveImport.adapterKey,
        archiveImport.status,
        archiveImport.postsCount ?? 0,
        archiveImport.repliesCount ?? 0,
        archiveImport.repostsCount ?? 0,
        archiveImport.likesCount ?? 0,
        archiveImport.insertedCount ?? 0,
        archiveImport.reusedCount ?? 0,
        archiveImport.updatedCount ?? 0,
        archiveImport.errorCode ?? null,
        archiveImport.startedAt,
        archiveImport.finishedAt ?? null,
        now,
        now
      );
    return this.getArchiveImportFrom(connection, archiveImport.id);
  }

  updateArchiveImport(
    id: string,
    update: Parameters<CatalogRepository["updateArchiveImport"]>[1],
    transaction?: RepositoryTransaction
  ): ArchiveImport {
    const current = this.getArchiveImportFrom(
      connectionFor(this.database.connection, transaction),
      id
    );
    const connection = connectionFor(this.database.connection, transaction);
    connection
      .prepare(
        `UPDATE archive_imports SET
          account_id = ?, status = ?, finished_at = ?, posts_count = ?, replies_count = ?,
          reposts_count = ?, likes_count = ?, inserted_count = ?, reused_count = ?, updated_count = ?,
          error_code = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        update.accountId ?? current.accountId,
        update.status ?? current.status,
        update.finishedAt === undefined ? current.finishedAt : update.finishedAt,
        update.postsCount ?? current.postsCount,
        update.repliesCount ?? current.repliesCount,
        update.repostsCount ?? current.repostsCount,
        update.likesCount ?? current.likesCount,
        update.insertedCount ?? current.insertedCount,
        update.reusedCount ?? current.reusedCount,
        update.updatedCount ?? current.updatedCount,
        update.errorCode === undefined ? current.errorCode : update.errorCode,
        this.#now(),
        id
      );
    return this.getArchiveImportFrom(connection, id);
  }

  upsertInteraction(
    interaction: InteractionWrite,
    transaction?: RepositoryTransaction
  ): InteractionUpsertResult {
    const connection = connectionFor(this.database.connection, transaction);
    const prior = connection
      .prepare(
        `SELECT * FROM interactions
         WHERE account_id = ? AND type = ? AND x_interaction_id = ?`
      )
      .get(interaction.accountId, interaction.type, interaction.xInteractionId) as Row | undefined;
    const now = this.#now();

    if (prior === undefined) {
      connection
        .prepare(
          `INSERT INTO interactions (
             account_id, x_interaction_id, type, interaction_created_at, content_preview,
             source_relative_path, source_record_key, first_seen_import_id, last_seen_import_id,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          interaction.accountId,
          interaction.xInteractionId,
          interaction.type,
          interaction.interactionCreatedAt,
          interaction.contentPreview,
          interaction.sourceRelativePath,
          interaction.sourceRecordKey,
          interaction.importId,
          interaction.importId,
          now,
          now
        );
      const created = this.findInteraction(connection, interaction);
      return { interaction: created, kind: "INSERTED" };
    }

    const previous = mapInteraction(prior);
    const changed =
      previous.interactionCreatedAt !== interaction.interactionCreatedAt ||
      previous.contentPreview !== interaction.contentPreview ||
      previous.sourceRelativePath !== interaction.sourceRelativePath ||
      previous.sourceRecordKey !== interaction.sourceRecordKey;
    connection
      .prepare(
        `UPDATE interactions SET interaction_created_at = ?, content_preview = ?, source_relative_path = ?,
          source_record_key = ?, last_seen_import_id = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        interaction.interactionCreatedAt,
        interaction.contentPreview,
        interaction.sourceRelativePath,
        interaction.sourceRecordKey,
        interaction.importId,
        now,
        previous.id
      );
    return {
      interaction: this.findInteraction(connection, interaction),
      kind: changed ? "UPDATED" : "REUSED"
    };
  }

  getInteraction(id: number): Interaction | null {
    const row = this.database.connection.prepare("SELECT * FROM interactions WHERE id = ?").get(id);
    return row === undefined ? null : mapInteraction(row as Row);
  }

  countInteractions(accountId: string): number {
    const row = this.database.connection
      .prepare("SELECT count(*) AS count FROM interactions WHERE account_id = ?")
      .get(accountId) as Row;
    return requiredNumber(row.count, "INVALID_DATABASE_VALUE");
  }

  private getManagedAccountFrom(connection: typeof this.database.connection): ManagedAccount {
    const row = connection.prepare("SELECT * FROM managed_accounts LIMIT 1").get();
    if (row === undefined) {
      throw new Error("MANAGED_ACCOUNT_NOT_FOUND");
    }
    return mapManagedAccount(row as Row);
  }

  private getArchiveImportFrom(
    connection: typeof this.database.connection,
    id: string
  ): ArchiveImport {
    const row = connection.prepare("SELECT * FROM archive_imports WHERE id = ?").get(id);
    if (row === undefined) {
      throw new Error("ARCHIVE_IMPORT_NOT_FOUND");
    }
    return mapArchiveImport(row as Row);
  }

  private findInteraction(
    connection: typeof this.database.connection,
    interaction: InteractionWrite
  ): Interaction {
    const row = connection
      .prepare(
        "SELECT * FROM interactions WHERE account_id = ? AND type = ? AND x_interaction_id = ?"
      )
      .get(interaction.accountId, interaction.type, interaction.xInteractionId);
    if (row === undefined) {
      throw new Error("INTERACTION_NOT_FOUND");
    }
    return mapInteraction(row as Row);
  }
}

function mapManagedAccount(row: Row): ManagedAccount {
  return {
    id: requiredString(row.id, "INVALID_MANAGED_ACCOUNT"),
    xUserId: nullableString(row.x_user_id) as XUserId | null,
    archiveHandle: nullableString(row.archive_handle),
    confirmedHandle: nullableString(row.confirmed_handle),
    confirmedAt: nullableString(row.confirmed_at),
    createdAt: requiredString(row.created_at, "INVALID_MANAGED_ACCOUNT"),
    updatedAt: requiredString(row.updated_at, "INVALID_MANAGED_ACCOUNT")
  };
}

function mapArchiveImport(row: Row): ArchiveImport {
  return {
    id: requiredString(row.id, "INVALID_ARCHIVE_IMPORT"),
    accountId: nullableString(row.account_id),
    sourceKind: requiredString(row.source_kind, "INVALID_ARCHIVE_IMPORT") as ArchiveSourceKind,
    sourceLabel: requiredString(row.source_label, "INVALID_ARCHIVE_IMPORT"),
    sourceSha256: requiredString(row.source_sha256, "INVALID_ARCHIVE_IMPORT"),
    adapterKey: requiredString(row.adapter_key, "INVALID_ARCHIVE_IMPORT"),
    status: requiredString(row.status, "INVALID_ARCHIVE_IMPORT") as ArchiveImportStatus,
    postsCount: requiredNumber(row.posts_count, "INVALID_ARCHIVE_IMPORT"),
    repliesCount: requiredNumber(row.replies_count, "INVALID_ARCHIVE_IMPORT"),
    repostsCount: requiredNumber(row.reposts_count, "INVALID_ARCHIVE_IMPORT"),
    likesCount: requiredNumber(row.likes_count, "INVALID_ARCHIVE_IMPORT"),
    insertedCount: requiredNumber(row.inserted_count, "INVALID_ARCHIVE_IMPORT"),
    reusedCount: requiredNumber(row.reused_count, "INVALID_ARCHIVE_IMPORT"),
    updatedCount: requiredNumber(row.updated_count, "INVALID_ARCHIVE_IMPORT"),
    errorCode: nullableString(row.error_code),
    startedAt: requiredString(row.started_at, "INVALID_ARCHIVE_IMPORT"),
    finishedAt: nullableString(row.finished_at),
    createdAt: requiredString(row.created_at, "INVALID_ARCHIVE_IMPORT"),
    updatedAt: requiredString(row.updated_at, "INVALID_ARCHIVE_IMPORT")
  };
}

function mapInteraction(row: Row): Interaction {
  return {
    id: requiredNumber(row.id, "INVALID_INTERACTION"),
    accountId: requiredString(row.account_id, "INVALID_INTERACTION"),
    xInteractionId: requiredString(row.x_interaction_id, "INVALID_INTERACTION") as XInteractionId,
    type: requiredString(row.type, "INVALID_INTERACTION") as InteractionType,
    interactionCreatedAt: nullableString(row.interaction_created_at),
    contentPreview: nullableString(row.content_preview),
    sourceRelativePath: requiredString(row.source_relative_path, "INVALID_INTERACTION"),
    sourceRecordKey: nullableString(row.source_record_key),
    firstSeenImportId: requiredString(row.first_seen_import_id, "INVALID_INTERACTION"),
    lastSeenImportId: requiredString(row.last_seen_import_id, "INVALID_INTERACTION"),
    createdAt: requiredString(row.created_at, "INVALID_INTERACTION"),
    updatedAt: requiredString(row.updated_at, "INVALID_INTERACTION")
  };
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== "string") {
    throw new Error(error);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return requiredString(value, "INVALID_DATABASE_VALUE");
}

function requiredNumber(value: unknown, error: string): number {
  if (typeof value !== "number") {
    throw new Error(error);
  }
  return value;
}
