# Project Phases — X Cleaner V1

<!-- inputs: feature-description.md@sha256:dd940ac58690 user-stories.md@sha256:dc6892d3c5d3 database-schema.md@sha256:d6e39f6d7315 -->

## Phase 1: Bootstrap the private local-first CLI

**Goal:** Establish a strict TypeScript project whose first working command reports the private local workspace without contacting X.

**Read first:** `feature-description.md` next to this file, sections "Overview", "Data & Format Decisions", and "PII Rules".

**Do not touch in this phase:** `x-cleaner-brief.md`, `LICENSE`, GitHub repository visibility, X, any real archive, or any browser profile. Do not add telemetry, analytics, a remote backend, or a password input.

**Conventions here, to follow rather than "fix":** Node.js 24 LTS, ESM, TypeScript strict mode, npm lockfile, Commander commands built by factories, Vitest 4 in Node environment, Portuguese strings behind message keys, and production code under `src/`.

No real user data is available or permitted in tests. Temporary directories must be created per test and removed afterward.

**This phase has exactly 8 tasks.** Emit one verdict line per task, numbered 1 to 8 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `package.json` and `package-lock.json` define a private ESM package named `x-cleaner`, require Node `>=24`, expose `x-cleaner` from `dist/cli.js`, and include pinned compatible releases of Commander, Playwright, `@zip-js/zip-js`, TypeScript, Vitest 4, V8 coverage, ESLint, typescript-eslint, Prettier, and `tsx`; scripts include `build`, `dev`, `test`, `test:coverage`, `lint`, `format:check`, `typecheck`, and `check`.
- [ ] `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, and `.prettierrc.json` enforce ESM, strict TypeScript, Node test environment, automatic mock restoration, V8 coverage, and exclusions for generated/private artifacts.
- [ ] `.gitignore` and `.npmignore` exclude `.harness/`, `node_modules/`, `dist/`, coverage, environment files, X Archive ZIPs/extracted directories, SQLite files and journals, browser profiles, cookies, logs, reports, screenshots, traces, videos, and the runtime application-data directory while keeping synthetic fixtures eligible for versioning.
- [ ] `AGENTS.md` records the stack, architecture boundaries, npm verification commands, Portuguese-first localization rule, synthetic-fixture rule, prohibition on real destructive execution without user authorization, and the fact that repository visibility stays private until explicit owner approval.
- [ ] `src/platform/application-data.ts` resolves macOS, Linux, and Windows per-user application-data roots and an explicit `--data-dir` override without using the repository as runtime storage.
- [ ] `src/i18n/catalog.ts`, `src/i18n/pt-BR.ts`, and `src/i18n/translator.ts` provide stable message keys, a complete Portuguese default catalog, parameter interpolation, and a test-injectable catalog boundary; persisted domain values never depend on translated text.
- [ ] `src/cli/create-program.ts`, `src/cli/dependencies.ts`, `src/cli/commands/status.ts`, and `src/cli.ts` construct a local Commander instance, use `parseAsync`, inject output/dependencies, support global `--data-dir`, and make `x-cleaner status` print the resolved data directory and local-only notice without a network request.
- [ ] `tests/unit/platform/application-data.test.ts`, `tests/unit/i18n/translator.test.ts`, and `tests/integration/cli/status-command.test.ts` assert platform path resolution, data-directory isolation, translation substitution, Portuguese status output, and absence of network access.
  - Automated tests to generate:
    - `tests/unit/platform/application-data.test.ts` — default and override paths for macOS, Linux, and Windows (US-1.1, US-1.2, US-9.3)
    - `tests/unit/i18n/translator.test.ts` — Portuguese defaults and injected alternative catalog without domain coupling (US-9.1, US-9.2)
    - `tests/integration/cli/status-command.test.ts` — local-only first-run status and no network calls (US-1.1, US-11.1)

**Completion criteria:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm run build` pass. `x-cleaner status --data-dir <temp>` prints Portuguese local-only guidance. No runtime/private artifact is tracked, and no real X access exists.

---

## Phase 2: Create the SQLite schema and domain vocabulary

**Goal:** Materialize the complete versioned SQLite schema and language-neutral domain types required by every later phase.

**Read first:** `database-schema.md` next to this file, sections "New Tables", "Relationships", and "Notes / Performance"; `feature-description.md`, section "Business Rules".

**Do not touch in this phase:** CLI workflow beyond connection bootstrapping, archive parsing, Playwright, GitHub visibility, or destructive execution. Do not replace constrained text values with lookup tables or store browser credentials in SQLite.

**Conventions here, to follow rather than "fix":** use built-in `node:sqlite`, foreign keys enabled, extensions disabled, defensive mode enabled, UUID text public IDs, integer internal high-volume IDs, ISO 8601 UTC text timestamps, and one-way numbered migrations under `src/infrastructure/database/migrations/`.

Every database test uses a fresh temporary database and never the user's application data directory.

