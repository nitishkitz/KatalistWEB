# Katalist A–H remediation and production deployment handoff

**Date:** 2026-09-27
**Application commit:** `fc79042` on `katalist-plan/batch-a-baseline`
**Vercel production deployment:** `dpl_BgqWqhcCgtyV6gKHHebBBGvdFKbf`, status **Ready**, aliased to [katalist-web.vercel.app](https://katalist-web.vercel.app)
**Database project:** `dyxqlgnbwtbxxdfoiqva` (the same project ref in `supabase/config.toml` and the linked production environment)
**Viewport scope:** desktop and tablet only; no phone-size browser run

## What this turn changed

1. **CI/browser truth:** `.github/workflows/quality.yml` now enables synthetic Demo Persona mode for preview E2E. Authenticated preview helpers fail CI when the Demo tab is missing rather than silently skipping. `tests/e2e/preview/README.md` now correctly says these specs can write *preview-local* state and must use unreachable fixture Supabase settings.
2. **Deploy-safe build:** `package.json`'s `build` now runs only `vite build`; `db:migrate` remains an explicit separate command. The actual Vercel production build log showed `npm run build` → `vite build`, with no migration step.
3. **Court actions:** `ThingRow.tsx` routes Acknowledge, Nudge, and Sort through `runThingAction`'s shared per-Thing claim/outcome mechanism. Acknowledge preserves the old `rpcCatchThing` (catch-only) behavior; Sort uses `rpcSortThing`. Court/List/Bucket/Nudges-related caches are invalidated after success, with epoch checks and a synchronous local busy guard. New tests assert the unchanged Acknowledge semantics and Sort patch.
4. **Honest controls:** compact Court's duplicate, inert `More filters`/`Filter` buttons were removed; the existing working quick-filter group has `aria-pressed`. Inert Magic Box voice-input buttons were removed from desktop and compact layouts. A tablet browser test exercises the live quick filters and confirms the dead affordances are absent.
5. **Bucket-note read cancellation:** `use-bucket-notes.ts` now passes React Query's signal through `withReadDeadline` to Supabase `.abortSignal()`. Its real-query test mock now verifies the signal.
6. **Bridge rollout and retry:** the three-argument `bridge_comment` migration retains the old two-argument signature during the deployment overlap, rather than dropping it. The new function handles a unique-key insert race with conflict-tolerant insert plus re-read. Its local SQL tests include old-caller compatibility. This is still not a live simultaneous-request proof.
7. **Deployment hygiene:** `.vercelignore` excludes local agent/config artifacts, generated browser output, test reports, and `.env` files from the source upload. The pre-existing T13–T15 working-tree code/tests needed for this tested build were committed with these fixes; the pre-existing `.agents/` and `output/` were deliberately not committed.

## Verification performed

| Gate | Result / qualification |
|---|---|
| TypeScript | `npm run typecheck` passed. |
| Unit/component/SQL suite | `npm test`: **884/884 passed**, 0 skipped. |
| Lint | 0 errors, 35 warnings. |
| Local production build | `npm run build` passed and did **not** execute `db:migrate`. |
| Browser preview | **61 passed / 7 expected opposite-breakpoint skips / 0 failed** across 768×1024, 1024×768, 1440×900, and 1920×1080. Fake/unreachable Supabase settings and synthetic demo mode were used; this is not live RLS proof. |
| Supabase migration dry run before apply | Exactly two pending migrations: `20260925110000_morning_brief_exact_dismiss.sql` and `20260926120000_bridge_comment_idempotency.sql`. |
| Supabase application | Both above migrations applied with `supabase db push --linked --yes`. Follow-up dry run reports `upToDate: true` and zero pending migrations. |
| Deployed function check | Read-only `pg_proc` query verified old/new Bridge comment signatures are service-role executable but not anon/authenticated executable; old/new Morning Brief dismiss signatures are authenticated/service-role executable but not anon executable. |
| Vercel | Direct production deploy completed; Vercel inspect reports `Ready`, aliases include `katalist-web.vercel.app`. Hosted build log showed migration-free `vite build` on Node 24. |
| Production smoke | `/welcome`, `/auth`, the owner's existing List URL, and an invalid Bridge token URL returned HTTP 200. In the browser, the existing authenticated Nithesh Court loaded real lane rows and the supplied Sayxon List detail loaded. No production record was created or edited during this smoke check. |

## What is **not** closed by this deployment

- The full A–H audit is **not** reclassified as complete. The earlier independent audit's C-01/C-02/H-01 representative-data request/latency work, E-03 due-edit draft decision, G-06 native confirmation polish, and H-04 successful comment-submit blob ownership/heap trend are still named residuals.
- A real **two-account** mounted membership-revocation/reconnect run, real camera/mic calls on two devices, and a live Bridge positive/negative authorization test with disposable grants were not performed. The browser smoke was read-only against existing data.
- Bridge's conflict-tolerant SQL now has a concurrency-safe shape, but two truly concurrent HTTP requests were not exercised against an isolated disposable grant. PGlite proves sequential idempotency and old signature compatibility only.
- Hosted GitHub Actions has not run for `fc79042` because the branch was **not pushed**. The local CI configuration fix and preview run do not substitute for its hosted artifact.
- Morning Brief's deployed cross-device claim atomicity and actual 07:00/timezone behavior were not retested live. The exact-date dismiss function/grants were verified present.
- The static OTP configuration requested by the owner was **not removed or changed**. Its production restriction still needs its separate release/security review.
- Phone-size screens remain excluded by the owner's explicit instruction. Desktop VoiceOver and physical-tablet touch review remain external checks.

## Commit and rollout notes

`fc79042` is a normal new commit; no branch history was rewritten, force-pushed, rebased, or amended. The deployment was made from this local committed tree with Vercel CLI; it was **not** pushed to GitHub/Lovable. If GitHub/Lovable synchronization is desired, push this branch through the normal non-force workflow and inspect the hosted CI result before merging. Do not claim that a local Vercel deployment is a GitHub CI pass.

The original [independent audit](KATALIST_A_TO_H_INDEPENDENT_CODE_AUDIT_2026-09-27.md) remains a preserved *pre-remediation snapshot*. Its confirmed findings above were fixed as stated here; its unclosed partial/external findings remain open until their own evidence exists.
