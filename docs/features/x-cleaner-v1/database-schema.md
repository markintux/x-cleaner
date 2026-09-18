# Database Schema — X Cleaner V1

<!-- inputs: feature-description.md@sha256:dd940ac58690 user-stories.md@sha256:dc6892d3c5d3 -->

## Summary

This feature creates the complete local SQLite schema for X Cleaner V1. The repository has no existing application database or migrations. The schema separates archive discovery, immutable reviewed plans, resumable runs, separately confirmed execution batches, per-interaction state, append-only attempts/checkpoints, and generated reports.

## New Tables

### `schema_migrations`

```dbml
Table schema_migrations {
  version integer [pk, not null, note: 'Monotonically increasing migration version']
  name text [not null]
  applied_at text [not null, note: 'UTC ISO 8601 timestamp']
}
```

### `managed_accounts`

```dbml
Table managed_accounts {
  id text [pk, not null, note: 'UUID']
  singleton_key integer [not null, unique, default: 1, note: 'CHECK (singleton_key = 1); enforces one managed X account per data directory']
  x_user_id text [null, unique, note: 'Decimal string when the archive or browser exposes a stable X user ID']
  archive_handle text [null, note: 'Handle discovered from the archive, stored without @']
  confirmed_handle text [null, note: 'Last handle explicitly confirmed from the authenticated browser, stored without @']
  confirmed_at text [null, note: 'UTC ISO 8601 timestamp']
  created_at text [not null, note: 'UTC ISO 8601 timestamp']
  updated_at text [not null, note: 'UTC ISO 8601 timestamp']

  indexes {
    archive_handle [name: 'managed_accounts_archive_handle_idx']
    confirmed_handle [name: 'managed_accounts_confirmed_handle_idx']
  }
}
```

### `archive_imports`

```dbml
Table archive_imports {
  id text [pk, not null, note: 'UUID']
  account_id text [null, ref: > managed_accounts.id, note: 'Null only until account evidence is parsed']
  source_kind text [not null, note: 'CHECK IN (ZIP, DIRECTORY)']
  source_label text [not null, note: 'Basename or user-safe label only; never an absolute source path']
  source_sha256 text [not null, note: 'Lowercase 64-character SHA-256 digest of the ZIP or deterministic directory manifest']
  adapter_key text [not null, note: 'Stable parser adapter identifier']
  status text [not null, note: 'CHECK IN (PROCESSING, COMPLETED, FAILED)']
  posts_count integer [not null, default: 0, note: 'CHECK >= 0']
  replies_count integer [not null, default: 0, note: 'CHECK >= 0']
  reposts_count integer [not null, default: 0, note: 'CHECK >= 0']
  likes_count integer [not null, default: 0, note: 'CHECK >= 0']
  inserted_count integer [not null, default: 0, note: 'CHECK >= 0']
  reused_count integer [not null, default: 0, note: 'CHECK >= 0']
  updated_count integer [not null, default: 0, note: 'CHECK >= 0']
  error_code text [null, note: 'Sanitized machine-readable category only']
  started_at text [not null, note: 'UTC ISO 8601 timestamp']
  finished_at text [null, note: 'UTC ISO 8601 timestamp']
  created_at text [not null, note: 'UTC ISO 8601 timestamp']
  updated_at text [not null, note: 'UTC ISO 8601 timestamp']

  indexes {
    account_id [name: 'archive_imports_account_id_idx']
    source_sha256 [name: 'archive_imports_source_sha256_idx']
    status [name: 'archive_imports_status_idx']
    (account_id, created_at) [name: 'archive_imports_account_created_idx']
  }
}
```

### `interactions`

```dbml
Table interactions {
  id integer [pk, increment, not null]
  account_id text [not null, ref: > managed_accounts.id]
  x_interaction_id text [not null, note: 'Decimal string; never converted to JavaScript number']
  type text [not null, note: 'CHECK IN (POST, REPLY, REPOST, LIKE)']
  interaction_created_at text [null, note: 'UTC ISO 8601 timestamp; null when the archive supplies no reliable date']
  content_preview text [null, note: 'Optional local-only preview, limited to 280 Unicode characters; never logged or reported by default']
  source_relative_path text [not null, note: 'Archive-relative logical source path; never an absolute filesystem path']
  source_record_key text [null, note: 'Adapter-specific array key or record position used for diagnostics']
  first_seen_import_id text [not null, ref: > archive_imports.id]
  last_seen_import_id text [not null, ref: > archive_imports.id]
  created_at text [not null, note: 'UTC ISO 8601 timestamp']
  updated_at text [not null, note: 'UTC ISO 8601 timestamp']

  indexes {
    (account_id, type, x_interaction_id) [unique, name: 'interactions_account_type_xid_uq']
    (account_id, type, interaction_created_at, id) [name: 'interactions_selection_idx']
    first_seen_import_id [name: 'interactions_first_import_idx']
    last_seen_import_id [name: 'interactions_last_import_idx']
  }
}
```

