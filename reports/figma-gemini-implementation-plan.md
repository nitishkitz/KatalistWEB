# Gemini implementation plan: Figma Designs without API credentials

Status: Implementation instructions, not implemented. Date: 2026-10-08.
Product reference: `reports/figma-productivity-plan.md`.

## Working instructions to paste before every stage

Implement only the numbered stage supplied below in the existing Katalist repository. Read AGENTS.md and applicable nested instructions first. Preserve unrelated working-tree changes; inspect git status before editing. Do not rewrite published history. Follow the project's Laya classification and follow-up instructions if its tools are available; otherwise report unavailable.

Use existing React, TypeScript, TanStack Query, Supabase, and UI components. Do not add dependencies or refactor unrelated features. No Figma OAuth, API credentials, REST API calls, scraping, or arbitrary iframe HTML. Do not expose server/service credentials. Match current List workspace styling. Keep new UI under `src/features/designs/` and keep route changes small.

Read the relevant existing implementation before copying its patterns. Report changed files, checks run and results, unresolved limitations, and migration deployment status. Complete stage acceptance checks before advancing. Do not claim tests passed if they were not run. SQL in supabase/migrations is not automatically deployed by npm scripts. No production migration deployment is authorized by this plan.

Security-sensitive migrations, storage policies, and review authorization need a separate qualified review before production release; a low-model or classifier sign-off alone is insufficient. This review should not prevent preparing and locally testing the implementation.

## Stage 1 — URL contract and embed conversion

Deliver `src/features/designs/figma-url.ts`, domain types, and focused URL tests using the repository's test conventions. Read current official embed docs linked in the product reference.

- Accept HTTPS Figma Design, legacy file, FigJam board, prototype, Slides/deck links only for supported official routes. Normalize legacy links deliberately.
- Require an exact approved hostname and valid file key; reject credentials, malformed links, lookalike domains, and unsupported routes. Derive iframe URLs internally.
- Preserve documented frame/page/flow/version parameters through an allowlist. Never pass arbitrary query parameters blindly. Add `embed-host=katalist`.
- Return normalized original URL, derived embed URL, resource kind, file key, target node and optional flow/version identity.
- Identity must distinguish different frames or prototype flows from the same file. Normalize harmless differences for duplicate handling; document the rule.

Acceptance: representative links convert correctly; frame/flow identity survives; malicious and unsupported links fail clearly. Do not change the List UI yet.

## Stage 2 — Persistence and permissions

Read List/member schema and authorization helpers in Supabase migrations, and existing client/session/query patterns. Add a new migration without changing old migrations.

Proposed records:
- `design_resources`: id, list_id, canonical URL, resource kind/file key/target identity, title, notes, tags, owner_profile_id, optional folder_id and cover storage key, timestamps, archived_at.
- `design_folders`: id, list_id, name, timestamps. Single-level folders initially; no recursive folder engine.
- `design_favorites`: resource_id, profile_id, unique pair.
- `design_thing_links`: resource_id, thing_id, list_id, creator and timestamps, unique resource/Thing pair.

Use explicit database constraints and RLS/RPC enforcement: readable by members, resource/folder/link writes by owner/collaborator, favorites private to the current member. Validate linked Things and folders belong to the same List; prevent updates from moving records across Lists. Owner identity must be a valid member. No broad authenticated access and no UI-only authorization.

Add typed read/mutation hooks, scoped query keys, bounded pagination and cache invalidation. Auth/session changes must follow existing cache-isolation conventions. Do not hand-edit generated integration types without checking their generation workflow.

Acceptance: member can read; view-only cannot mutate shared records; outsider/anonymous cannot read; cross-List links and reparenting fail; favorites cannot be read/changed by another member. Verify on a disposable/local database and explicitly report if such verification is unavailable.

## Stage 3 — Designs tab and resource library

Read `src/routes/lists.$listId.tsx`, List role types, existing dialogs, async states and query policies. Add a lazy Designs tab and feature-local error boundary.

- Required add fields: URL and title only. Expand optional notes, owner, tags and folder.
- Show saved resources, type, owner and Katalist timestamps. No fabricated thumbnails or Figma modification times.
- Provide edit/archive, folders, personal favorites, title/tag/note search, owner/type/folder filters, and clear filters.
- Use bounded server-backed queries or clearly label any loaded-window search; do not imply full results when only one page is searched.
- Loading, empty, validation, save failure, retry, and permission states. Maintain dialog drafts after failed saves.
- Preview/demo session must remain isolated from persisted user data; use existing conventions or a clear unavailable state.

