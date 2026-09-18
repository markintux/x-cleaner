# User Stories — X Cleaner V1

<!-- inputs: feature-description.md@sha256:dd940ac58690 -->

## Overview

X Cleaner V1 lets a person import their own X Archive, inspect and filter a local interaction catalog, preview a cleanup, authenticate directly with X, and execute a controlled, resumable cleanup through a browser. These stories cover the local CLI, archive processing, safety gates, all four interaction types, resilience, privacy, reporting, platform support, and regression boundaries.

V1 is a single-user local application rather than a multi-tenant service, so tenant-isolation and commercial-plan-gate stories do not apply. Isolation is enforced through the selected local application data directory and explicit binding of each destructive run to one confirmed X account.

## User Types Involved

| Type | Description |
|---|---|
| **Local account owner** | Imports their own archive, reviews selections, authenticates directly on X, confirms the detected account, authorizes destructive operations, resumes work, and reads reports. |
| **Future open-source user** | Uses the same local workflow on their own machine and account after the repository is deliberately published. |
| **Contributor** | Develops against synthetic fixtures and fake engines without receiving real archives, browser profiles, or account data. |
| **Confirmed X account** | A behavior-deciding property rather than an application role: a destructive run can operate only when the detected account matches the account explicitly bound to that run. |
| **Application data directory** | A behavior-deciding local boundary: one directory contains one catalog, browser profile, lock, logs, runs, and reports and permits only one active destructive executor. |

## User Stories

### 1. Local workspace and access boundary

**US-1.1** — As a local account owner, I want the CLI to show where it stores sensitive state, so I know which local directory the tool controls.

- Given no application state exists
- When I run `x-cleaner status`
- Then the CLI prints the resolved application data directory in Portuguese
- And it explains that archives, session state, logs, checkpoints, and reports remain local
- And no network request is made

**US-1.2** — As a local account owner, I want to choose an isolated data directory, so tests and separate local workspaces cannot mix state.

- Given two different paths are supplied through `--data-dir`
- When I import or inspect state in each path
- Then each path uses its own SQLite database, browser profile, logs, locks, and reports
- And neither command reads or writes the other path

**US-1.3** — As a local account owner, I want concurrent destructive executors rejected, so two processes cannot act on the same run.

- Given a destructive executor holds the lock for an application data directory
- When a second process runs `x-cleaner run` or `x-cleaner resume` against that directory
- Then the second process exits without invoking the cleaner engine
- And the Portuguese error identifies the active-run lock and how to inspect it safely
- And read-only `x-cleaner status` remains available

### 2. Archive import and catalog creation

**US-2.1** — As a local account owner, I want to import a complete X Archive ZIP, so supported interactions become available without timeline crawling.

- Given a valid synthetic X Archive ZIP containing posts, replies, reposts, and likes
- When I run `x-cleaner import <archive.zip>`
- Then the CLI detects a compatible archive adapter
- And it persists each supported interaction with its decimal-string X identifier, type, available UTC timestamp, source, and initial status
- And it prints counts for posts, replies, reposts, likes, and total records
- And the source ZIP checksum and bytes remain unchanged

**US-2.2** — As a local account owner, I want to import an extracted X Archive directory, so extraction is optional.

- Given a directory containing the same logical archive data as a supported ZIP fixture
- When I run `x-cleaner import <archive-directory>`
- Then the normalized catalog and per-type counts match the ZIP import
- And no source file is modified, renamed, or deleted

**US-2.3** — As a local account owner, I want repeat imports to be idempotent, so updating the catalog does not duplicate history.

- Given an archive was imported successfully
- When I import the same archive again
- Then existing interactions are matched by their stable identity and type
- And no duplicate catalog record is created
- And the import summary distinguishes inserted, reused, and updated records

**US-2.4** — As a local account owner, I want unsafe or unsupported archives rejected clearly, so malformed input cannot escape its local boundary or create misleading data.

