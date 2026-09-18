# X Cleaner agent instructions

## Project

X Cleaner is a local-first TypeScript CLI that imports an official X Archive
and removes selected posts, replies, reposts, and likes through an isolated
Playwright browser engine.

Read these documents before implementation:

- `docs/features/x-cleaner-v1/feature-description.md`
- `docs/features/x-cleaner-v1/user-stories.md`
- `docs/features/x-cleaner-v1/database-schema.md`
- the current phase in `docs/features/x-cleaner-v1/project-phases.md`

`x-cleaner-brief.md` is the read-only source of the original product intent.

## Stack and commands

- Node.js 24 LTS, ESM, and strict TypeScript.
- npm with a committed `package-lock.json`.
- Commander for the CLI, Vitest 4 for tests, Playwright for browser automation,
  `@zip-js/zip-js` for ZIP reading, and built-in `node:sqlite` for persistence.
- The first phase creates `package.json`. Install its dependencies and create the
  lockfile before invoking project scripts.
- The canonical mechanical gate is `npm run check`.
- Focused tests may be run during development, but the full gate must pass before
  a phase is considered complete.
- Do not use PHP, Composer, Artisan, PHPUnit, Laravel, or Sail in this project.
- Use Context7 before relying on library, framework, SDK, API, or CLI details.

## Architecture

- Keep Core independent of Playwright, X selectors, archive variants, SQLite,
  terminal prompts, and future X API details.
- Put domain and application rules under `src/domain/` and `src/application/`.
- Put adapters under `src/infrastructure/` and CLI composition under `src/cli/`.
- X UI URLs, selectors, dialogs, and page evidence belong only to BrowserEngine.
- Persist X identifiers as decimal strings, never JavaScript numbers.
- Persist timestamps as UTC ISO 8601 strings.

## Privacy and destructive-action rules

- Never commit or upload a real X Archive, extracted archive, SQLite state,
  browser profile, cookie, token, log, report, screenshot, trace, or video.
- Automated tests and CI use synthetic fixtures and local browser pages only.
- Never request, capture, store, or log the X password.
- Dry-run must never invoke a browser mutation.
- Never perform a real destructive X action without a fresh, explicit owner
  authorization for that exact validation step.
- Do not bypass CAPTCHA, security challenges, rate limits, or authentication.
- Keep the GitHub repository private until the owner explicitly approves making
  it public after real validation.

## Ralph

- Start Ralph only from a clean Git worktree.
- Use `./scripts/run-ralph.sh`; it selects Node 24 and fixes the gate-2 command to
  `npm run check` before `package.json` exists.
- The launcher pins implementation and gate-3 verification sessions to
  `gpt-5.6-terra` with reasoning effort `high`.
- Ralph and CI must not execute Phase 15 real-account validation. Those tasks are
  human-controlled and remain pending until the owner supplies the Archive and
  separately authorizes each destructive batch.