**This phase has exactly 8 tasks.** Emit one verdict line per task, numbered 1 to 8 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/domain/interaction.ts`, `src/domain/plan.ts`, `src/domain/run.ts`, and `src/domain/result.ts` define the exact language-neutral types, statuses, outcomes, pause reasons, and transition guards listed in `database-schema.md`; X identifiers are branded decimal strings rather than numbers.
- [ ] `src/infrastructure/database/database.ts` wraps `DatabaseSync`, enables foreign keys, defensive settings and a busy timeout, exposes explicit transaction boundaries, and never enables extension loading.
- [ ] `src/infrastructure/database/migrator.ts` and `src/infrastructure/database/migrations/index.ts` apply pending numbered migrations atomically and record successful versions in `schema_migrations` without editing applied migrations.
- [ ] `src/infrastructure/database/migrations/001_catalog.ts` creates `managed_accounts`, `archive_imports`, and `interactions` with every constraint and index specified in `database-schema.md`.
- [ ] `src/infrastructure/database/migrations/002_plans.ts` creates `cleaning_plans`, `cleaning_plan_types`, and `cleaning_plan_items` with immutable snapshot constraints and indexes.
- [ ] `src/infrastructure/database/migrations/003_runs.ts` creates `cleaning_runs`, `run_batches`, and `cleaning_run_items` with account binding, batch confirmation evidence, lifecycle checks, and scheduler indexes.
- [ ] `src/infrastructure/database/migrations/004_audit.ts` creates append-only `interaction_attempts`, append-only `run_checkpoints`, and `generated_reports` without adding credential/session columns.
- [ ] `tests/unit/domain/state-transitions.test.ts` and `tests/integration/database/schema.test.ts` prove enum validation, allowed and forbidden state transitions, migration idempotency, all 13 tables, foreign keys, CHECK constraints, unique idempotency keys, indexes, and rollback of a failed migration.
  - Automated tests to generate:
    - `tests/unit/domain/state-transitions.test.ts` — terminal, retryable, stale-processing, and forbidden transitions (US-7.1, US-7.2, US-7.3)
    - `tests/integration/database/schema.test.ts` — schema contract, migration rerun, account singleton, X ID string preservation, and constraint failures (US-1.2, US-2.3, US-4.3, US-10.1)

**Completion criteria:** all Phase 1 tests pass unmodified; if an earlier test needs editing, the phase changed established behavior and must be corrected. A fresh database migrates to version 4, a second migration run is a no-op, and schema introspection matches all 13 tables and required indexes in `database-schema.md`.

---

## Phase 3: Implement repositories, transactions, and the executor lock

**Goal:** Provide durable adapters for catalog, plan, run, audit, and report state plus exclusive destructive-process ownership.

**Read first:** `database-schema.md` next to this file, sections "Tables Written" and "Notes / Performance"; `feature-description.md`, rules BR-06, BR-12, BR-13, BR-14, and BR-22.

**Do not touch in this phase:** parser formats, BrowserEngine, CLI destructive prompts, X, or repository visibility. Repositories may not expose raw SQL outside `src/infrastructure/database/`.

**Conventions here, to follow rather than "fix":** domain-facing repository ports live in `src/application/ports/`; SQLite implementations live in `src/infrastructure/database/repositories/`; multi-table writes accept an existing transaction; filesystem locking is authoritative and is not represented as a database row.

Tests must use deterministic clocks/UUIDs and per-test temporary directories.

**This phase has exactly 7 tasks.** Emit one verdict line per task, numbered 1 to 7 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/application/ports/catalog-repository.ts` and `src/infrastructure/database/repositories/sqlite-catalog-repository.ts` implement managed-account, import, and interaction writes, including `(account_id,type,x_interaction_id)` upsert and first/last-seen import tracking.
- [ ] `src/application/ports/plan-repository.ts` and `src/infrastructure/database/repositories/sqlite-plan-repository.ts` create and read plan/type/item snapshots atomically, preserve stable sequence, and never mutate a committed plan.
- [ ] `src/application/ports/run-repository.ts` and `src/infrastructure/database/repositories/sqlite-run-repository.ts` create a single run per plan, materialize run items, create separately confirmed batches, page eligible work by indexed scheduler order, and recover stale processing state.
- [ ] `src/application/ports/audit-repository.ts`, `src/application/ports/report-repository.ts`, and their SQLite adapters append attempts/checkpoints and upsert generated-report metadata without exposing content previews or secrets.
- [ ] `src/infrastructure/database/unit-of-work.ts` commits an attempt, run-item transition, aggregate checkpoint, batch/run status changes, and retry scheduling in one transaction and rolls all of them back on failure.
- [ ] `src/infrastructure/lock/executor-lock.ts` acquires an atomic per-data-directory lock with process metadata, rejects a second writer, supports safe stale-lock diagnosis without automatic destructive takeover, and leaves read-only status access available.
- [ ] Repository and lock integration tests cover deduplication, immutable plans, one run per plan, bounded paging, atomic rollback, append-only ledgers, separate batch confirmations, and concurrent lock rejection.
  - Automated tests to generate:
    - `tests/integration/database/catalog-repository.test.ts` — insert/reuse/update counts and account isolation (US-2.1, US-2.3)
    - `tests/integration/database/plan-repository.test.ts` — exact immutable snapshot and post-import stability (US-3.3, US-3.4)
    - `tests/integration/database/run-repository.test.ts` — run materialization, terminal skipping, stale recovery, batch limits (US-5.2, US-7.2, US-7.3)
    - `tests/integration/database/unit-of-work.test.ts` — result, attempt, checkpoint atomicity and rollback (US-7.1)
    - `tests/integration/lock/executor-lock.test.ts` — second writer rejected while status stays readable (US-1.3)

**Completion criteria:** all earlier tests pass unmodified. Repository tests prove idempotency and transaction boundaries against real temporary SQLite files, and no adapter reads or writes outside the supplied data directory.

---

## Phase 4: Parse extracted X Archives into the catalog

**Goal:** Import supported interactions from a synthetic extracted X Archive through a content-detected, adapter-based parser.

**Read first:** `feature-description.md` next to this file, sections "System Context", "Data & Format Decisions", and "Accepted Constraints and Validation Risks"; `user-stories.md`, stories US-2.1 through US-2.5.

**Do not touch in this phase:** ZIP handling, BrowserEngine, cleaning plans, real archives, or destructive commands. Never commit copied fragments from the owner's future archive.

**Conventions here, to follow rather than "fix":** archive ports live in `src/application/ports/archive-source.ts`; adapters live in `src/infrastructure/archive/adapters/`; fixtures under `tests/fixtures/x-archive/` are synthetic and contain documented fake IDs/text only; archive input is read-only.

