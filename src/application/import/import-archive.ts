import { createHash, randomUUID } from "node:crypto";
import { ArchiveSourceError, type ArchiveSource } from "../ports/archive-source.js";
import type { CatalogRepository } from "../ports/catalog-repository.js";
import { recordAudit, type AuditLogger } from "../ports/audit-logger.js";
import type { ArchiveImport, InteractionType, ManagedAccount } from "../../domain/interaction.js";
import type {
  ArchiveParser,
  ParsedArchive,
  NormalizedArchiveInteraction
} from "../ports/archive-parser.js";
import type { RepositoryTransactionRunner } from "../ports/repository-transaction.js";

export interface ImportArchiveOptions {
  readonly now?: () => string;
  readonly idFactory?: () => string;
  readonly batchSize?: number;
  readonly sourceFactory?: (input: string) => ArchiveSource | Promise<ArchiveSource>;
  readonly auditLogger?: AuditLogger;
}

export interface ImportArchiveResult {
  readonly archiveImport: ArchiveImport;
  readonly account: ManagedAccount;
  readonly adapterKey: string;
  readonly postsCount: number;
  readonly repliesCount: number;
  readonly repostsCount: number;
  readonly likesCount: number;
  readonly totalCount: number;
  readonly insertedCount: number;
  readonly reusedCount: number;
  readonly updatedCount: number;
}

/** Application service for one complete, atomic extracted-directory import. */
export class ImportArchive {
  readonly #now: () => string;
  readonly #idFactory: () => string;
  readonly #batchSize: number;
  readonly #sourceFactory: ((input: string) => ArchiveSource | Promise<ArchiveSource>) | undefined;
  readonly #auditLogger: AuditLogger | undefined;

