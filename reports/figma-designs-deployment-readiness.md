# Designs: deployment readiness and blockers

Date: 2026-10-08
Scope: the two Designs migrations and the code that uses them. Product plan: `reports/figma-productivity-plan.md`. Implementation plan: `reports/figma-gemini-implementation-plan.md`.

## Status in one line

Applied to the development database only (Supabase project `jrdsmmiggezrhiakncwc`, named Katalist_uat). **Not release-ready.** Three blockers are open; the first one blocks any deployment path.

## Blockers

### 1. Migration-ledger mismatch (blocks any `db push` or fresh-environment deployment)

- `supabase_migrations.schema_migrations` on the target contains **5 rows** (the Code Activity migrations, `20261007180021` to `20261008100000`).
- The repository contains **98** migration files. **93 of them are not in the ledger**, although their objects exist in the database. They were applied by direct SQL, so the ledger does not describe the schema.
- Consequence: `supabase db push` would treat those 93 files as unapplied and try to replay them. That must not be run against this database. Equally, inserting ledger rows to "catch up" would assert that files were applied and verified when they were not, so it must not be done blindly.
- The two Designs migrations were applied with `supabase db query --linked --file`, wrapped in `BEGIN; ... COMMIT;`. **No ledger rows were written for them.** The ledger is therefore still 5 rows.
- Resolution needed before release (owner decision, not done here): reconcile the ledger for the 93 older files against the live schema one by one (for example by diffing `supabase db pull` output), record only migrations whose effects are confirmed, and then decide how the two Designs files enter the ledger. Until then, deploy by applying single reviewed files.
- Do not: run a blanket `db push`; run `migration repair` in bulk; mark unverified migrations as applied.

### 2. Qualified security review not done

The plan requires a separate qualified review of the migration SQL, RLS, storage policies and RPC authorization before production release. A classifier or low-model sign-off does not satisfy that. The checks below are evidence for the reviewer, not a substitute.

### 3. Production has not been assessed

The target is a UAT/development project. The older production project named in earlier notes (`dyxqlgnbwtbxxdfoiqva`) is not visible to this account, so its migration state, grants and storage configuration are unknown. Nothing was deployed to production.

## What was applied to Katalist_uat, exactly

| Order | File | Notes |
|---|---|---|
| 1 | `supabase/migrations/20261009100000_design_resources.sql` | Applied unmodified first. |
| 1a | corrective grants | Immediately after, `REVOKE ALL ON the four design_* tables FROM PUBLIC, anon, authenticated` then `GRANT SELECT ... TO authenticated`. Supabase's default privileges had given `anon` and `authenticated` full DML (including TRUNCATE). Row-level security still blocked direct writes, but the grants were wider than intended. The statement was then added to the migration file, so the repository file now matches the resulting database state. |
| 2 | `supabase/migrations/20261009110000_design_covers_and_thing_designs.sql` | Applied unmodified. |

Objects created: tables `design_resources`, `design_folders`, `design_favorites`, `design_thing_links`; a private storage bucket `design-covers` (5 MiB limit, PNG/JPEG/WebP) with three object policies; RPCs `add_design_resource`, `update_design_resource`, `set_design_resource_archived`, `set_design_favorite`, `create_design_folder`, `rename_design_folder`, `delete_design_folder`, `link_design_thing`, `unlink_design_thing`, `set_design_cover`, `clear_design_cover`, `get_thing_designs`; helper functions in `katalist_priv`; one trigger on `public.things`.

No other pending migration was applied. Dependencies (lists, list_members, things, profiles, `list_role`, `katalist_priv` helpers, `set_updated_at`, storage columns, roles) were confirmed present first, and none of the design objects existed beforehand.

Current file hashes (SHA-256, first 16 hex characters):

- `20261009100000_design_resources.sql`: `1cc27374dc1bba5f` when first applied; `6cdfe9719f848adb` now, after the REVOKE was added to the file.
- `20261009110000_design_covers_and_thing_designs.sql`: `fca50f638a87df91`, unchanged since applied.

## Verified on the real development database

Signed-in API and storage checks (55 checks, disposable accounts): reads, add with database-derived identity, duplicate and invalid-host rejection, view-only and outsider denial, direct writes denied, anonymous denial, favorites privacy, cover upload and bucket MIME/size enforcement, signed URLs for members only, cover replace and cleanup, Thing links including cross-List denial, folders, archive and restore conflicts.

Signed-in browser checks, desktop (1440 px) and mobile (390 px), both passing all steps: opening the Designs tab; add, duplicate handling and edit; search, filter and favorites by keyboard; the prototype embed (official embed URL, frame navigated to figma.com with `node-id` and `starting-point-node-id` intact); Copy link; Open in Figma; cover upload, replace and removal with storage checked; link, open the Thing, see the exact frame link in Thing detail, return via "View in Designs", unlink; archive and restore; dialog focus trap and focus return; view-only behavior; no horizontal overflow.

One defect was found and fixed during this: "View in Designs" from a Thing on the same List did nothing because the route only read `?tab=designs` when the List changed. It now reacts to search changes and clears the parameters after use.

## Not verified

- FigJam, Slides and deck embeds (no sample files), private or signed-out Figma files, and version-pinned embeds (non-prototype embeds ignore `version-id`; the viewer says so).
- Concurrent duplicate creation from two real sessions (the unique index and `ON CONFLICT` path are tested only one request at a time).
- Screen-reader output and real touch devices.
- Behavior with more than one page of designs against real data (pagination was exercised only with mocks and small data).
- Limits: favorites load up to 1,000 per List, folders up to 200, linked Things per design up to 200, designs per Thing up to 50. Beyond that results are incomplete.
- On mobile, the filter controls stack and take most of the first screen before the first design appears. Functional, but worth a design pass.
- Production behavior of everything above.

## Test data left in Katalist_uat

Created by verification with disposable accounts and cleaned up as far as the database's append-only rules allow. History tables for Things are append-only, so these rows cannot be deleted without disabling that protection, which was deliberately not done.

- 3 disposable accounts `designs-verify-{a,b,d}-1791459371087@example.com`, banned, with their profiles and actors.
- 2 Lists named `designs-verify-...`, archived (hidden from List views); 2 Things, cancelled.
- 19 designs (all archived), 1 folder, 2 design-to-Thing links.
- 2 small test cover images in the private `design-covers` bucket, still referenced by archived designs. They cannot be cleared through the app because archived designs and archived Lists refuse cover changes.

None belong to or are visible to real users. No real account or List was modified.

## Do not do

- Run `supabase db push`, `migration repair` in bulk, or `npm run db:migrate` expecting it to deploy Supabase migrations (that script targets a separate database stack).
- Insert ledger rows for files that were not verified.
- Deploy to production before blockers 1 and 2 are resolved and blocker 3 is assessed.