The real current Archive format is not yet available. Compatibility claims must remain limited to committed synthetic variants until manual validation.

**This phase has exactly 8 tasks.** Emit one verdict line per task, numbered 1 to 8 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/application/ports/archive-source.ts` and `src/infrastructure/archive/directory-archive-source.ts` expose normalized relative entry names and bounded text streams while rejecting symlinks and paths that resolve outside the selected directory.
- [ ] `src/infrastructure/archive/ytd/javascript-assignment-decoder.ts` extracts JSON arrays from supported `window.YTD... = ...` wrappers without evaluating JavaScript and rejects executable or trailing non-data content.
- [ ] `src/infrastructure/archive/archive-detector.ts` selects adapters from content evidence rather than a single fixed root/file name and returns a clear unsupported-archive error when required evidence is absent.
- [ ] `src/infrastructure/archive/ytd/account-parser.ts` extracts stable account ID and handle when available without making either up or converting numeric IDs to JavaScript numbers.
- [ ] `src/infrastructure/archive/ytd/tweet-parser.ts` normalizes synthetic tweet records, classifies original posts, replies, and reposts using explicit archive evidence, preserves missing dates as null, and limits optional local content previews to 280 Unicode characters.
- [ ] `src/infrastructure/archive/ytd/like-parser.ts` normalizes synthetic like records as `LIKE`, reconstructs only supported identifiers, and leaves unreliable dates null.
- [ ] `src/application/import/import-archive.ts` validates the directory source, creates an import record, streams normalized batches into the catalog, updates insert/reuse/update counts, commits successful imports atomically, and records sanitized failure categories without partial interactions.
- [ ] Synthetic fixtures and tests cover directory import, four-type classification, decimal-string IDs, missing dates, empty valid archives, malformed wrappers, unsupported archives, read-only source bytes, and repeat-import deduplication.
  - Automated tests to generate:
    - `tests/unit/archive/javascript-assignment-decoder.test.ts` — data-only decoding and executable/trailing input rejection (US-2.4)
    - `tests/unit/archive/ytd-parsers.test.ts` — account, post, reply, repost, like, null date, and preview limits (US-2.1, US-2.5)
    - `tests/integration/import/directory-import.test.ts` — immutable source, counts, empty success, transaction rollback, and repeat import (US-2.2, US-2.3, US-2.4, US-2.5)

**Completion criteria:** all earlier tests pass unmodified. A synthetic extracted archive imports all four interaction types, a repeated import creates no duplicates, invalid input leaves no partial catalog rows, and no JavaScript from an archive is evaluated.

---

## Phase 5: Add safe ZIP import and tolerant archive discovery

**Goal:** Accept large ZIP/Zip64 archives without unsafe extraction while preserving the directory-import contract.

**Read first:** `feature-description.md` next to this file, section "Data & Format Decisions"; `database-schema.md`, section "Notes / Performance".

**Do not touch in this phase:** normalized domain rules, plan/run tables, browser code, or real account data. ZIP entries must never be written to arbitrary filesystem paths.

**Conventions here, to follow rather than "fix":** use `@zip-js/zip-js` entry metadata and streams; normalize and validate every filename before reading content; set explicit limits for entry count, per-entry uncompressed size, total relevant uncompressed bytes, and appended archive data.

Tests generate ZIPs from synthetic fixtures at runtime and include traversal, encrypted, symlink, oversized, and malformed cases.

**This phase has exactly 6 tasks.** Emit one verdict line per task, numbered 1 to 6 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/infrastructure/archive/zip-archive-source.ts` implements the archive-source port with Zip.js, supports Zip64 entry metadata and bounded streams, closes readers on every path, and never extracts the archive wholesale.
- [ ] `src/infrastructure/archive/zip-entry-policy.ts` rejects absolute paths, drive-prefixed paths, traversal after normalization, symlinks, encrypted entries, duplicate normalized names, forbidden ambiguity, excessive entry counts, and configured compressed/uncompressed limits before parser consumption.
- [ ] `src/infrastructure/archive/source-fingerprint.ts` calculates a streaming SHA-256 for ZIPs and a deterministic relative-path/content manifest digest for directories without storing absolute paths.
- [ ] `src/infrastructure/archive/archive-detector.ts` recognizes supported files below variable top-level archive folders and minor known filename variations while still requiring content evidence from the YTD adapter.
- [ ] `src/application/import/import-archive.ts` accepts ZIP or directory sources through the same port, persists `source_kind`, safe label, digest, adapter, counts, and sanitized failures, and produces equivalent catalogs for equivalent inputs.
- [ ] ZIP integration tests prove equivalence, immutable ZIP bytes, Zip64 metadata handling, traversal prevention, limits, reader cleanup, safe failure, and no filesystem extraction artifacts.
  - Automated tests to generate:
    - `tests/unit/archive/zip-entry-policy.test.ts` — traversal, absolute/drive paths, symlink, encryption, duplication, ambiguity, and size limits (US-2.4)
    - `tests/integration/import/zip-import.test.ts` — ZIP/directory equivalence, safe hashing, immutable bytes, cleanup, and four-type counts (US-2.1, US-2.2, US-2.3)

**Completion criteria:** all earlier tests pass unmodified. The same synthetic archive imported as directory and ZIP produces the same normalized catalog, hostile entries cannot escape or be read, and no extracted archive tree remains on disk.

---

## Phase 6: Deliver status, filters, and immutable dry-runs

**Goal:** Let the owner inspect the catalog and save an exact reviewed cleaning plan without invoking a browser mutation.

**Read first:** `feature-description.md` next to this file, rules BR-03, BR-07, BR-08; `user-stories.md`, section "Analysis, selection, and dry-run".

**Do not touch in this phase:** browser session, destructive confirmation, run execution, retries, or X. Dry-run must have no dependency on a cleaner engine.