  constructor(
    private readonly transactions: RepositoryTransactionRunner,
    private readonly catalog: CatalogRepository,
    private readonly parser: ArchiveParser,
    options: ImportArchiveOptions = {}
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? randomUUID;
    this.#batchSize = options.batchSize ?? 100;
    this.#sourceFactory = options.sourceFactory;
    this.#auditLogger = options.auditLogger;
    if (!Number.isSafeInteger(this.#batchSize) || this.#batchSize <= 0) {
      throw new Error("INVALID_IMPORT_BATCH_SIZE");
    }
  }

  async execute(input: string | ArchiveSource): Promise<ImportArchiveResult> {
    const source =
      typeof input === "string" ? await requireSourceFactory(this.#sourceFactory)(input) : input;
    const importId = this.#idFactory();
    const startedAt = this.#now();
    let sourceSha256 = fallbackFingerprint(source.label);
    let adapterKey = "unknown";
    let parsed: ParsedArchive | null = null;

    await recordAudit(this.#auditLogger, {
      event: "archive.import.started",
      timestamp: startedAt,
      importId,
      sourceKind: source.kind,
      sourceLabel: safeAuditSourceLabel(source.label),
      adapterKey
    });

    try {
      validateSource(source);
      sourceSha256 = await source.fingerprint();
      const detected = await this.parser.parse(source);
      adapterKey = detected.adapterKey;
      parsed = detected.archive;
      const result = this.#commit(source, sourceSha256, adapterKey, importId, startedAt, parsed);
      await recordAudit(this.#auditLogger, {
        event: "archive.import.completed",
        timestamp: result.archiveImport.finishedAt ?? this.#now(),
        importId: result.archiveImport.id,
        sourceKind: source.kind,
        adapterKey: result.adapterKey,
        posts: result.postsCount,
        replies: result.repliesCount,
        reposts: result.repostsCount,
        likes: result.likesCount,
        inserted: result.insertedCount,
        reused: result.reusedCount,
        updated: result.updatedCount
      });
      return result;
    } catch (error) {
      const errorCode = sanitizeImportError(error);
      const failedImport = this.#recordFailure(
        source,
        sourceSha256,
        adapterKey,
        importId,
        startedAt,
        errorCode
      );
      await recordAudit(this.#auditLogger, {
        event: "archive.import.failed",
        timestamp: failedImport.finishedAt ?? this.#now(),
        importId: failedImport.id,
        sourceKind: source.kind,
        adapterKey,
        errorCode
      });
      // The failed metadata is useful audit state, but no parsed interaction is
      // ever written outside the successful transaction above.
      void parsed;
      throw Object.assign(new Error(errorCode), {
        code: errorCode,
        importId: failedImport.id
      });
    }
  }

  import(input: string | ArchiveSource): Promise<ImportArchiveResult> {
    return this.execute(input);
  }

  #commit(
    source: ArchiveSource,
    sourceSha256: string,
    adapterKey: string,
    importId: string,
    startedAt: string,
    parsed: ParsedArchive
  ): ImportArchiveResult {
    const previousAccount = this.catalog.getManagedAccount();
    const previousXUserId = previousAccount?.xUserId ?? null;
    if (
      previousXUserId !== null &&
      parsed.account.xUserId !== null &&
      previousXUserId !== parsed.account.xUserId
    ) {
      throw new Error("ARCHIVE_ACCOUNT_CONFLICT");
    }
    const accountId = previousAccount?.id ?? this.#idFactory();
    const finishedAt = this.#now();
    const counts = countInteractions(parsed.interactions);
    let result: ImportArchiveResult | undefined;

    this.transactions.run((transaction) => {
      const account = this.catalog.upsertManagedAccount(
        {
          id: accountId,
          xUserId: parsed.account.xUserId ?? previousAccount?.xUserId ?? null,
          archiveHandle: parsed.account.handle ?? previousAccount?.archiveHandle ?? null,
          confirmedHandle: previousAccount?.confirmedHandle ?? null,
          confirmedAt: previousAccount?.confirmedAt ?? null
        },
        transaction
      );
      this.catalog.createArchiveImport(
        {
          id: importId,
          accountId: account.id,
          sourceKind: source.kind,
          sourceLabel: source.label,
          sourceSha256,
          adapterKey,
          status: "PROCESSING",
          startedAt
        },
        transaction
      );

      let insertedCount = 0;
      let reusedCount = 0;
      let updatedCount = 0;
      for (let start = 0; start < parsed.interactions.length; start += this.#batchSize) {
        const batch = parsed.interactions.slice(start, start + this.#batchSize);
        for (const interaction of batch) {
          const upsert = this.catalog.upsertInteraction(
            toInteractionWrite(interaction, account.id, importId),
            transaction
          );
          if (upsert.kind === "INSERTED") insertedCount += 1;
          if (upsert.kind === "REUSED") reusedCount += 1;
          if (upsert.kind === "UPDATED") updatedCount += 1;
        }
      }

      const archiveImport = this.catalog.updateArchiveImport(
        importId,
        {
          accountId: account.id,
          status: "COMPLETED",
          finishedAt,
          postsCount: counts.POST,
          repliesCount: counts.REPLY,
          repostsCount: counts.REPOST,
          likesCount: counts.LIKE,
          insertedCount,
          reusedCount,
          updatedCount,
          errorCode: null
        },
        transaction
      );
      result = {
        archiveImport,
        account,
        adapterKey,
        postsCount: counts.POST,
        repliesCount: counts.REPLY,
        repostsCount: counts.REPOST,
        likesCount: counts.LIKE,
        totalCount: parsed.interactions.length,
        insertedCount,
        reusedCount,
        updatedCount
      };
    });

    if (result === undefined) {
      throw new Error("ARCHIVE_IMPORT_RESULT_MISSING");
    }
    return result;
  }

  #recordFailure(
    source: ArchiveSource,
    sourceSha256: string,
    adapterKey: string,
    importId: string,
    startedAt: string,
    errorCode: string
  ): ArchiveImport {
    const finishedAt = this.#now();
    return this.transactions.run((transaction) => {
      return this.catalog.createArchiveImport(
        {
          id: importId,
          accountId: null,
          sourceKind: source.kind,
          sourceLabel: source.label,
          sourceSha256:
            sourceSha256.length === 64 ? sourceSha256 : fallbackFingerprint(source.label),
          adapterKey: adapterKey || "unknown",
          status: "FAILED",
          startedAt,
          finishedAt,
          errorCode
        },
        transaction
      );
    });
  }
}

export async function importArchive(
  transactions: RepositoryTransactionRunner,
  catalog: CatalogRepository,
  parser: ArchiveParser,
  input: string | ArchiveSource,
  options: ImportArchiveOptions = {}
): Promise<ImportArchiveResult> {
  return new ImportArchive(transactions, catalog, parser, options).execute(input);
}

