# Feature Description — X Cleaner V1

<!-- inputs: feature-brief.md@sha256:dab26f7fec49 -->

## Overview

X Cleaner V1 is a local-first command-line application that imports a user's official X Archive, builds a durable local catalog of posts, replies, reposts, and likes, and removes selected interactions through an isolated Playwright browser engine. It exists so a person can clear years of account history without deleting the account, disclosing credentials, uploading the archive, or paying for the official X API.

The implementation uses TypeScript on Node.js 24 LTS, Playwright, and SQLite. It targets macOS, Linux, and Windows, with the first real-account validation performed on macOS. The archive, authenticated browser session, catalog, logs, checkpoints, and reports must remain local; no destructive action may run without a dry-run, account verification, and explicit authorization.

## Scope

### In scope

- Import a complete X Archive ZIP or an already extracted archive directory.
- Discover and normalize posts, replies, reposts, and likes into a deduplicated local catalog.
- Persist catalog data, cleaning plans, per-interaction state, checkpoints, and run summaries in SQLite.
- Provide basic filters by interaction type and date range.
- Generate a dry-run from exactly the same selection criteria used by a real run.
- Require deliberate destructive confirmation and verified authenticated-account identity.
- Authenticate manually on the official X website without requesting or storing the account password.
- Persist a local Playwright browser session and recover when that session expires.
- Delete posts and replies, undo reposts, and remove likes through a replaceable engine contract.
- Apply bounded retries, conservative pacing, backoff, safe interruption, and resumable execution.
- Produce privacy-conscious local logs and final or interrupted-run reports.
- Provide Portuguese CLI messages through a translation boundary prepared for English and Spanish.
- Test the core without X or a real browser and validate browser operations incrementally on the owner's account.
- Support macOS, Linux, and Windows.

### Out of scope

- Direct messages, bookmarks, lists, followers, following, communities, Spaces, profile changes, and account deletion.
- A graphical interface, web application, SaaS, remote backend, or X Cleaner user accounts.
- X API integration, OAuth, API cost estimation, or an `XApiEngine` implementation.
- Telemetry, analytics, or upload of account data.
- CAPTCHA bypass, rate-limit evasion, proxy rotation, or any attempt to defeat X security controls.
- Bulk operation of multiple accounts.
- Publishing the repository before real-account validation is complete.

## User Roles Involved

- **Local account owner:** imports their own archive, reviews catalog counts, creates a selection, runs dry-run, authenticates directly with X, confirms the detected account, explicitly authorizes destructive execution, pauses, resumes, and reviews reports.
- **Future open-source user:** performs the same local workflow on their own account after the project is validated and published.
- **Contributor:** develops and audits source code and synthetic fixtures but receives no access to real archives, authenticated sessions, or personal account data.

There are no server-side roles, administrators, tenant boundaries, or remote operators in V1. One local data directory represents one locally managed X account at a time; switching accounts requires explicit account verification and must never silently reuse a cleaning plan for another account.

## System Context

- **Local CLI:** the only user interface. It coordinates import, analysis, planning, dry-run, authenticated execution, resume, status, and reports.
- **Core domain:** owns normalized interactions, selection rules, state transitions, engine contracts, retry outcomes, and report inputs. It has no dependency on Playwright selectors or X page structure.
- **Archive infrastructure:** reads ZIPs or directories and delegates format variants to focused adapters. It never modifies the source archive.
- **Local persistence:** stores durable state in a SQLite database inside the user's application data directory.
- **Browser infrastructure:** owns Playwright, the persistent browser profile, X navigation, selectors, action execution, and normalized results.
- **External boundary:** the official X web interface is the only remote system used by V1. No X API or third-party service is required.

## Plan Gating

Not applicable. V1 has no subscriptions, commercial plans, remote accounts, or billing feature flags. The repository remains private during development, and real destructive execution is gated by explicit local confirmation and staged owner authorization.

## Business Rules