**Conventions here, to follow rather than "fix":** filters are domain values in `src/domain/selection.ts`; dates are inclusive ISO inputs normalized to UTC; plan creation materializes exact items and a catalog cutoff in one transaction.

CLI tests inject input/output and repository dependencies; they never spawn a browser.

**This phase has exactly 7 tasks.** Emit one verdict line per task, numbered 1 to 7 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/domain/selection.ts` validates one or more supported types, inclusive `from`/`to` boundaries, invalid dates, inverted ranges, and empty selections with machine-readable error codes.
- [ ] `src/application/catalog/get-catalog-status.ts` returns aggregate counts by interaction type and lifecycle context without loading content previews.
- [ ] `src/application/plans/create-cleaning-plan.ts` resolves the filters against one account, records the highest catalog row boundary, persists types and exact ordered items atomically, and rejects zero selected items.
- [ ] `src/cli/commands/import.ts` exposes `x-cleaner import <path>` and prints Portuguese adapter, inserted/reused/updated, per-type, total, empty, and sanitized validation outcomes.
- [ ] `src/cli/commands/status.ts` reads migrated state and prints import/account/catalog counts by type without full interaction content.
- [ ] `src/cli/commands/dry-run.ts` exposes repeatable `--type`, inclusive `--from`, and `--to`, prints a prominent `SIMULAÇÃO` no-mutation notice and exact counts, and returns the immutable plan ID.
- [ ] Domain, application, and CLI tests prove filter validation, exact selection, catalog cutoff behavior after later import, empty-plan refusal, Portuguese output, and zero cleaner-engine/browser calls.
  - Automated tests to generate:
    - `tests/unit/domain/selection.test.ts` — supported types, date bounds, invalid/inverted dates, and empty filters (US-3.2)
    - `tests/integration/plans/create-cleaning-plan.test.ts` — exact snapshot and later-import exclusion (US-3.3, US-3.4)
    - `tests/integration/cli/import-status-dry-run.test.ts` — import/status output, empty behavior, Portuguese simulation, no engine call (US-2.1, US-2.5, US-3.1, US-3.3, US-9.1)

**Completion criteria:** all earlier tests pass unmodified. The CLI imports both source kinds, reports catalog counts, validates filters, and creates a non-empty immutable plan; tests prove dry-run cannot invoke any browser mutation.

---

## Phase 7: Manage the visible authenticated browser session

**Goal:** Open a dedicated visible Playwright profile for manual X login, detect the account, confirm it, and clear only session data.

**Read first:** `feature-description.md` next to this file, rules BR-02 and BR-10 plus sections "UI" and "PII Rules".

**Do not touch in this phase:** deletion/undo/unlike controls, execution tables, normal Chrome profiles, headless default behavior, password fields, screenshots, traces, videos, or security-challenge bypass.

**Conventions here, to follow rather than "fix":** browser code lives under `src/infrastructure/browser/`; selectors prefer roles, semantic attributes, stable URLs, and documented `data-testid`; page evidence is isolated behind page objects; real-X tests are never part of automated CI.

Automated browser tests use local synthetic HTML fixtures only. No test logs in to X.

**This phase has exactly 7 tasks.** Emit one verdict line per task, numbered 1 to 7 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/infrastructure/browser/browser-context-factory.ts` launches a visible persistent Chromium context in the dedicated application-data profile, uses no everyday browser profile, and disables screenshot, trace, and video capture by default.
- [ ] `src/infrastructure/browser/x/account-page.ts` detects authenticated handle and stable user ID when available from supported semantic page evidence and returns explicit unauthenticated, unknown-state, or security-challenge outcomes rather than guessing.
- [ ] `src/application/session/login-session.ts` opens the official X login/home flow, waits for manual authentication, records no password or cookie, and returns the detected account for confirmation.
- [ ] `src/application/session/confirm-account.ts` normalizes the handle, enforces the one-account-per-data-directory boundary, persists explicit confirmation, and rejects archive/browser identity conflicts without destructive side effects.
- [ ] `src/application/session/clear-session.ts` removes only the dedicated browser-profile subtree after confirmation and leaves SQLite, archives, logs, checkpoints, and reports intact.
- [ ] `src/cli/commands/session.ts` provides `x-cleaner session login`, `status`, and `clear` with Portuguese privacy guidance, explicit account confirmation, and no password option or prompt.
- [ ] Local-page BrowserEngine and CLI tests prove visible-profile options, disabled media, detection, rejection, identity mismatch, expired/unknown state, and session-only clearing.
  - Automated tests to generate:
    - `tests/unit/browser/browser-context-factory.test.ts` — dedicated profile, headed mode, and disabled media defaults (US-4.1, US-8.4)
    - `tests/integration/browser/account-page.test.ts` — authenticated, unauthenticated, challenge, and unknown local fixtures (US-4.2, US-11.2, US-11.3)
    - `tests/integration/cli/session-command.test.ts` — login guidance, confirmation/rejection, mismatch, no password surface, and scoped clear (US-4.1, US-4.2, US-4.3, US-4.4)

**Completion criteria:** all earlier tests pass unmodified. Automated tests use only local pages; the dedicated profile is isolated, capture is off by default, the password is absent from every CLI option/prompt, and session clearing preserves all non-session local state.

---

## Phase 8: Build the safe execution core with a fake engine

**Goal:** Enforce reviewed-plan, account, confirmation, batch-limit, lock, and durable scheduling rules independently of Playwright.

**Read first:** `feature-description.md` next to this file, rules BR-07 through BR-14 and BR-22; `database-schema.md`, tables `cleaning_runs`, `run_batches`, and `cleaning_run_items`.

**Do not touch in this phase:** real X selectors/actions, retry/backoff policy, terminal reporting polish, or repository visibility. No fake-engine success may be presented as real account validation.