### `cleaning_plans`

```dbml
Table cleaning_plans {
  id text [pk, not null, note: 'UUID']
  account_id text [not null, ref: > managed_accounts.id]
  catalog_cutoff_id integer [not null, ref: > interactions.id, note: 'Highest interaction row ID visible when the dry-run snapshot was created']
  from_at text [null, note: 'Inclusive UTC ISO 8601 lower date bound']
  to_at text [null, note: 'Inclusive UTC ISO 8601 upper date bound']
  selected_count integer [not null, note: 'CHECK > 0; must equal the committed cleaning_plan_items count']
  locale text [not null, default: 'pt-BR', note: 'Presentation locale used for the reviewed dry-run']
  reviewed_at text [not null, note: 'UTC ISO 8601 timestamp when dry-run output was produced']
  created_at text [not null, note: 'UTC ISO 8601 timestamp']

  indexes {
    (account_id, created_at) [name: 'cleaning_plans_account_created_idx']
  }
}
```

### `cleaning_plan_types`

```dbml
Table cleaning_plan_types {
  plan_id text [not null, ref: > cleaning_plans.id]
  interaction_type text [not null, note: 'CHECK IN (POST, REPLY, REPOST, LIKE)']

  indexes {
    (plan_id, interaction_type) [pk, name: 'cleaning_plan_types_pk']
  }
}
```

### `cleaning_plan_items`

```dbml
Table cleaning_plan_items {
  plan_id text [not null, ref: > cleaning_plans.id]
  interaction_id integer [not null, ref: > interactions.id]
  sequence integer [not null, note: 'Stable 1-based order inside the immutable plan; CHECK > 0']
  created_at text [not null, note: 'UTC ISO 8601 timestamp']

  indexes {
    (plan_id, interaction_id) [pk, name: 'cleaning_plan_items_pk']
    (plan_id, sequence) [unique, name: 'cleaning_plan_items_sequence_uq']
    interaction_id [name: 'cleaning_plan_items_interaction_idx']
  }
}
```

### `cleaning_runs`

```dbml
Table cleaning_runs {
  id text [pk, not null, note: 'UUID']
  plan_id text [not null, unique, ref: > cleaning_plans.id, note: 'One resumable run per reviewed plan']
  account_id text [not null, ref: > managed_accounts.id]
  bound_handle text [not null, note: 'Explicitly confirmed handle without @']
  status text [not null, note: 'CHECK IN (PENDING, RUNNING, PAUSED, COMPLETED, FAILED, INTERRUPTED)']
  pause_reason text [null, note: 'Machine-readable reason category; no raw page content']
  started_at text [null, note: 'UTC ISO 8601 timestamp']
  paused_at text [null, note: 'UTC ISO 8601 timestamp']
  finished_at text [null, note: 'UTC ISO 8601 timestamp']
  created_at text [not null, note: 'UTC ISO 8601 timestamp']
  updated_at text [not null, note: 'UTC ISO 8601 timestamp']

  indexes {
    account_id [name: 'cleaning_runs_account_id_idx']
    status [name: 'cleaning_runs_status_idx']
    (account_id, created_at) [name: 'cleaning_runs_account_created_idx']
  }
}
```

### `run_batches`

```dbml
Table run_batches {
  id text [pk, not null, note: 'UUID; one explicitly confirmed run or resume invocation']
  run_id text [not null, ref: > cleaning_runs.id]
  requested_limit integer [null, note: 'Null means all currently eligible items; otherwise CHECK > 0']
  confirmed_at text [not null, note: 'UTC ISO 8601 timestamp; proves confirmation for this batch only']
  status text [not null, note: 'CHECK IN (RUNNING, COMPLETED, PAUSED, FAILED, INTERRUPTED)']
  started_at text [not null, note: 'UTC ISO 8601 timestamp']
  finished_at text [null, note: 'UTC ISO 8601 timestamp']
  created_at text [not null, note: 'UTC ISO 8601 timestamp']
  updated_at text [not null, note: 'UTC ISO 8601 timestamp']

  indexes {
    (run_id, created_at) [name: 'run_batches_run_created_idx']
    status [name: 'run_batches_status_idx']
  }
}
```