1. **BR-01 — Local-only data:** archives, normalized interactions, account identity, browser state, logs, checkpoints, and reports must not leave the user's machine.
2. **BR-02 — No password handling:** the CLI must never request, intercept, persist, or log the X password. Authentication occurs in the visible official X browser flow.
3. **BR-03 — Supported interaction types:** V1 handles `POST`, `REPLY`, `REPOST`, and `LIKE` independently so the user can select any subset.
4. **BR-04 — Archive-led discovery:** the X Archive is the primary discovery source. The browser engine executes actions against known interaction identifiers and must not discover history by endlessly scrolling timelines.
5. **BR-05 — Immutable source:** importing an archive must never alter the ZIP or extracted source directory.
6. **BR-06 — Deduplicated catalog:** reimporting the same archive must update or reuse catalog records without creating duplicate interactions.
7. **BR-07 — Shared selection semantics:** dry-run and real execution must resolve the same saved selection criteria against the same catalog state.
8. **BR-08 — Dry-run safety:** dry-run performs no mutation on X and requires no destructive browser action.
9. **BR-09 — Deliberate confirmation:** a real run must present the selected counts and irreversibility warning and require the exact configured confirmation phrase before execution.
10. **BR-10 — Account binding:** the authenticated X account must be detected and explicitly confirmed before a plan is first executed. A resumed run must refuse to continue when the detected account does not match the account bound to the run.
11. **BR-11 — Staged real validation:** destructive validation proceeds from dry-run to one explicitly authorized item and then to separately authorized small batches. No authorization is inferred from an earlier stage.
12. **BR-12 — Durable transition:** each interaction result must be persisted before the next interaction begins so an abrupt stop loses at most the in-flight attempt.
13. **BR-13 — Resume safety:** completed, skipped, unavailable, not-found, and already-removed interactions are not unnecessarily executed again when a run resumes.
14. **BR-14 — Recover stale processing:** an interaction left in `PROCESSING` after a crash may return to a retryable state during recovery; it must not be assumed completed.
15. **BR-15 — Expected terminal outcomes:** content that is already removed, unavailable, or not found is recorded as a non-fatal terminal outcome when the browser engine can distinguish it reliably.
16. **BR-16 — Bounded retry:** transient failures may be retried with a configured maximum and backoff. Exhausted retries become a recorded failure rather than an infinite loop.
17. **BR-17 — Conservative pacing:** real runs use configurable delays and pauses. Faster-than-human bulk execution is not a product goal.
18. **BR-18 — Security challenge stop:** CAPTCHA, suspicious-login prompts, explicit rate limits, or repeated unknown page states save progress and pause for legitimate manual intervention; the tool does not bypass them.
19. **BR-19 — Safe interruption:** `Ctrl+C` stops scheduling new work, lets the current persistence boundary finish when possible, saves run state, and exits with resume instructions.
20. **BR-20 — Privacy-conscious observability:** logs and reports may include interaction IDs, types, timestamps, statuses, and redacted error context, but never passwords, complete cookies, tokens, or full private content by default.
21. **BR-21 — Engine isolation:** all X UI URLs, selectors, dialogs, and mutation details live behind the browser engine contract. Core behavior remains testable with a fake engine.
22. **BR-22 — One active executor:** only one destructive executor may process a given local data directory at a time. Concurrent read-only inspection remains safe where supported.
23. **BR-23 — Private until validated:** source publication is a deliberate release step after the owner confirms the V1 works against the real account and privacy checks pass.

## Key Concepts

- **X Archive:** the user-provided official export, supplied as a ZIP or extracted directory and treated as read-only input.
- **Interaction:** a normalized item identified by its X identifier, type, optional creation time and summary, source location, and local lifecycle state.
- **Catalog:** the durable, deduplicated set of normalized interactions discovered from one or more imports.
- **Cleaning plan:** an immutable snapshot of selected interaction types and date filters plus the catalog boundary used by dry-run and execution.
- **Run:** one resumable execution of a cleaning plan, bound to a confirmed X account and containing aggregate progress.
- **Attempt:** one engine invocation for one interaction, including timing, result, retry classification, and privacy-safe error context.
- **Checkpoint:** durable evidence that run and interaction state has been persisted through a known processing boundary.
- **Cleaner engine:** a Core-facing contract that converts a requested interaction action into a normalized outcome without exposing Playwright details.
- **Browser engine:** the V1 cleaner engine implementation that uses the X web interface through Playwright.
- **Application data directory:** the private per-user directory containing SQLite state, browser profile, logs, locks, and reports. It is never part of the repository.