- Given the input is missing required X Archive evidence, contains malformed supported data, or contains a ZIP entry that resolves outside the archive boundary
- When I run `x-cleaner import <input>`
- Then the command exits non-zero with a Portuguese validation message identifying the category of failure
- And no path-traversal entry is written outside the controlled temporary or application data directory
- And no partial catalog transaction is committed

**US-2.5** — As a local account owner, I want a valid archive with no supported interactions handled as an empty success, so absence of history is not reported as corruption.

- Given an otherwise valid archive contains zero supported interactions
- When I run `x-cleaner import <input>`
- Then the import succeeds with zero counts
- And `x-cleaner status` reports an empty catalog
- And `x-cleaner run` refuses to create a destructive run with a clear Portuguese message

### 3. Analysis, selection, and dry-run

**US-3.1** — As a local account owner, I want to inspect catalog counts, so I can understand the available cleanup scope before selecting anything.

- Given the catalog contains multiple supported interaction types and statuses
- When I run `x-cleaner status`
- Then the CLI reports counts by interaction type and lifecycle status
- And it does not print full interaction content by default

**US-3.2** — As a local account owner, I want to select interaction types and date boundaries independently, so I control what a plan includes.

- Given the catalog contains posts, replies, reposts, and likes across multiple dates
- When I run `x-cleaner dry-run` with a subset of `--type` values and optional inclusive `--from` and `--to` ISO dates
- Then only catalog records matching every supplied filter are selected
- And omitted interaction types are excluded
- And invalid dates, an inverted date range, or an unsupported type exit non-zero before a plan is saved

**US-3.3** — As a local account owner, I want a dry-run to preview the exact saved selection without changing X, so I can review destructive scope safely.

- Given a valid non-empty selection
- When I run `x-cleaner dry-run` with that selection
- Then the CLI prominently displays `SIMULAÇÃO` and states that no alteration will be made
- And it prints exact counts by selected type and total
- And it saves an immutable cleaning plan containing the filters and catalog boundary
- And no browser engine mutation method is invoked

**US-3.4** — As a local account owner, I want execution to use the reviewed plan snapshot, so later imports cannot silently expand what will be removed.

- Given a dry-run saved a cleaning plan
- And additional interactions are imported afterward
- When that plan is executed
- Then only interactions inside the plan's saved catalog boundary and filters are eligible
- And the newly imported interactions require a new dry-run and plan

### 4. Authentication and account authorization

**US-4.1** — As a local account owner, I want to log in through a visible official X browser page, so X Cleaner never handles my password.

- Given no valid local browser session exists
- When I run `x-cleaner session login`
- Then Playwright opens a visible browser using the dedicated profile inside the application data directory
- And the CLI asks me to complete login directly on X
- And the CLI never displays a password prompt or accepts a password option

**US-4.2** — As a local account owner, I want the CLI to detect and confirm the authenticated account, so I do not clean the wrong account.

- Given the browser is authenticated on X as `@exemplo`
- When account detection completes
- Then the CLI displays `@exemplo`
- And it requires explicit confirmation before binding that account to a destructive run
- And rejecting the handle invokes no destructive engine method

**US-4.3** — As a local account owner, I want a resumed run blocked on account mismatch, so a saved plan cannot operate on another logged-in account.

- Given a run is bound to `@conta-a`
- And the current browser session is detected as `@conta-b`
- When I run `x-cleaner resume <run-id>`
- Then the command refuses to process any interaction
- And it reports the expected and detected handles without exposing session secrets
- And the run remains resumable after the correct account is restored

**US-4.4** — As a local account owner, I want to clear only the browser session explicitly, so logout does not silently delete my catalog or reports.

- Given the application data directory contains a browser profile, catalog, logs, and reports
- When I run `x-cleaner session clear` and confirm the local deletion
- Then the dedicated browser profile is removed
- And the SQLite catalog, runs, logs, and reports remain intact
- And a privacy-safe `session.cleared` event is recorded

### 5. Destructive confirmation and staged execution

**US-5.1** — As a local account owner, I want an irreversible-action warning and exact confirmation phrase, so an accidental command cannot start deletion.