function validateSource(source: ArchiveSource): void {
  if (
    (source.kind !== "DIRECTORY" && source.kind !== "ZIP") ||
    source.label.length === 0 ||
    source.label.includes("/") ||
    source.label.includes("\\") ||
    /^[A-Za-z]:/u.test(source.label)
  ) {
    throw new ArchiveSourceError("ARCHIVE_SOURCE_INVALID");
  }
}

function requireSourceFactory(
  factory: ImportArchiveOptions["sourceFactory"]
): NonNullable<ImportArchiveOptions["sourceFactory"]> {
  if (factory === undefined) {
    throw new Error("ARCHIVE_SOURCE_FACTORY_REQUIRED");
  }
  return factory;
}

function toInteractionWrite(
  interaction: NormalizedArchiveInteraction,
  accountId: string,
  importId: string
) {
  return {
    accountId,
    xInteractionId: interaction.xInteractionId,
    type: interaction.type,
    interactionCreatedAt: interaction.interactionCreatedAt,
    contentPreview: interaction.contentPreview,
    sourceRelativePath: interaction.sourceRelativePath,
    sourceRecordKey: interaction.sourceRecordKey,
    importId
  };
}

function countInteractions(
  interactions: readonly NormalizedArchiveInteraction[]
): Record<InteractionType, number> {
  const counts: Record<InteractionType, number> = { POST: 0, REPLY: 0, REPOST: 0, LIKE: 0 };
  for (const interaction of interactions) {
    counts[interaction.type] += 1;
  }
  return counts;
}

function sanitizeImportError(error: unknown): string {
  if (error instanceof Error && error.message === "UNSUPPORTED_ARCHIVE") {
    return "UNSUPPORTED_ARCHIVE";
  }
  const candidate = error as { code?: unknown; message?: unknown };
  if (typeof candidate.code === "string" && isSanitizedErrorCode(candidate.code)) {
    return candidate.code;
  }
  if (typeof candidate.message === "string" && isSanitizedErrorCode(candidate.message)) {
    return candidate.message;
  }
  return "ARCHIVE_IMPORT_FAILED";
}

function isSanitizedErrorCode(value: string): boolean {
  return new Set([
    "ARCHIVE_SOURCE_INVALID",
    "ARCHIVE_ENTRY_INVALID",
    "ARCHIVE_ENTRY_SYMLINK",
    "ARCHIVE_ENTRY_OUTSIDE_SOURCE",
    "ARCHIVE_ENTRY_TOO_LARGE",
    "ARCHIVE_ENTRY_NOT_FOUND",
    "ARCHIVE_ENTRY_NOT_REGULAR",
    "ARCHIVE_INVALID_UTF8",
    "ARCHIVE_SOURCE_CHANGED",
    "ARCHIVE_ENTRY_ENCRYPTED",
    "ARCHIVE_ENTRY_DUPLICATE",
    "ARCHIVE_ENTRY_AMBIGUOUS",
    "ARCHIVE_ENTRY_COMPRESSED_TOO_LARGE",
    "ARCHIVE_ENTRY_SIZE_INVALID",
    "ARCHIVE_TOO_MANY_ENTRIES",
    "ARCHIVE_TOTAL_TOO_LARGE",
    "ARCHIVE_TOTAL_COMPRESSED_TOO_LARGE",
    "ARCHIVE_APPENDED_DATA_TOO_LARGE",
    "ARCHIVE_AMBIGUOUS",
    "ARCHIVE_MALFORMED",
    "MALFORMED_ARCHIVE_WRAPPER",
    "UNSAFE_ARCHIVE_JAVASCRIPT",
    "MALFORMED_ARCHIVE_RECORD",
    "UNSUPPORTED_ARCHIVE_IDENTIFIER",
    "ARCHIVE_ACCOUNT_CONFLICT",
    "UNSUPPORTED_ARCHIVE",
    "ARCHIVE_IMPORT_FAILED"
  ]).has(value);
}

function safeAuditSourceLabel(value: string): string {
  return /^[A-Za-z]:|[\\/]/u.test(value) ? "untrusted-source" : value;
}

function fallbackFingerprint(label: string): string {
  return createHash("sha256").update(`invalid-source:${label}`, "utf8").digest("hex");
}