## What Exists vs What Is Added

### What already exists and is reused

- `x-cleaner-brief.md` — read-only product and architecture reference; it must remain intact.
- `docs/features/x-cleaner-v1/feature-brief.md` — confirmed human intent and non-negotiable behavior; read-only input for downstream planning.
- `LICENSE` — existing MIT license; no license replacement is part of feature implementation.
- Private GitHub repository `markintux/x-cleaner` — development remote; visibility must not be changed during implementation.

There is no pre-existing application code, database, CLI, parser, browser engine, or test suite to reuse.

### What this feature adds

- A TypeScript/Node.js CLI application with commands for import, analyze/status, dry-run, run, resume, report, session management, and local-data inspection.
- A framework-independent Core containing domain types, state-transition rules, selection logic, execution orchestration, engine contracts, and reporting models.
- Archive input adapters for ZIP and directory sources plus format-specific parsers selected by detected archive contents.
- A SQLite persistence adapter using the Node.js built-in `node:sqlite` API, isolated behind repository interfaces.
- A Playwright BrowserEngine and selector/navigation layer dedicated to X UI behavior.
- A local browser-session manager that opens a visible browser for manual login and stores its profile only in the application data directory.
- A local lock, structured privacy-safe logging, checkpoint recovery, and report generation.
- A translation catalog and message-key boundary with Portuguese as the shipped language and future English/Spanish catalogs enabled without rewriting commands.
- Synthetic archive fixtures, fake-engine scenarios, unit tests, integration tests, and tightly controlled browser validation procedures.
- Open-source release documentation prepared during the final phase but not published until validation is approved.

## Data & Format Decisions

- **Runtime baseline:** Node.js 24 LTS with ECMAScript modules and TypeScript strict mode.
- **Database:** one SQLite file per application data directory, accessed through the built-in `node:sqlite` module. Foreign keys are enabled; extensions are disabled; schema changes are versioned migrations.
- **X identifiers:** stored and handled as decimal strings, never JavaScript `number`, to avoid integer precision loss.
- **Timestamps:** normalized to UTC and serialized at boundaries as ISO 8601 strings with a `Z` suffix. Missing archive dates remain explicitly null rather than guessed.
- **Archive input:** ZIP bytes or an extracted directory. ZIP entries are validated against path traversal before extraction or reading. The source is never modified.
- **Archive variants:** detection is content-driven and adapter-based. Exact compatibility claims remain provisional until the owner's current archive is inspected locally.
- **Application data location:** resolved from the operating system's per-user application-data conventions, with an explicit `--data-dir` override for testing and advanced use. The resolved path is shown before sensitive operations.
- **Browser profile:** a dedicated Playwright profile inside the application data directory; the user's normal Chrome profile is not reused or modified.
- **Logs:** UTF-8 newline-delimited JSON for machine-readable events plus concise localized terminal output. Sensitive values are redacted before serialization.
- **Reports:** a localized terminal summary and a UTF-8 JSON report stored locally with run identifier, timestamps, counts by type and result, interruption state, and sanitized failure summaries.
- **Localization:** stable message keys with Portuguese catalog values. Domain and persisted status codes remain language-neutral; only presentation strings are translated.
- **Empty state:** an archive with no supported interactions is a successful import with zero counts and a clear message; it cannot create a destructive run.
- **Fixtures:** repository fixtures contain synthetic identifiers and text only. Real archive fragments require deliberate sanitization before they can be considered for tests.

## Audit

V1 has no remote activity-log service. Its audit trail is local and privacy-conscious.

| Trigger | Local event | Required properties |
|---|---|---|
| Archive import starts/completes/fails | `archive.import.*` | import ID, source kind, detected adapter, counts, duration, sanitized error |
| Account is detected/confirmed/rejected | `account.*` | masked handle or local account fingerprint, run ID, outcome; no cookies or tokens |
| Cleaning plan and dry-run are produced | `plan.created`, `plan.previewed` | plan ID, filter summary, counts by type |
| Destructive confirmation succeeds/fails | `run.confirmation.*` | run ID, outcome; never record the raw entered phrase if it may contain unexpected input |
| Interaction attempt completes | `interaction.attempted` | run ID, interaction ID, type, attempt number, normalized outcome, duration, sanitized error code |
| Backoff or manual pause occurs | `run.paused` | run ID, reason category, retry-after when known, persisted checkpoint |
| Run resumes, completes, interrupts, or fails | `run.*` | run ID, aggregate counts, timestamps, terminal reason |
| Session data is cleared | `session.cleared` | timestamp and data-directory identity; no deleted secret values |