### `cleaning_run_items`

```dbml
Table cleaning_run_items {
  id integer [pk, increment, not null]
  run_id text [not null, ref: > cleaning_runs.id]
  interaction_id integer [not null, ref: > interactions.id]
  sequence integer [not null, note: 'Copied from the immutable plan item; CHECK > 0']
  status text [not null, default: 'PENDING', note: 'CHECK IN (PENDING, PROCESSING, COMPLETED, SKIPPED, FAILED, NOT_FOUND, ALREADY_REMOVED, UNAVAILABLE)']
  attempt_count integer [not null, default: 0, note: 'CHECK >= 0']
  processing_started_at text [null, note: 'UTC ISO 8601 timestamp; used to recover stale PROCESSING state']
  next_retry_at text [null, note: 'UTC ISO 8601 timestamp']
  completed_at text [null, note: 'UTC ISO 8601 timestamp for terminal states']
  last_error_code text [null, note: 'Sanitized machine-readable category']
  created_at text [not null, note: 'UTC ISO 8601 timestamp']
  updated_at text [not null, note: 'UTC ISO 8601 timestamp']

  indexes {
    (run_id, interaction_id) [unique, name: 'cleaning_run_items_run_interaction_uq']
    (run_id, sequence) [unique, name: 'cleaning_run_items_run_sequence_uq']
    (run_id, status, next_retry_at, sequence) [name: 'cleaning_run_items_scheduler_idx']
    interaction_id [name: 'cleaning_run_items_interaction_idx']
  }
}
```

### `interaction_attempts`

```dbml
Table interaction_attempts {
  id integer [pk, increment, not null]
  run_item_id integer [not null, ref: > cleaning_run_items.id]
  batch_id text [not null, ref: > run_batches.id, note: 'Links every real attempt to the separately confirmed batch that authorized it']
  attempt_number integer [not null, note: '1-based per run item; CHECK > 0']
  outcome text [not null, note: 'CHECK IN (COMPLETED, RETRYABLE_FAILURE, FAILED, NOT_FOUND, ALREADY_REMOVED, UNAVAILABLE, PAUSED)']
  retryable integer [not null, default: 0, note: 'SQLite boolean CHECK IN (0, 1)']
  duration_ms integer [not null, note: 'CHECK >= 0']
  error_code text [null, note: 'Sanitized machine-readable category']
  error_context_json text [null, note: 'Valid JSON object after secret and content redaction']
  started_at text [not null, note: 'UTC ISO 8601 timestamp']
  finished_at text [not null, note: 'UTC ISO 8601 timestamp']
  created_at text [not null, note: 'Append-only ledger timestamp; no updated_at column']

  indexes {
    (run_item_id, attempt_number) [unique, name: 'interaction_attempts_item_number_uq']
    batch_id [name: 'interaction_attempts_batch_id_idx']
    outcome [name: 'interaction_attempts_outcome_idx']
  }
}
```

### `run_checkpoints`

```dbml
Table run_checkpoints {
  id integer [pk, increment, not null]
  run_id text [not null, ref: > cleaning_runs.id]
  sequence integer [not null, note: 'Monotonic 1-based sequence per run; CHECK > 0']
  reason text [not null, note: 'CHECK IN (ITEM_COMMITTED, MANUAL_INTERRUPT, RATE_LIMIT, SECURITY_CHALLENGE, SESSION_EXPIRED, UNKNOWN_UI, FAILURE, COMPLETED)']
  last_run_item_sequence integer [null, note: 'Last safely committed run-item sequence']
  aggregate_counts_json text [not null, note: 'Valid JSON object with counts by lifecycle status']
  created_at text [not null, note: 'Append-only UTC ISO 8601 timestamp; no updated_at column']

  indexes {
    (run_id, sequence) [unique, name: 'run_checkpoints_run_sequence_uq']
    (run_id, created_at) [name: 'run_checkpoints_run_created_idx']
  }
}
```

### `generated_reports`