**Conventions here, to follow rather than "fix":** application orchestration lives under `src/application/runs/`; ports include `CleanerEngine`, `Prompt`, `Clock`, and `Delay`; exact destructive phrase is `APAGAR`; every run/resume invocation creates a separately confirmed batch.

Tests call Core directly as well as the CLI so safety cannot live only in prompts.

**This phase has exactly 8 tasks.** Emit one verdict line per task, numbered 1 to 8 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/application/ports/cleaner-engine.ts` defines per-interaction execution and normalized success, terminal non-error, retryable failure, permanent failure, session-expired, challenge/rate-limit, and unknown-UI outcomes without importing Playwright.
- [ ] `tests/support/fake-cleaner-engine.ts`, `tests/support/fake-prompt.ts`, `tests/support/fake-clock.ts`, and `tests/support/fake-delay.ts` provide deterministic test doubles with recorded calls and configured outcomes.
- [ ] `src/application/runs/create-run.ts` requires a reviewed non-empty plan and matching explicitly confirmed account, creates one run per plan, and materializes ordered run items atomically.
- [ ] `src/application/runs/confirm-batch.ts` displays type/total counts and bound handle through the prompt port, accepts only exact `APAGAR`, persists only successful confirmation time, and supports a positive optional limit.
- [ ] `src/application/runs/select-next-item.ts` returns only pending or eligible retryable items in stable sequence, never schedules terminal states, and respects the separately confirmed batch limit.
- [ ] `src/application/runs/execute-batch.ts` acquires the executor lock, marks one item processing, invokes the engine sequentially, atomically persists normalized terminal results/checkpoints, and releases the lock on every exit path.
- [ ] `src/cli/commands/run.ts` and `src/cli/commands/resume.ts` expose plan/run IDs and `--limit`, recheck the current account before confirmation, print the irreversible warning, and contain no confirmation bypass flag.
- [ ] Core and CLI tests prove every precondition, exact phrase, cancellation variants, one-item limit, new confirmation per later batch, account mismatch, second-executor rejection, sequential calls, and terminal-state skipping with the fake engine.
  - Automated tests to generate:
    - `tests/unit/runs/safety-preconditions.test.ts` — direct Core rejection for every missing safety gate (US-5.1, US-5.3)
    - `tests/integration/runs/fake-engine-execution.test.ts` — materialization, sequential persistence, terminal outcomes, limit and resume (US-5.2, US-6.5, US-7.1, US-7.3, US-10.1)
    - `tests/integration/cli/run-command.test.ts` — warning, handle, exact `APAGAR`, cancellation, mismatch, and no bypass (US-4.3, US-5.1, US-5.2)

**Completion criteria:** all earlier tests pass unmodified. Fake-engine execution cannot start without all Core preconditions, `--limit 1` produces at most one call, and each subsequent batch has independent confirmation evidence.

---

## Phase 9: Delete posts and replies through BrowserEngine

**Goal:** Implement conservative, evidence-based post/reply deletion behind the cleaner-engine contract.

**Read first:** `feature-description.md` next to this file, rules BR-15, BR-18, and BR-21; `user-stories.md`, US-6.1, US-6.2, US-6.5, and US-11.2.

**Do not touch in this phase:** repost/unlike flows, timeline crawling, account passwords, API endpoints, CAPTCHA handling, retries, or Core safety gates. Never click a destructive control unless the target identity and expected flow are proven.

**Conventions here, to follow rather than "fix":** stable URL construction and selectors live in `src/infrastructure/browser/x/`; operation page objects return evidence, while `browser-cleaner-engine.ts` alone maps evidence to Core outcomes.

Automated tests use local deterministic HTML routes mirroring only the semantic states required by the flow; no selectors may depend on generated CSS class names or fixed DOM depth.

**This phase has exactly 6 tasks.** Emit one verdict line per task, numbered 1 to 6 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/infrastructure/browser/x/interaction-url.ts` reconstructs supported status URLs from validated decimal-string IDs and the confirmed handle without accepting arbitrary schemes, hosts, or paths.
- [ ] `src/infrastructure/browser/x/post-page.ts` proves the loaded status identity and author, finds delete controls through semantic evidence, handles the confirmation dialog, and reports deleted, missing, unavailable, unauthenticated, challenge, or unknown states without speculative clicks.
- [ ] `src/infrastructure/browser/x/selectors.ts` centralizes documented URL, role, text-key, and stable attribute candidates for account and post flows; no Core/archive/CLI file contains X selectors.
- [ ] `src/infrastructure/browser/browser-cleaner-engine.ts` implements `POST` and `REPLY` by delegating to `PostPage`, maps page evidence to normalized outcomes, and makes no distinction that would allow excluded `POST` items into a reply-only plan.
- [ ] `src/cli/dependencies.ts` wires BrowserEngine only for confirmed real `run`/`resume` commands; import, status, dry-run, and report construction do not launch Playwright.
- [ ] Browser contract tests prove successful post/reply deletion, category isolation, already-removed/not-found/unavailable mapping, author/ID mismatch stop, expired session, challenge, and unknown-state no-click behavior.
  - Automated tests to generate:
    - `tests/unit/browser/interaction-url.test.ts` — safe X URL construction and hostile input rejection (US-6.1, US-11.2)
    - `tests/integration/browser/post-page.test.ts` — semantic delete flow and every evidence outcome against local pages (US-6.1, US-6.2, US-6.5, US-11.2, US-11.3)
    - `tests/integration/browser/browser-engine-posts.test.ts` — contract mapping and type isolation (US-6.1, US-6.2, US-10.2)

**Completion criteria:** all earlier tests pass unmodified. Local-browser tests prove correct post/reply actions and that identity mismatch or unknown UI causes zero destructive clicks. No automated test contacts X.

---

## Phase 10: Undo reposts and remove likes

**Goal:** Complete BrowserEngine support for the remaining V1 interaction types without using third-party content deletion.