- Given a reviewed plan is non-empty and the authenticated account is confirmed
- When I run `x-cleaner run <plan-id>`
- Then the CLI displays selected counts by type, total count, detected handle, and an irreversibility warning
- And processing starts only when I type exactly `APAGAR`
- And empty input, different casing, or any other phrase cancels without invoking the cleaner engine

**US-5.2** — As a local account owner, I want to limit a real run to a deliberately small batch, so initial validation can progress from one item to controlled batches.

- Given a reviewed plan contains more interactions than the requested `--limit`
- When I run `x-cleaner run <plan-id> --limit 1` and confirm with `APAGAR`
- Then at most one eligible interaction is sent to the cleaner engine
- And the remaining interactions stay pending and resumable
- And a later larger batch requires a new command and new destructive confirmation

**US-5.3** — As a local account owner, I want all destructive preconditions enforced in Core, so bypassing terminal prompts in an adapter cannot start unsafe work.

- Given any of the following is absent: reviewed plan, non-empty selection, matching confirmed account, destructive confirmation, or executor lock
- When execution orchestration is invoked directly in a test
- Then Core rejects the request before calling the cleaner engine
- And it returns a distinct machine-readable rejection reason

### 6. Supported cleanup actions

**US-6.1** — As a local account owner, I want my original posts deleted, so selected `POST` history is removed.

- Given a confirmed run contains an accessible post authored by the bound account
- When BrowserEngine processes its `POST` interaction
- Then it navigates using the known interaction identity and performs the X delete-post confirmation flow
- And it returns a normalized successful outcome only after the UI confirms deletion or the content is no longer accessible

**US-6.2** — As a local account owner, I want replies handled separately from original posts, so selecting one category does not implicitly remove the other.

- Given a plan selects `REPLY` and excludes `POST`
- When the run is processed
- Then BrowserEngine deletes eligible replies through the post-deletion flow
- And no catalog interaction typed `POST` is sent to the engine

**US-6.3** — As a local account owner, I want selected reposts undone, so repost history is removed without attempting to delete the third party's content.

- Given a confirmed run contains an accessible `REPOST`
- When BrowserEngine processes it
- Then it invokes the X undo-repost flow
- And it never invokes the delete-post flow for the third-party original
- And it returns a normalized successful or already-removed outcome

**US-6.4** — As a local account owner, I want selected likes removed incrementally, so large like histories remain controllable and resumable.

- Given a confirmed run contains an accessible `LIKE`
- When BrowserEngine processes it
- Then it invokes the X unlike flow once for that interaction
- And it returns a normalized successful or already-removed outcome before the next item is scheduled

**US-6.5** — As a local account owner, I want missing or inaccessible content treated predictably, so old archive references do not abort the entire cleanup.

- Given X reports an interaction as already removed, not found, or unavailable and BrowserEngine can distinguish the state
- When the interaction is processed
- Then the engine returns `ALREADY_REMOVED`, `NOT_FOUND`, or `UNAVAILABLE`
- And Core records the terminal outcome and continues with the next eligible interaction

### 7. Checkpoints, retries, pause, and resume

**US-7.1** — As a local account owner, I want each result persisted before the next item begins, so a crash loses at most the in-flight attempt.

- Given a run processes multiple interactions through a fake engine
- When an interaction receives a normalized result
- Then its attempt and resulting lifecycle state are committed atomically before the next engine call
- And a simulated process crash after that commit does not make the completed item eligible again

**US-7.2** — As a local account owner, I want stale in-flight state recovered safely, so a crash during one action does not falsely mark it complete.

- Given an interaction remains `PROCESSING` without a finished attempt after an unclean shutdown
- When `x-cleaner resume <run-id>` performs recovery
- Then the interaction returns to a retryable pending state
- And the recovery is logged
- And the interaction is never assumed successfully removed without a normalized engine result

**US-7.3** — As a local account owner, I want completed and terminal non-error items skipped on resume, so thousands of finished actions are not repeated.