```dbml
Table generated_reports {
  id text [pk, not null, note: 'UUID']
  run_id text [not null, unique, ref: > cleaning_runs.id]
  relative_path text [not null, note: 'Path relative to the application data directory; never an absolute path']
  sha256 text [not null, note: 'Lowercase 64-character digest of the UTF-8 JSON report']
  summary_json text [not null, note: 'Valid privacy-safe JSON aggregate; no full content or secrets']
  generated_at text [not null, note: 'UTC ISO 8601 timestamp']
  created_at text [not null, note: 'UTC ISO 8601 timestamp']
  updated_at text [not null, note: 'UTC ISO 8601 timestamp when a report is regenerated']

  indexes {
    generated_at [name: 'generated_reports_generated_at_idx']
  }
}
```

## Modified Tables

None. The project has no existing application tables.

## Seed Data

None. Interaction types, statuses, outcomes, pause reasons, and import states are code enums persisted as constrained text values, not lookup tables.

## Relationships

| From | To | Cardinality | Purpose |
|---|---|---|---|
| `archive_imports.account_id` | `managed_accounts.id` | many-to-one, initially nullable | Associates a validated import with the single locally managed account. |
| `interactions.account_id` | `managed_accounts.id` | many-to-one | Prevents catalog records from being reused across accounts. |
| `interactions.first_seen_import_id` | `archive_imports.id` | many-to-one | Records the import that first inserted the interaction. |
| `interactions.last_seen_import_id` | `archive_imports.id` | many-to-one | Records the most recent import that confirmed or updated the interaction. |
| `cleaning_plans.account_id` | `managed_accounts.id` | many-to-one | Binds every reviewed selection to one account. |
| `cleaning_plans.catalog_cutoff_id` | `interactions.id` | many-to-one | Records the maximum catalog row visible when the plan snapshot was built. |
| `cleaning_plan_types.plan_id` | `cleaning_plans.id` | many-to-one | Stores the independently selected interaction types. |
| `cleaning_plan_items.plan_id` | `cleaning_plans.id` | many-to-one | Materializes the immutable dry-run selection. |
| `cleaning_plan_items.interaction_id` | `interactions.id` | many-to-one | Connects the snapshot to catalog interactions. |
| `cleaning_runs.plan_id` | `cleaning_plans.id` | one-to-one | Ensures one resumable execution per reviewed plan. |
| `cleaning_runs.account_id` | `managed_accounts.id` | many-to-one | Duplicates the security boundary for direct mismatch checks. |
| `run_batches.run_id` | `cleaning_runs.id` | many-to-one | Records every independently confirmed run/resume invocation. |
| `cleaning_run_items.run_id` | `cleaning_runs.id` | many-to-one | Stores durable lifecycle state for each selected interaction. |
| `cleaning_run_items.interaction_id` | `interactions.id` | many-to-one | Identifies the catalog target without copying content. |
| `interaction_attempts.run_item_id` | `cleaning_run_items.id` | many-to-one | Append-only attempt history for retries and audit. |
| `interaction_attempts.batch_id` | `run_batches.id` | many-to-one | Proves which explicit confirmation authorized each attempt. |
| `run_checkpoints.run_id` | `cleaning_runs.id` | many-to-one | Append-only resumability boundaries. |
| `generated_reports.run_id` | `cleaning_runs.id` | one-to-one | Tracks the current local JSON report for a run. |

All domain relationships use restrictive deletion by default. Deleting an account, import, plan, or run is a separate explicit local-data maintenance operation and must not cascade silently through sensitive history.

## Existing Tables Read

None. There is no existing application database. `schema_migrations` is read only by the migration runner to determine the next unapplied version.

## Tables Written

| Table | When | Data written |
|---|---|---|
| `schema_migrations` | After a migration transaction succeeds | Migration version, name, and application timestamp. |
| `managed_accounts` | Archive identity discovery and explicit browser account confirmation | Stable user ID when available, archive handle, confirmed handle, confirmation timestamp. |
| `archive_imports` | Every ZIP or directory import attempt | Safe source identity, adapter, lifecycle, counts, and sanitized failure category. |
| `interactions` | Successful import transaction | Deduplicated normalized interaction metadata and first/last-seen imports. |
| `cleaning_plans` | Successful non-empty dry-run | Immutable account, catalog boundary, filters, locale, counts, and review timestamp. |
| `cleaning_plan_types` | In the same dry-run transaction | Selected interaction types. |
| `cleaning_plan_items` | In the same dry-run transaction | Exact immutable interaction snapshot and stable order. |
| `cleaning_runs` | First authorized execution and every run state change | Bound account handle, lifecycle, pause reason, and timestamps. |
| `run_batches` | Every separately confirmed `run` or `resume` invocation | Requested limit, confirmation time, lifecycle, and timestamps. |
| `cleaning_run_items` | Run creation, scheduling, recovery, and normalized engine result | Per-interaction lifecycle, attempt count, retry time, terminal time, sanitized last error. |
| `interaction_attempts` | Atomically with every completed engine attempt | Confirmed batch, outcome, retryability, timing, and redacted diagnostics. This is append-only. |
| `run_checkpoints` | After an item commit and at every pause, interruption, failure, or completion boundary | Monotonic checkpoint, reason, last safe sequence, and aggregate counts. This is append-only. |
| `generated_reports` | Completion, pause, interruption, failure, or explicit report regeneration | Local relative path, checksum, and privacy-safe aggregate summary. |