**Read first:** `user-stories.md` next to this file, US-6.3 and US-6.4; `feature-description.md`, rule BR-21.

**Do not touch in this phase:** post deletion behavior, archive parsers, Core safety gates, timeline crawling, or retries. A repost must never call the third-party original post deletion flow.

**Conventions here, to follow rather than "fix":** reuse identity proof and semantic outcome patterns from `post-page.ts`; keep action-specific behavior in separate page objects and selectors centralized.

Automated tests use local HTML routes and assert exact clicked semantic controls.

**This phase has exactly 5 tasks.** Emit one verdict line per task, numbered 1 to 5 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/infrastructure/browser/x/repost-page.ts` proves target identity, invokes only the undo-repost flow, and distinguishes completed, already removed, unavailable, unauthenticated, challenge, and unknown states.
- [ ] `src/infrastructure/browser/x/like-page.ts` proves target identity, invokes the unlike control at most once per engine call, and distinguishes completed, already removed, unavailable, unauthenticated, challenge, and unknown states.
- [ ] `src/infrastructure/browser/x/selectors.ts` contains the semantic repost and like candidates; page objects contain no generated CSS classes or positional selectors.
- [ ] `src/infrastructure/browser/browser-cleaner-engine.ts` delegates `REPOST` and `LIKE` to their page objects, maps normalized outcomes, and never routes a repost through post deletion.
- [ ] Browser contract tests cover success, already removed, missing/unavailable, identity mismatch, session loss, challenge, unknown no-click, and explicit proof that repost handling never clicks delete-post.
  - Automated tests to generate:
    - `tests/integration/browser/repost-page.test.ts` — undo-only semantic flow and all safe outcomes (US-6.3, US-6.5, US-11.2)
    - `tests/integration/browser/like-page.test.ts` — single unlike action and all safe outcomes (US-6.4, US-6.5, US-11.2)
    - `tests/integration/browser/browser-engine-reactions.test.ts` — contract mapping and prohibition on third-party deletion (US-6.3, US-6.4, US-10.2)

**Completion criteria:** all earlier tests pass unmodified. BrowserEngine supports all four V1 types against local fixtures; repost tests prove the delete-post control is untouched, and unknown states pause rather than guess.

---

## Phase 11: Add bounded retries, checkpoints, and safe interruption

**Goal:** Make long-running real executions recoverable across transient failures, security pauses, session expiry, crashes, and Ctrl+C.

**Read first:** `feature-description.md` next to this file, rules BR-12 through BR-19; `database-schema.md`, tables `interaction_attempts` and `run_checkpoints`.

**Do not touch in this phase:** selector semantics for successful actions, confirmation phrase, plan contents, or any evasion behavior. Retry policy must never retry CAPTCHA/security challenge or unknown destructive state automatically.

**Conventions here, to follow rather than "fix":** retry decisions are pure domain policy, delays use injected `Clock`/`Delay`, signals enter through one process adapter, and every pause writes a checkpoint before user guidance is printed.

Tests use fake time and signals; they do not sleep or send OS signals to unrelated processes.

**This phase has exactly 7 tasks.** Emit one verdict line per task, numbered 1 to 7 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/domain/retry-policy.ts` defines configured maximum attempts, conservative base delay, bounded progressive backoff, and non-retryable categories for permanent failure, unknown UI, rate limit without safe retry time, CAPTCHA, suspicious login, and session expiry.
- [ ] `src/application/runs/execute-batch.ts` records every completed attempt, schedules eligible retries with injected delay, stops at the batch limit, and persists `FAILED` after exhaustion without looping indefinitely.
- [ ] `src/application/runs/recover-run.ts` converts only stale uncommitted `PROCESSING` items to retryable pending state, preserves every committed terminal result, and writes a recovery checkpoint.
- [ ] `src/application/runs/pause-run.ts` maps rate limit, security challenge, session expiry, and unknown UI to distinct persisted pause reasons and stops scheduling before printing manual guidance.
- [ ] `src/platform/process-signals.ts` turns the first `SIGINT` into graceful scheduling stop and checkpoint flush, prints the exact resume command, and lets a second signal force exit without rewriting committed results.
- [ ] `src/cli/commands/resume.ts` recovers stale state, reacquires the lock, redetects and matches the account, creates a newly confirmed batch, and schedules only eligible items.
- [ ] Deterministic tests cover successful retry, backoff sequence, exhaustion, terminal skipping, stale recovery, every pause category, session restoration, first/second interrupt behavior, and at-most-one in-flight loss boundary.
  - Automated tests to generate:
    - `tests/unit/domain/retry-policy.test.ts` — limits, backoff, and never-retry categories (US-7.4, US-7.5)
    - `tests/integration/runs/recovery.test.ts` — stale processing, committed terminal preservation, and resume eligibility (US-7.1, US-7.2, US-7.3)
    - `tests/integration/runs/pause-and-session.test.ts` — rate limit, challenge, unknown UI, session expiry and restored-account check (US-7.5, US-11.2, US-11.3)
    - `tests/integration/runs/interrupt.test.ts` — graceful first interrupt, exact resume command, and forced second interrupt (US-7.6)

**Completion criteria:** all earlier tests pass unmodified. No retry test uses wall-clock sleep, retry count is bounded, security/unknown outcomes never retry automatically, and resume never schedules a committed terminal item.

---

## Phase 12: Add redacted logs, progress, and local reports

**Goal:** Make long runs understandable and auditable without leaking private content or authentication material.

**Read first:** `feature-description.md` next to this file, sections "Audit", "UI", and "PII Rules"; `database-schema.md`, section "Fields Never Exported / Never Exposed".

**Do not touch in this phase:** execution safety gates, browser selectors, archive source files, or capture defaults. Full post text, raw HTML, absolute archive paths, cookies, tokens, passwords, and email values may not enter logs or reports.

