# Code Activity — Re-review request (architecture and authorization)

**Status: REQUESTED. NOT HELD.** No reviewer has accepted, and none is named here. Prepared 7 October 2026 for the reviewers recorded in `ledger.md` (Architecture: Codex chat; Authorization and sharing: Codex chat). This file does not send itself: the product owner must forward it. Nothing below is approved or frozen.

## What to review

| Document | Purpose |
|---|---|
| `contracts.md` (v3) | Data model, endpoints, flows, lifecycle, limits (unchanged, previously CHANGES REQUESTED) |
| `contract-delta.md` (v4.2) | Connection and proof schemas, new endpoints E16 to E18, flags, cookies, tokens, source mapping |
| `live-functionality-plan.md` | Gate order G00 to G16 and stop rules |
| `provider-evidence.md` | Provider and platform evidence |

Implemented so far (G02 only, no server, no schema): the safe shell under `src/features/code-activity/` and one boundary wrapper in `src/routes/lists.$listId.tsx`.

## Architecture questions

1. Is the additive `code_activity_*` model with one live connection per List and `generation` fencing sound? (delta section 1)
2. Are E16 (repository selection), E17 (connection status) and E18 (Refresh) the right surfaces, and are the error codes and statuses acceptable? (section 2)
3. Hosting (D17) is **OPEN**: the repository contains both `vercel.json` crons and `netlify.toml`. Is manual Refresh as the first milestone acceptable until the operator answers?
4. Do the provisional limits (v3 section 7) need measurement before they become contracts?
5. Is `repository_id` as identity with a refreshable display name correct? The repository-by-ID call is **UNVERIFIED** under a narrowed installation token. (Gap 2)

## Authorization and security questions

1. Does the proof design bind the GitHub user, the installation, the List, the Katalist profile and the browser nonce strongly enough? Is a fresh Bearer request at connect sufficient given the callback has no Bearer header?
2. Are owner-only mutations enforced inside `SECURITY DEFINER` functions so direct RPC or table access is exactly as safe as the route?
3. E1 disclosure: `{ enabled }` identical for everyone outside the List, `configured` for members only. Acceptable? (Gap 1)
4. Cookie: `HttpOnly; Secure; SameSite=Lax`, short life. Chromium accepted it on `http://localhost` in a same-origin probe. Firefox, Safari and the real GitHub redirect are **UNVERIFIED**. What is the minimum test evidence you require? (Gap 3)
5. Are narrowed installation tokens (repository ID plus minimum permissions per call) enforced strongly enough that a broader installation cannot leak other repositories?
6. View Only members read repository activity, checks and diffs by product decision (D3). Is the sharing acknowledgement flow adequate for private repositories?
7. Are the service-role write paths (callback, proofs, workers) narrow enough?

## Items corrected after the first v4.1 check (please review these specifically)

1. **Cookie path.** One cookie `ca_connect_nonce`, `Path=/api/code-activity`, now explicitly covers start, callback, repository selection, final connect and disconnect. Lifetime corrected: the callback re-issues it for 900 seconds so it outlives the 15 minute proof. (delta section 4)
2. **Table access.** A per-table matrix replaces the blanket read wording. States, settings, allowlist, deliveries, budget, confirmations and **selection proofs have no `authenticated` grant or policy**. Proof read and consume go through definer functions. Question 4 in the delta's proof-access list asks whether a route-supplied nonce hash is a sufficient binding. (delta section 1)
3. **Environment names.** Nine exact `CODE_ACTIVITY_*` names are listed, names only, nothing configured. The scheduler secret name stays OPEN. (delta section 5)

## Changes in v4.3 and the G03 draft (please review specifically)

1. **Connect signature completed:** `code_activity_connect(p_list_id, p_proof_id, p_nonce_hash, p_sharing_acknowledged)`. The nonce comparison is mandatory and bound to `profile_id = auth.uid()`, `list_id`, expiry, consumption and a server-set `installation_verified_at`. All failures return one identical error. Rationale and residual risk (RPC argument logging) are in delta section 1.
2. **Server reads defined.** `service_role` has no table privilege; server-only functions perform every read and write. The callback consumes state through `code_activity_server_consume_auth_state`; routes read proofs through `code_activity_server_get_proof`; provider calls read the connection through `code_activity_server_connection_for_provider`.
3. **View Only consent:** your recommendation (boolean only) is recorded as a proposal. The product owner has not decided it.
4. **G03 draft and tests** are in `g03/` (not a migration, not applied). Review `g03/README.md` first. New design points 1 to 7 there are mine and unreviewed.

## Known uncertainty to weigh

- Hosting, plan and scheduler are unknown. Push backfill completeness is untested. GitHub App creation has not happened, and no real GitHub request has ever been made.
- The Gap 3 probe ran in one browser. G02 was **not** verified in the real-login browser session because the Chrome tooling was unavailable.

## Requested outcome

For each of architecture and authorization: APPROVED, APPROVED WITH CONDITIONS, or CHANGES REQUESTED, with the reviewer's name, date and findings recorded in `ledger.md`. G03 stays blocked until both are recorded.