## Fields Never Exported / Never Exposed

| Field or local artifact | Treatment |
|---|---|
| `interactions.content_preview` | Never written to logs or JSON reports by default; terminal detail views must truncate to at most 80 Unicode characters and require an explicit item-inspection command. |
| `interactions.source_relative_path` | Omitted from reports; diagnostic terminal output may show only the archive-relative path, never an absolute host path. |
| `archive_imports.source_label` | Omitted from reports by default; logs may include the safe basename but never the original absolute path. |
| `managed_accounts.confirmed_handle` and `archive_handle` | Displayed as `@handle` only during local account confirmation and explicit status/report commands; structured logs use `@ab***yz` when the handle has six or more characters, otherwise `@[redacted]`. |
| `interaction_attempts.error_context_json` | Must pass redaction before insert; password, cookie, authorization, CSRF, session, email, full content, and raw HTML values are omitted rather than masked. |
| `generated_reports.relative_path` | Stored relative to the application data directory; reports never contain the absolute application data path. |
| X interaction identifiers | Allowed in the local database and structured attempt logs for recovery; omitted from aggregate JSON reports unless a future explicit diagnostic export is separately specified. |
| Browser profile, cookies, local storage, tokens | Never read into this schema, never logged, and never exported. They remain opaque files managed inside the dedicated Playwright profile. |
| Destructive confirmation input | Never persisted. Only `run_batches.confirmed_at` records that exact confirmation succeeded. |

## Notes / Performance

- SQLite foreign keys are enabled for every connection. Extension loading is disabled and defensive mode remains enabled.
- All status, type, outcome, source-kind, and checkpoint-reason constraints are enforced with SQLite `CHECK` clauses in migrations and mirrored by TypeScript enums at the adapter boundary.
- All timestamps are UTC ISO 8601 text. IDs received from X are decimal strings. Internal high-volume row IDs use SQLite integer primary keys.
- Archive import uses bounded streaming reads and batched transactions; ZIP entries are validated before content parsing. A failed import transaction must not expose partial interaction writes.
- The `(account_id, type, x_interaction_id)` unique index is the idempotency boundary for repeat imports.
- Dry-run creates `cleaning_plans`, `cleaning_plan_types`, and `cleaning_plan_items` in one transaction. `cleaning_plan_items` is the authoritative snapshot; `catalog_cutoff_id` is additional audit evidence and prevents accidental query broadening.
- Run creation copies plan items into `cleaning_run_items` in one transaction. Scheduling reads use the `cleaning_run_items_scheduler_idx` index and always page in bounded chunks; no executor query loads the complete interaction history into memory.
- The executor is sequential in V1. `run_batches.requested_limit` bounds one confirmed invocation, while the persistent run remains resumable until every eligible item reaches a terminal state.
- The application-data filesystem lock is authoritative for the single active destructive executor. It is intentionally not modeled as a database row because stale-process ownership and atomic lock acquisition are filesystem concerns.
- `interaction_attempts` and `run_checkpoints` are append-only ledgers and intentionally have no `updated_at`. Corrections are new rows, not mutation of history.
- A completed engine attempt, the corresponding `cleaning_run_items` transition, and its item checkpoint are committed in one SQLite transaction before the next interaction is scheduled.
- SQLite uses a configured busy timeout. WAL mode may be enabled after cross-platform filesystem tests; the application must not assume WAL is safe on network-mounted data directories.
- Catalog and run status views use indexed aggregate queries. Human-facing lists are paginated; aggregate counts may scan all matching index entries because accounts with tens of thousands of interactions are an explicit V1 requirement.
- Exact X Archive field compatibility remains provisional until the owner's real archive is available. Parser adapters may change, but they must continue writing this normalized schema rather than leaking archive-specific fields into Core.