## UI

The UI is a terminal experience with Portuguese copy and stable translation keys. It must remain usable without knowledge of OAuth, cookies, selectors, developer tools, or HTTP concepts.

- **First run:** explains local-only storage, displays the resolved data directory, and directs the user to import a ZIP or directory.
- **Importing:** shows validation and category counts without printing full interaction content.
- **Ready:** shows archive/catalog status and offers import, analyze/status, dry-run, run/resume, report, session, and exit workflows.
- **Selection:** allows independent post, reply, repost, and like selection plus optional date boundaries.
- **Dry-run:** prominently states that no X change will occur and displays exact locally selected counts or clearly labeled estimates when exactness is impossible.
- **Authentication:** opens a visible browser, asks the user to log in directly on X, and waits for account detection without handling credentials.
- **Account confirmation:** displays the detected handle and requires explicit confirmation. A mismatch blocks execution.
- **Destructive confirmation:** displays per-type and total counts, an irreversibility warning, and the required confirmation phrase.
- **Running:** shows completed, remaining, skipped, terminal non-error, failed, paused, and retry counts without flooding the terminal with private content.
- **Paused/interrupted:** confirms checkpoint persistence and prints the exact resume command.
- **Completed:** shows the final summary and local report path.
- **Unknown X UI state:** pauses safely with a concise explanation and diagnostic-log path instead of guessing an action.

All destructive enforcement lives in Core orchestration and persistence rules, not only in prompts or terminal visibility.

## PII Rules

- Treat the entire X Archive and browser profile as sensitive personal data.
- Never commit real archives, extracted archive files, databases, browser profiles, screenshots, traces, videos, cookies, logs, checkpoints, or reports.
- Default logs omit full post text and redact cookie, authorization, CSRF, session, email, and password-like values.
- Playwright screenshots, traces, and videos are disabled by default for real-account runs because they can capture private data.
- Diagnostic capture requires a deliberate local opt-in, a visible warning, and documented deletion instructions.
- Synthetic fixtures are the default for automated tests and CI.
- Clearing local session data is an explicit command and must not silently delete the imported catalog or reports unless the user separately requests that scope.
- The future open-source release must document local storage locations, deletion procedures, irreversible-action risk, and the absence of affiliation with X.

## Accepted Constraints and Validation Risks

- Browser automation is inherently coupled to the current X interface even though that coupling is isolated. Selector changes can pause execution until BrowserEngine maintenance is released.
- Archive format compatibility cannot be claimed from synthetic fixtures alone. The owner's real archive is still pending and must be inspected locally before parser support is considered validated.
- Cross-platform support requires CI and packaging tests on macOS, Linux, and Windows; real destructive account validation remains intentionally limited to the owner's controlled environment.
- The built-in synchronous SQLite API is acceptable for a single-process CLI because each state transition is small and sequential. Database access remains behind an adapter so this choice can be replaced if measured performance or packaging evidence requires it.

## Out of Scope

- Discovering account history by scrolling X timelines.
- Supporting archive data unrelated to posts, replies, reposts, and likes.
- Preserving items based on engagement counts, pinned state, words, allowlists, or denylists in V1.
- Scheduling unattended recurring cleanups.
- Running headless by default for authenticated destructive work.
- Reusing the user's everyday browser profile.
- Automatic CAPTCHA solving or automatic continuation after a security challenge.
- Distributed workers, parallel destructive execution, remote synchronization, or cloud backups.
- Importing or exporting browser credentials.
- Building the future `XApiEngine`, OAuth flow, pricing lookup, GUI, or SaaS.
- Making the repository public, publishing packages, or announcing a stable release before explicit owner approval after real validation.