- Given a run contains completed, skipped, already-removed, unavailable, not-found, failed-retryable, and pending interactions
- When I resume the run
- Then completed, skipped, already-removed, unavailable, and not-found items are not sent to the engine
- And only eligible retryable or pending items are scheduled under the run's retry rules

**US-7.4** — As a local account owner, I want transient failures retried only within a limit, so temporary problems recover without infinite loops.

- Given the engine returns a retryable timeout or temporary page-load failure
- When execution continues
- Then Core schedules retries up to the configured maximum with increasing backoff
- And each attempt is recorded
- And exhaustion records `FAILED` and continues or pauses according to the normalized failure category

**US-7.5** — As a local account owner, I want security challenges and rate limits to pause safely, so the tool never tries to evade X protections.

- Given BrowserEngine detects CAPTCHA, suspicious-login review, explicit rate limiting, or repeated unknown page state
- When it returns the corresponding pause outcome
- Then Core stops scheduling new interactions
- And it persists the checkpoint and pause reason
- And the CLI requests legitimate manual action or a later resume without attempting bypass or proxy rotation

**US-7.6** — As a local account owner, I want `Ctrl+C` handled as a safe interruption, so I can stop a long cleanup without losing progress.

- Given a destructive run is active
- When the process receives the first interrupt signal
- Then it stops scheduling new work
- And it persists the last safe checkpoint when possible
- And it prints the exact `x-cleaner resume <run-id>` command
- And a second forced interruption never rewrites already committed results

### 8. Progress, logs, and reports

**US-8.1** — As a local account owner, I want concise progress by type and outcome, so I can monitor long runs without exposing private content.

- Given a run is processing interactions
- When progress changes
- Then the CLI can display completed, remaining, skipped, non-error terminal, failed, paused, and retry counts
- And it does not display full post or reply text by default

**US-8.2** — As a local account owner, I want a local report for completed or interrupted runs, so I can audit what happened later.

- Given a run completes, fails, pauses, or is interrupted
- When I run `x-cleaner report <run-id>`
- Then the CLI prints a Portuguese summary by interaction type and normalized outcome
- And a UTF-8 JSON report exists locally with run ID, timestamps, interruption state, aggregate counts, and sanitized failure summaries
- And the report contains no password, complete cookie, authorization token, or full private content

**US-8.3** — As a contributor, I want structured logs to redact secrets before serialization, so diagnostics can be inspected without leaking authentication material.

- Given a logged error context contains fields resembling cookies, authorization, CSRF, session, email, or password values
- When the event is serialized to newline-delimited JSON
- Then sensitive values are replaced by redaction markers
- And tests assert the original values do not appear anywhere in the serialized event

**US-8.4** — As a local account owner, I want diagnostic media disabled by default, so browser traces do not silently capture personal data.

- Given a real-account BrowserEngine run uses default settings
- When Playwright starts the context
- Then screenshot, trace, and video capture are disabled
- And enabling diagnostic capture requires an explicit option that displays a privacy warning and destination path

### 9. Localization and platform behavior

**US-9.1** — As a Portuguese-speaking user, I want every normal and error workflow presented in Portuguese, so I do not need to understand implementation terminology.

- Given the default locale is active
- When I use import, status, dry-run, session, run, resume, or report workflows
- Then user-facing headings, prompts, warnings, validation errors, and recovery instructions come from the Portuguese message catalog
- And persisted types, statuses, event names, and report field names remain language-neutral

**US-9.2** — As a future maintainer, I want stable translation keys, so English and Spanish can be added without rewriting Core or CLI orchestration.

- Given a test translation catalog supplies alternative values for existing keys
- When the CLI renders a representative workflow with that catalog
- Then the alternative strings appear
- And no domain state comparison depends on translated text

**US-9.3** — As a user on macOS, Linux, or Windows, I want paths and local state resolved correctly, so the same CLI workflow works across supported systems.

- Given platform-specific application-data roots and path separators
- When path resolution, ZIP validation, SQLite creation, browser-profile creation, and report writing are tested for each supported platform
- Then all controlled paths stay under the resolved or explicitly supplied data directory
- And CI passes the non-destructive test suite on macOS, Linux, and Windows