**Conventions here, to follow rather than "fix":** structured logs are UTF-8 NDJSON; reports are UTF-8 JSON with language-neutral keys; terminal summaries are localized; paths stored in SQLite remain relative to the data directory.

Tests use canary secrets and fail if any original canary appears in serialized output.

**This phase has exactly 7 tasks.** Emit one verdict line per task, numbered 1 to 7 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/infrastructure/logging/redactor.ts` recursively omits password, cookie, authorization, CSRF, session, email, raw HTML, and full-content fields and masks structured-log handles exactly as specified in `database-schema.md`.
- [ ] `src/infrastructure/logging/ndjson-logger.ts` writes the documented audit events as one UTF-8 JSON object per line under the data directory, rejects absolute output escape, and applies redaction before serialization.
- [ ] `src/application/progress/get-run-progress.ts` calculates indexed counts for completed, remaining, skipped, terminal non-error, failed, paused, and retry states without reading content previews.
- [ ] `src/cli/progress-renderer.ts` presents concise Portuguese per-type/total progress and never prints full content by default.
- [ ] `src/application/reports/generate-run-report.ts` builds language-neutral aggregate reports for completed, failed, paused, and interrupted runs with timestamps, counts, state, and sanitized failure summaries.
- [ ] `src/infrastructure/reports/json-report-writer.ts` atomically writes UTF-8 JSON, records relative path and SHA-256 metadata, and `src/cli/commands/report.ts` prints the localized summary and local path.
- [ ] Logging, progress, and report tests cover all audit triggers, canary-secret redaction, handle masking, no content preview query, terminal states, atomic report replacement, relative paths, and Portuguese summaries.
  - Automated tests to generate:
    - `tests/unit/logging/redactor.test.ts` — recursive canary omission and exact handle masking (US-8.3)
    - `tests/integration/logging/ndjson-logger.test.ts` — audit events, valid lines, local path boundary, no secrets (US-8.3)
    - `tests/integration/reports/run-report.test.ts` — every terminal/interrupted state, aggregate-only JSON and checksum metadata (US-8.2)
    - `tests/integration/cli/progress-report.test.ts` — Portuguese progress/report output with no full content (US-8.1, US-8.2, US-9.1)

**Completion criteria:** all earlier tests pass unmodified. Canary credentials/content are absent from every log/report byte, reports remain under the data directory, and all run terminal states produce consistent local audit output.

---

## Phase 13: Integrate the complete Portuguese workflow

**Goal:** Wire all adapters into one coherent CLI and prove the full workflow end-to-end with synthetic archives and a fake engine.

**Read first:** `feature-description.md` next to this file, section "UI"; `user-stories.md`, all CLI-facing stories.

**Do not touch in this phase:** established Core rules, BrowserEngine selectors, database schema, GitHub visibility, or real X. Integration may compose existing behavior but may not weaken a safety precondition for convenience.

**Conventions here, to follow rather than "fix":** `src/composition-root.ts` owns concrete wiring; command factories accept dependencies; command exit codes are stable; every user-facing sentence comes from message keys.

End-to-end tests run the program in-process with temporary state, a synthetic ZIP, fake prompt, fake clock, and fake engine.

**This phase has exactly 6 tasks.** Emit one verdict line per task, numbered 1 to 6 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `src/composition-root.ts` wires application-data resolution, database migration, repositories, lock, logging, archive sources/adapters, browser session, BrowserEngine, reports, translator, prompt, clock, delay, and signal adapter without global mutable singletons.
- [ ] `src/cli/create-program.ts` registers `import`, `status`, `dry-run`, `session`, `run`, `resume`, and `report`, keeps help in Portuguese, uses async handlers, converts domain errors to stable non-zero exit codes, and never prints stack traces unless explicit local diagnostics are enabled.
- [ ] `src/cli/prompt.ts` implements line-oriented account, session-clear, and exact `APAGAR` confirmations through `node:readline/promises` while never exposing a password prompt.
- [ ] `src/i18n/pt-BR.ts` contains every normal, empty, validation, safety, pause, recovery, and report key used by the completed CLI; a catalog parity check permits future `en` and `es` catalogs without domain changes.
- [ ] `tests/e2e/synthetic-workflow.test.ts` executes import ZIP, status, filtered dry-run, fake session/account confirmation, canceled run, one-item confirmed run, interruption/pause, resume, completion, and report against one temporary data directory.
- [ ] `tests/e2e/safety-regression.test.ts` proves missing prerequisites fail before engine calls, unsupported domains have no command/engine surface, data directories remain isolated, a later import does not expand a plan, and no workflow uses timeline crawling or network services other than an injected X browser boundary.
  - Automated tests to generate:
    - `tests/e2e/synthetic-workflow.test.ts` — complete happy/recovery path (US-1.1, US-2.1, US-3.1, US-3.2, US-3.3, US-4.2, US-5.1, US-5.2, US-7.6, US-8.1, US-8.2)
    - `tests/e2e/safety-regression.test.ts` — authorization, validation, isolation, immutable plan, and out-of-scope surface (US-1.2, US-3.4, US-5.3, US-11.1, US-12.1, US-12.2)

**Completion criteria:** all earlier tests pass unmodified. The synthetic end-to-end workflow reaches a completed report, every CLI string is backed by the Portuguese catalog, and all failure paths return before destructive engine calls when prerequisites are absent.

---

## Phase 14: Package, test across platforms, and document private beta

**Goal:** Produce installable artifacts, cross-platform CI, privacy scanning, and complete documentation while keeping the repository private.

**Read first:** `feature-description.md` next to this file, sections "PII Rules" and "Out of Scope"; `user-stories.md`, US-9.3, US-10.3, US-12.3, and US-12.4.

**Do not touch in this phase:** GitHub visibility, npm publication, release creation, real account execution, or product scope. Documentation must not claim real-archive/browser stability before manual evidence exists.

**Conventions here, to follow rather than "fix":** GitHub Actions use the npm lockfile and Node 24; automated suites use synthetic data/local pages; packaging checks inspect the tarball contents; documentation is Portuguese-first and may mark English/Spanish as future work.

CI must not require X credentials, a real archive, or repository secrets.

**This phase has exactly 7 tasks.** Emit one verdict line per task, numbered 1 to 7 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `.github/workflows/ci.yml` runs install, privacy scan, format check, lint, typecheck, tests, coverage, build, and package inspection on current macOS, Ubuntu, and Windows runners using Node 24 and cached npm dependencies.
- [ ] `scripts/check-private-artifacts.mjs` rejects tracked or package-included archives, SQLite files/journals, browser profiles, cookies, logs, reports, screenshots, traces, videos, environment files, and known real-data paths while allowing documented synthetic fixtures.
- [ ] `scripts/inspect-package.mjs` verifies `npm pack --dry-run --json` includes only the compiled CLI, required metadata, README, SECURITY, and LICENSE and excludes sources/tests/private artifacts not intended for distribution.
- [ ] `README.md` documents purpose, private-beta status, Node/browser requirements, installation from source, Archive request/import, commands, dry-run, `APAGAR`, staged limits, resume, local data locations, session clearing, limitations, roadmap, MIT license, irreversibility, and non-affiliation with X.
- [ ] `SECURITY.md`, `PRIVACY.md`, and `CONTRIBUTING.md` document vulnerability reporting, local sensitive-data boundaries, diagnostic capture risk/deletion, synthetic-fixture policy, selector maintenance, test commands, and the prohibition on sharing real account artifacts.
- [ ] `docs/troubleshooting.md` and `docs/architecture.md` explain session expiry, rate limits/challenges, unknown UI pause, lock diagnosis, archive compatibility limits, Core/engine separation, and future XApiEngine/i18n extension points without implementing them.
- [ ] Packaging/privacy tests prove CLI execution from the built tarball on platform path variants, complete help output, privacy scanner failures for every prohibited artifact class, and no publication command in CI.
  - Automated tests to generate:
    - `tests/integration/packaging/privacy-scan.test.ts` — prohibited artifacts and allowed synthetic fixtures (US-10.3, US-12.3)
    - `tests/integration/packaging/package-contents.test.ts` — executable bin and safe tarball contents (US-9.3, US-12.3)
    - `tests/integration/docs/documentation-contract.test.ts` — mandatory safety/privacy/release topics and no unsupported stability claim (US-12.4)

**Completion criteria:** all earlier tests pass unmodified on macOS, Linux, and Windows CI; build/package inspection is green; documentation is complete; no workflow publishes anything; and the GitHub repository remains private.

---

## Phase 15: Prepare and perform owner-controlled validation

**Operational phase**

**Goal:** Establish auditable manual gates for the real Archive and progressively authorized account cleanup without allowing Ralph or CI to perform destructive work autonomously.

**Read first:** `feature-description.md` next to this file, sections "Accepted Constraints and Validation Risks" and "PII Rules"; `feature-brief.md`, section "O que NÃO pode mudar de comportamento?".

**Do not touch in this phase:** GitHub visibility, npm publication, X security controls, real Archive contents, normal browser profile, or any destructive action not explicitly authorized by the owner in the live session. Ralph and CI must never execute the real-account commands.

**Conventions here, to follow rather than "fix":** validation evidence records counts, versions, timestamps, normalized outcomes, and sanitized issue IDs only; it never contains archive fragments, full interaction text, cookies, tokens, screenshots, traces, or absolute private paths.

The Archive is currently unavailable. Manual tasks correctly remain `NOT-CODE` until the owner obtains it and gives each explicit authorization.

**This phase has exactly 6 tasks.** Emit one verdict line per task, numbered 1 to 6 in the order they appear. The test bullets are part of the task above them, not tasks of their own.

**Tasks:**

- [ ] `docs/validation/real-account-runbook.md` requires local Archive acquisition, checksum recording, offline import first, count review, parser-compatibility decision, session/account confirmation, dry-run, exact plan review, one-item authorization, result verification, separately authorized small batch, interruption/resume exercise, final report review, and an immediate stop on challenge/rate-limit/unknown UI.
- [ ] `docs/validation/evidence-template.md` provides fields for application commit, Node/Playwright/browser/OS versions, synthetic suite result, sanitized archive adapter/counts, run IDs, authorized batch limits, normalized outcomes, residual risks, and owner approval while explicitly forbidding personal data and credentials.
- [ ] `docs/validation/release-checklist.md` keeps repository-publication, npm publication, and stable-release steps blocked until real Archive compatibility, four interaction types, dry-run, account match, one-item and small-batch results, Ctrl+C/resume, privacy review, cross-platform CI, and explicit owner approval are all recorded.
- [ ] The repository contains no automatic workflow, package script, test, seed, or fixture that can log in to real X, read the owner's future Archive path, type `APAGAR`, make the repository public, or publish a package/release.
- [ ] Run `npm run check`, `npm run test:coverage`, `npm pack --dry-run`, and the private-artifact scanner; record only the sanitized results in the validation evidence. This is procedural and must not be replaced by fabricated evidence.
- [ ] After the owner supplies the Archive locally, perform archive import and dry-run; then perform exactly one destructive item and later a small batch only through separate live explicit owner authorizations, independently verify each result on X, exercise interruption/resume, and record sanitized evidence. This is human-controlled, must not run inside Ralph/CI, and remains pending until the owner authorizes every destructive step.

**Completion criteria:** the three validation documents exist and encode every gate; code and automation contain no unattended real-X or publication path; all automated checks pass without real data. V1 is not declared validated and the repository is not made public until the owner completes the procedural tasks with separate explicit authorizations and approves the recorded evidence.