Acceptance: CRUD survives reload; folder/favorite/search/filter behavior works; view-only UI matches database rules; mobile tabs and keyboard dialogs work; existing tabs are unaffected.

## Stage 4 — Official embedded viewer

- On selection, show a large viewer with title, View only label, Open in Figma, copy original link, retry, and fullscreen.
- Mount only the selected embed, using the validated URL contract and an accessible iframe title. Preserve Figma's native pan/zoom/page/prototype controls where supported.
- Give slow/blocked embeds a manual external-open fallback. Do not claim successful authorization because iframe onLoad fired; do not inspect cross-origin contents.
- Verify app CSP permits only necessary Figma embedding hosts. Do not broadly relax frame or script policies.

Acceptance: public design and prototype tested; frame targeting preserved; FigJam and Slides/deck tested where sample access is available; private/signed-out behavior checked; fallback works. Mark provider/browser checks not performed as unverified.

## Stage 5 — Covers and Thing links

Read `src/features/things/attachments.ts`, private storage policies, Thing detail and existing link/selection patterns.

- Optional manual image cover, with size/MIME validation, private storage, authorized signing, replace/delete cleanup and upload failure recovery. No automatic screenshot capture of embeds.
- Link/unlink authorized Things from a design and show linked designs in Thing detail. Preserve exact frame links.
- Keep discussion in existing Thing comments/mentions; offer a visible route to the linked Thing discussion. Do not create a competing chat system.

Acceptance: signed covers restricted by List access; failure does not leave a false success; cross-List linking denied; design/Thing navigation works in both directions.

Stages 1–5 complete all the agreed credential-free foundation features.

## Stage 6 — Handoff and actionable feedback

- Add an optional structured brief: intent, responsive behavior, loading/empty/error states, acceptance criteria and open questions. Search user-entered brief content.
- Add Create Thing from feedback using the existing creation/assignment UI and RPC; prefill title and exact design URL and persist the resource link.
- Use idempotent/atomic creation-and-linking where feasible. If linking fails after creation, retain the created Thing and offer a link retry instead of creating a duplicate.
- Reuse existing task status, assignments, due dates, comments and notification behavior.

Acceptance: brief persists; empty fields do not block simple add; feedback becomes one assigned Thing with the correct design reference; retry does not duplicate work.

## Stage 7 — Review evidence and decisions

Add review requests and decisions in a separate migration. A request has named reviewer, requester, due date, evidence, pending/approved/changes_requested/cancelled state. Use a single reviewer per request initially.

- Upload a screenshot/PDF export through private storage as immutable review evidence. Freeze submitted brief and link context for that request. A new revision creates a new review request.
- Only the assigned eligible reviewer can decide; owner/requester cancellation rules must be explicit. Enforce in database/server with atomic transitions.
- Submitted evidence cannot be replaced silently. Retain decision actor, timestamp, reason and evidence reference. A live embed is not immutable evidence.
- Show a My reviews queue and use existing notification infrastructure only for request/decision events. Katalist decisions do not synchronize to Figma.

Acceptance: unauthorized decision denied, duplicate/concurrent submissions handled, frozen evidence unchanged, private storage enforced, cancellation rules tested, notifications not duplicated. Qualified authorization review before production release.

## Stage 8 — QA, onboarding and release verification

- Add manually supplied staging links and checklists beside reviewed reference; no automatic visual comparison.
- Offer shared pinned reference collections for onboarding, distinct from personal favorites.
- Filter review state via Katalist review records; do not invent Figma readiness state.
- Test scoped database permissions, core mutations, browser flows, keyboard/mobile behavior and feature isolation. Run typecheck, relevant tests, and application-only build using actual current package scripts; document baseline unrelated failures.
- Pilot with one team. Measure design discovery, feedback-to-Thing and review turnaround at team level, plus added data-entry effort. Targets are hypotheses, not proven savings.

## How to use this plan

Give Gemini the working instructions and Stage 1 first. Supply each next stage only after examining the prior stage's diff and checks. Do not ask it to implement all eight stages in one response. Stages 6–8 extend productivity workflows after the foundation works; validate their value in the employee pilot.