### 10. Architecture and testability

**US-10.1** — As a contributor, I want Core cleanup orchestration tested with a fake engine, so safety, state transitions, retries, and reports do not require X or a browser.

- Given a deterministic fake cleaner engine returns configured outcomes
- When Core tests exercise dry-run, confirmation rejection, success, terminal non-error, retry, pause, crash recovery, and resume
- Then no Playwright module or X network request is required
- And each expected SQLite state transition is asserted

**US-10.2** — As a contributor, I want X UI details isolated in BrowserEngine, so a selector change does not alter archive, selection, checkpoint, or reporting code.

- Given the X selector/navigation implementation is replaced by a test adapter
- When BrowserEngine contract tests run
- Then Core consumes the same normalized outcomes
- And no Core module imports Playwright, selector constants, or X page objects

**US-10.3** — As a contributor, I want only synthetic account data in automated tests, so CI and the future public repository contain no real personal history.

- Given the repository test suite and fixtures are scanned for prohibited local-artifact patterns
- When CI runs the privacy fixture check
- Then no real archive, extracted archive, SQLite state, browser profile, cookies, logs, reports, screenshots, traces, or videos are tracked
- And all committed interaction identifiers and content are documented synthetic fixtures

### 11. Validation errors and safe failure

**US-11.1** — As a local account owner, I want missing prerequisites reported before browser mutation, so failures are understandable and harmless.

- Given the catalog, reviewed plan, browser session, account confirmation, or eligible interactions required by a command are missing
- When I run the dependent command
- Then it exits non-zero with a Portuguese message naming the missing prerequisite and next command
- And no destructive engine method is invoked

**US-11.2** — As a local account owner, I want an unknown X interface state to stop rather than guess, so frontend changes cannot trigger the wrong action.

- Given BrowserEngine cannot prove the expected target or action state from supported semantic selectors and page evidence
- When an interaction is processed
- Then it does not click a destructive control speculatively
- And it returns an unknown-state pause outcome
- And Core saves progress and prints the local diagnostic-log path

**US-11.3** — As a local account owner, I want an expired session recoverable, so authentication loss does not discard the run.

- Given X redirects the dedicated browser session to authentication while a run is pending
- When BrowserEngine detects the expired session
- Then Core pauses and checkpoints the run
- And `x-cleaner session login` can restore authentication
- And resume repeats account detection and matching before scheduling another interaction

### 12. Regression and release boundary

**US-12.1** — As the project owner, I want the original product intent preserved, so implementation cannot silently weaken the safety model.

- Given any implementation phase changes archive, planning, execution, logging, or session behavior
- When its automated tests and review are run
- Then the source archive remains read-only
- And dry-run remains mutation-free
- And password handling remains absent
- And destructive execution still requires a reviewed plan, matching confirmed account, explicit confirmation, and executor lock

**US-12.2** — As the project owner, I want unsupported domains untouched, so V1 does not expand into unrelated account management.

- Given V1 commands and BrowserEngine capabilities are enumerated
- When the public command and engine-contract surfaces are reviewed
- Then they contain no operation for direct messages, bookmarks, followers, following, lists, communities, Spaces, profile mutation, or account deletion
- And they contain no X API, OAuth, proxy-evasion, SaaS, or remote-upload path

**US-12.3** — As the project owner, I want publication to remain a separate approved action, so unfinished or unvalidated code is not exposed accidentally.

- Given implementation and non-destructive tests may be complete
- When release preparation runs before real archive compatibility, staged account cleanup, privacy review, and owner approval are recorded
- Then the repository remains private
- And no package or stable release is published

**US-12.4** — As the project owner, I want the future open-source release documented, so publication is safe once validation is approved.

- Given real validation and privacy review have later been approved
- When the release documentation phase is completed
- Then README and security documentation explain installation, local data locations, archive acquisition, dry-run, destructive confirmation, resume, deletion of local state, limitations, troubleshooting, contribution, MIT licensing, irreversibility, and non-affiliation with X
- And making the repository public still requires a separate explicit owner action
