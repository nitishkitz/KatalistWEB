# Realtime/Query-Key Ownership Inventory (P0)

Date: 2026-09-23
Baseline: `f9754233ec271f58494e67d019cc58f4df0f815d` on `katalist-plan/batch-a-baseline`
Node: v22.19.0
Method: read-only code inspection (no runtime measurement in this pass). All citations are file:line against the baseline commit above. This is an evidence record, not a design proposal — see the C1/C2 reconciliation doc for what to do with it.

## 1. `src/features/realtime/use-realtime.ts` — the global invalidation owner

Exports `useRealtimeInvalidation()`.

- Guard (line 10): `real = Boolean(session) && session?.user.app_metadata?.provider !== "demo"`. Effect (12-13) no-ops entirely when `!real` — demo mode gets no subscription at all.
- One channel per mount: `supabase.channel("katalist-movement")` (14-15).
- 10 `postgres_changes` handlers on that single channel, all `event: "*"` (fires on INSERT/UPDATE/DELETE alike — none is scoped to a specific operation):

| Table | Lines | Invalidates |
|---|---|---|
| `things` | 16-30 | `court`, `thing`, `list-things`, `lists`, `list`, `buckets`, `bucket`, `bucket-items`, `nudges`, `nudge-history`, `catchup`, `trophy`, `notifications` |
| `thing_comments` | 31-35 | `thing-comments`, `thing`, `court` |
| `thing_activity` | 36-41 | `thing-activity`, `thing`, `trophy`, `lists` |
| `nudges` | 42-48 | `nudges`, `nudge-history`, `catchup`, `thing`, `notifications` |
| `notifications` | 49-52 | `notifications`, `catchup` |
| `list_messages` | 53-62 | `list-messages`, `list`, `lists`, `hub-conversations` (comment 57-60: this is the hub rail's only live-refresh path — see §7) |
| `bucket_items` | 63-67 | `bucket`, `buckets`, `bucket-items` |
| `list_members` | 68-71 | `list`, `lists` |
| `list_meetings` | 72-75 | `list-meetings`, `upcoming-meetings` |
| `profile_object_state` | 76-78 | `invalidatePersonalSurfaces(qc)` (from `personal-shred.ts`), not inline keys |

- `.subscribe()` at 79; cleanup (81-83) `void supabase.removeChannel(channel)`.
- Effect deps `[qc, real]` (84) — re-subscribes when `real` flips, **not** when `session.user.id` changes. The channel itself carries no profile scoping, so an account switch that keeps `real === true` does not tear down and recreate the owner. This is the exact gap named in the C1/C2 review as "changing one live account to another leaves `real` true."

## 2-4. Root wiring

- `AppShell.tsx:12,28` — sole call site for `useRealtimeInvalidation()` in the tree (confirmed by grep). Centralized once at the shell layer, not per-feature-hook.
- `__root.tsx:135-150` — `QueryClientProvider` (fed by `Route.useRouteContext().queryClient`, line 136) wraps `AppContextProvider` → `ProfileDirectoryProvider` → `Outlet` + `CallRingProvider` + `PushRegistrar` + `Toaster`. No channel/invalidation code here.
- `router.tsx:6-26` — `getRouter()` constructs exactly one `new QueryClient({ defaultOptions: { queries: { retry: retryReadOnce } } })` (7, 14), `defaultPreloadStaleTime: 0` (22), injected into router context (20). One `QueryClient` for the whole app; no channel code.

## 5. `src/hooks/useSession.ts` — per-invocation auth listeners

- `useSession()` (146-207) registers its own `supabase.auth.onAuthStateChange(...)` (168) **inside a `useEffect` run once per calling component**, not from a shared provider/context. Also adds `window.addEventListener("katalist_auth_state_change", ...)` (66, 185) and `"storage"` (186) per mount.
- Cleanup (191-196): unsubscribes the auth listener, removes both window listeners.
- `refreshSession` (150-162) checks `getStoredDemoSession()` before `supabase.auth.getSession()` (158) — demo sessions never touch real Supabase auth state.
- Called independently from `AppShell`, `use-realtime.ts`, `use-conversations.ts`, `use-list-messages.ts`, `presence.ts`, and others — each is its own listener registration. **No centralized auth-listener/identity provider exists today.** (Per the plan's own constraint: this is a fact to design around, not license to build one unless a demonstrated lifecycle problem requires it.)

## 6. `src/domain/query-keys.ts` — factory classification

16 factories, all under one `keys` object (1-27):

| Key | Shape | Classification |
|---|---|---|
| `court` | `(profileId, context)` | profile+context |
| `thing` | `(thingId)` | entity-only |
| `lists` | `(profileId, context)` | profile+context |
| `list` | `(listId)` | entity-only |
| `buckets` | `(profileId, context)` | profile+context |
| `bucket` | `(bucketId)` | entity-only |
| `bucketItems` | `(bucketId)` | entity-only |
| `accessibleThings` | `(profileId, context)` | profile+context |
| `nudges` | `(profileId, context)` | profile+context |
| `nudgeHistory` | `(profileId, context)` | profile+context |
| `catchup` | `(profileId, context)` | profile+context |
| `listMeetings` | `(listId)` | entity-only |
| `profile` | `(profileId)` | profile-only — **defined but never referenced anywhere in the tree** (dead; see §"ad-hoc keys") |
| `trophy` | `(profileId)` | profile-only |
| `notifications` | `(profileId)` | profile-only |
| `shredded` | `(profileId)` | profile-only |
| `snoozed` | `(profileId)` | profile-only |

At least 18 raw string-array key prefixes used elsewhere in the tree (`list-messages`, `hub-conversations`, `thing-comments`, `thing-activity`, `doorman`, `list-things`, `upcoming-meetings`, `team-members`, `assignable-people`, `profile-directory`, `hub-files`, `hub-contacts`, `hub-contact-requests`, `hub-invitations`, `notifications-unread`, `conversation-unread-count`, `conversation-mention-count`, `hub-conversation` singular) have **no corresponding factory at all**.

## 7. `src/features/hub/use-conversations.ts`

- `useConversations()`: key `["hub-conversations", user?.id]` (170, raw, not via factory).
- Channel `supabase.channel("hub-conversations")` (180) — same literal string as the query-key prefix, different namespace, worth flagging for confusion risk.
- `.on("broadcast", { event: "changed" })` (181) → invalidates `["hub-conversations", user.id]` (182). `.subscribe()` (184); cleanup (185-187) `removeChannel`. Deps `[user, preview, qc]` (188).
- Comments (176-177, and `use-realtime.ts:57-60`) confirm: **nothing in the codebase sends a broadcast on this channel.** The hub rail's actual live-refresh path is the global `list_messages` postgres_changes handler in `use-realtime.ts`, not this listener.
- `useConversation(listId)` (196-246): separate key `["hub-conversation", listId, user?.id]` (201) — singular, easily confused with the plural key above. No channel of its own.

## 8. `src/features/lists/use-list-messages.ts`

- `useListMessages(listId)`: key `["list-messages", listId]` (100, raw, entity-only).
- `invalidate()` (106-109) invalidates both `["list-messages", listId]` and `["lists"]`.
- Channel `` supabase.channel(`list-chat:${listId}`) `` (117-118), per-list. `.on("broadcast", { event: "changed" })` (119) → `invalidate()` (120). Comment (111-113): broadcast is used deliberately here because RLS can suppress `postgres_changes` delivery for this table.
- Channel held in `useRef` (114, 123); every successful send/system/pin mutation (`onSuccess` at 177-180, 195-198, 215-218) calls both `invalidate()` and `broadcastChange()` (130-132, sends on the same channel) — this file is both sender and receiver on `list-chat:${listId}`.
- Cleanup (124-127) nulls ref, `removeChannel`. Deps `[listId, preview, hidden, qc]` (128).
- **Two independent live-update paths exist for `list_messages` simultaneously**: the global postgres_changes listener (prefix-wide `["list-messages"]` invalidation) and this per-list broadcast (exact `["list-messages", listId]` invalidation). Overlapping, not identical.

## 9. Calls — signaling, not query-cache concerns

- `call-room.ts` (`CallRoom`, 170-664): one channel per call, `` `call:${listId}` `` with `presence` + `broadcast` config (227-229). Broadcast events: `sdp`, `ice`, `reaction`, `draw`, `doc-page` (233-239); presence `sync` (240). No `queryClient` interaction anywhere in the file. Teardown in `leave()` (652-663): `untrack()` then `removeChannel`.
- `call-lobby.ts`: shared static name `LOBBY = "calls-lobby"` (22). `announceCall()` (50-69) creates its own channel instance, sends `"ring"` broadcast on `SUBSCRIBED`, tears itself down via a 2s `setTimeout` (68) — short-lived, not held open. `subscribeToRings()` (72-89) creates a **separate** channel instance against the same name, filters by `memberIds`/`fromDeviceId` (81-82), returns an unsubscribe closure. Multiple independent channel instances share one channel name rather than one owned/shared instance. No query-cache interaction.

## 10. `src/features/people/presence.ts` — the one already-correct ref-counted singleton

- Module-level singleton: `onlineIds`, `listeners`, `channel`, `refCount` (13-16).
- `ensureChannel(selfId)` (22-35): increments `refCount`; only creates `supabase.channel("presence:team", {...})` (25-27) if not already open (24) — one shared channel for the whole app regardless of caller count. Caveat: `selfId` used to key presence is whichever caller opens the channel first; a second caller with a different `selfId` while the channel is already open does not re-key it.
- `.on("presence", { event: "sync" })` (28) rebuilds `onlineIds`, `emit()`s to subscribers. `.subscribe()` callback (31) tracks self once `SUBSCRIBED`.
- `releaseChannel()` (37-46): decrements `refCount`; only at 0 does it clear state and `removeChannel`.
- `usePresence()` (49-65): `ensureChannel`/`releaseChannel` on mount/unmount/`selfId` change; reads via `useSyncExternalStore`. No query-cache interaction. **This file is the existing precedent for a tested, ref-counted, single-owner channel lifecycle** — worth reusing as a pattern reference for P7/P8, not reinventing from scratch.

## Grep sweep — every `supabase.channel(` call site

7 call sites, 5 files, 4 naming patterns (static/shared vs. per-entity-templated):

- `call-lobby.ts:51`, `call-lobby.ts:77` — both `LOBBY` (`"calls-lobby"`), two independent instances.
- `call-room.ts:227` — `` `call:${listId}` ``.
- `presence.ts:25` — `"presence:team"`.
- `use-conversations.ts:180` — `"hub-conversations"`.
- `use-list-messages.ts:118` — `` `list-chat:${listId}` ``.
- `use-realtime.ts:15` — `"katalist-movement"`.

## Grep sweep — every `postgres_changes` listener

All 10 in `use-realtime.ts` (lines listed in §1's table above), all `event: "*"`, all on the single `"katalist-movement"` channel. Zero postgres_changes listeners anywhere else in `src/`.

## Grep sweep — `invalidateQueries` call sites by key family

No `queryClient.invalidateQueries` literal exists anywhere — every call site uses a local `qc`. Grouped by family (file:line only; full list preserved from the raw inventory, condensed here to call-site counts per family):

- `court`: `use-realtime.ts:17,34`; `CourtWithOthersSidebar.tsx:71`; `MagicBox.tsx:319`; `personal-snooze.ts:87`; `ThingDetailContent.tsx:449`; `use-thing-comments.ts:145`; `personal-shred.ts:87`; `use-profile.ts:82`.
- `thing`: `use-realtime.ts:18,33,38,46`; `CourtWithOthersSidebar.tsx:70`; `ThingDetailContent.tsx:448,463`; `use-profile.ts:119`.
- `list-things`: `use-realtime.ts:19`; `MagicBox.tsx:321`; `personal-shred.ts:90`.
- `lists`: `use-realtime.ts:20,40,56,70`; `use-lists.ts:71,76`; `MagicBox.tsx:322`; `personal-shred.ts:88`; `use-profile.ts:83,116`; `use-list-messages.ts:108`.
- `list`: `use-realtime.ts:21,55,69`; `personal-shred.ts:89`; `use-profile.ts:117`; `lists.$listId.tsx:1496,1520,1734`.
- `buckets`: `use-realtime.ts:22,65`; `SpringLoadedBucketFlyout.tsx:107`; `use-buckets.ts:37,97,104`; `CourtBucketsSidePanel.tsx:51,154`; `use-bucket-items.ts:81`; `MagicBox.tsx:325`; `personal-shred.ts:98`; `ThingDetailContent.tsx:465`.
- `bucket`: `use-realtime.ts:23,64`; `SpringLoadedBucketFlyout.tsx:108`; `use-buckets.ts:96,103`; `CourtBucketsSidePanel.tsx:155`; `use-bucket-items.ts:80`; `personal-shred.ts:99`.
- `bucket-items`: `use-realtime.ts:24,66`; `SpringLoadedBucketFlyout.tsx:109`; `use-buckets.ts:105`; `CourtBucketsSidePanel.tsx:156`; `use-bucket-items.ts:79`; `personal-shred.ts:97`; `ThingDetailContent.tsx:466`.
- `nudges`: `use-realtime.ts:25,43`; `CourtWithOthersSidebar.tsx:68`; `personal-shred.ts:93`; `use-profile.ts:118`; `nudges.tsx:127`.
- `nudge-history`: `use-realtime.ts:26,44`; `CourtWithOthersSidebar.tsx:69`; `personal-shred.ts:94`; `nudges.tsx:128`.
- `catchup`: `use-realtime.ts:27,45,51`; `personal-snooze.ts:86`; `use-catchup.ts:212`.
- `trophy`: `use-realtime.ts:28,39`; `personal-shred.ts:96`.
- `notifications`: `use-realtime.ts:29,47,50`; `CourtWithOthersSidebar.tsx:72`; `use-profile.ts:120`; `use-notifications.ts:65,80`; `nudges.tsx:131`.
- `thing-comments` / `thing-activity`: `use-realtime.ts:32,37`; `use-thing-comments.ts:143,144`; `nudges.tsx:129,130`.
- `hub-conversations`: `use-realtime.ts:61`; `use-conversations.ts:182,190`.
- `list-messages`: `use-realtime.ts:54`; `personal-shred.ts:91`; `use-list-messages.ts:107,120`.
- `list-meetings` / `upcoming-meetings`: `use-realtime.ts:73,74`; `use-list-meetings.ts:58`.
- `profile` / `profile-directory` / `assignable-people` / `team-members`: `use-profile.ts:78-81,112-114` only.
- `shredded`: `personal-shred.ts:86`. `snoozed` / `accessible-things`: `personal-snooze.ts:86-88`.
- `doorman`: `use-doorman.ts:70,82`; `personal-shred.ts:92`; `me.tsx:494`.
- `hub-files`: `use-hub-files.ts:111`. `hub-contacts` / `hub-contact-requests` / `hub-invitations`: `use-contacts.ts:125,161,171-173`.

**Blanket invalidation**: `AppContextProvider.tsx:79` — `await qc.invalidateQueries();` with no `queryKey` at all. Invalidates the entire cache. Distinct from, and broader than, every keyed call site above.

**Direct cache reads/writes bypassing `invalidateQueries`**, in `src/features/things/query-updates.ts`:
- `qc.cancelQueries({ queryKey: ["court"] })` (41), `qc.cancelQueries({ queryKey: ["thing", thingId] })` (42) inside `cancelThingReads()`.
- `qc.getQueryData<Thing | null>(thingKey)` (203) / `qc.setQueryData(...)` (207) — optimistic single-Thing patch.
- `qc.getQueryCache().findAll({ queryKey: ["court"] })` (211), then per-match `getQueryData`/`setQueryData` (213, 221) — optimistic patch across every live `court`-family cache entry.
- A second similar pair (235-247) on another thing key + court-cache key, in a second exported function in the same file.

This file is a direct cache-mutation layer (Batch B's optimistic-update machinery) that runs independently of both the realtime hook and every ad-hoc `invalidateQueries` call above — any future ownership/lifecycle model must account for it explicitly, not just the invalidate/subscribe paths.

## Grep sweep — ad-hoc raw-array query keys (not built via `keys.xxx()`)

| Key shape | Call site | Note |
|---|---|---|
| `["upcoming-meetings"]` | `use-upcoming-meetings-reminder.ts:55` | unscoped |
| `["profile", user?.id ?? "none"]` | `use-profile.ts:24` | `keys.profile()` exists but is unused — drifted duplicate |
| `["list-things", listId]` | `use-list-things.ts:26` | no factory |
| `["profile-directory"]` | `directory.ts:174` | unscoped |
| `["assignable-people"]` | `use-assignable.ts:15` | unscoped |
| `["list", listId]` | `use-lists.ts:105` | `keys.list()` exists with the identical shape but is unused here — drifted duplicate |
| `["hub-files", listId, parentId]` | `use-hub-files.ts:105` | no factory |
| `["team-members"]` | `use-team.ts:43` | unscoped |
| `["thing-comments", thingId]` | `use-thing-comments.ts:46` | no factory |
| `["thing-activity", thingId]` | `use-thing-comments.ts:79` | no factory |
| `["conversation-unread-count", conversation.id, lastReadAt, conversation.lastAt]` | `chat-read-state.ts:66` | composite key mixing entity id with mutable timestamp values |
| `["conversation-mention-count", conversation.id, lastReadAt, conversation.lastAt, myId]` | `chat-read-state.ts:93` | same pattern, also profile-scoped |
| `["list-messages", listId]` | `use-list-messages.ts:100` | no factory |
| `["notifications-unread", user?.id]` | `use-notifications.ts:45` | parallel to `keys.notifications()`, which the same file also uses correctly elsewhere (line 24) |
| `["hub-conversations", user?.id]` | `use-conversations.ts:170` | no factory |
| `["hub-conversation", listId, user?.id]` | `use-conversations.ts:201` | singular — easily confused with the plural key above |
| `["hub-contacts"/"hub-contact-requests"/"hub-invitations", user?.id]` | `use-contacts.ts:65,99,142` | no factories |
| `["doorman", user?.id, context]` | `use-doorman.ts:32` | profile+context shape, mirrors the factory pattern but isn't centralized |
| `queryKey: key` (locally-computed variable) | `use-bucket-notes.ts:20` | third pattern — neither literal nor factory; not expanded further in this pass |

**Keys confirmed to use the factory correctly** (contrast set): `keys.court` (`use-court.ts:27`, `MagicBox.tsx:318`), `keys.lists` (`use-lists.ts:52,71,76`), `keys.buckets` (`use-buckets.ts:22,37`), `keys.bucket` (`use-buckets.ts:64`), `keys.bucketItems` (`use-bucket-items.ts:73`), `keys.accessibleThings` (`use-bucket-items.ts:43`), `keys.nudges`/`keys.nudgeHistory` (`use-nudges.ts:51,61`), `keys.catchup` (`use-catchup.ts:190`), `keys.listMeetings` (`use-list-meetings.ts:52,58`), `keys.trophy` (`use-trophy.ts:105`), `keys.notifications` (`use-notifications.ts:24,65,80`), `keys.shredded` (`personal-shred.ts:75`), `keys.snoozed` (`personal-snooze.ts:75`), `keys.thing` (`use-thing.ts:25`).

## Open questions this inventory surfaces (factual, not prescriptive)

1. 18+ raw-array key prefixes have no factory; at least 2 confirmed cases (`["list", listId]`, `["profile", ...]`) where a factory exists and a call site independently duplicates the same shape without using it — factory and call site have drifted apart.
2. Two independent live-update mechanisms for `list_messages` run simultaneously (global postgres_changes vs. per-list broadcast), invalidating overlapping but non-identical key shapes.
3. The `"hub-conversations"` broadcast channel has no confirmed sender anywhere in the tree — its only real refresh path today is the global `list_messages` postgres_changes handler.
4. `AppContextProvider.tsx:79` performs a full, keyless `qc.invalidateQueries()` — broader than every other call site.
5. `query-updates.ts` performs direct `getQueryData`/`setQueryData` optimistic writes against `["thing", id]` and every live `["court", ...]` entry, independent of the realtime hook and every ad-hoc invalidate call — any P3/P7 design must account for this layer explicitly.
6. `use-realtime.ts`'s effect depends on `[qc, real]`, not `session.user.id` — an account switch where `real` stays `true` throughout does not tear down/recreate the channel. This is the concrete mechanism behind the "identity changes" gap named in the C1/C2 review.
7. `presence.ts` is the one existing precedent in this codebase for a correctly ref-counted, single-owner channel lifecycle — a useful pattern reference, not a template to copy verbatim (it has its own caveat: `selfId` isn't re-keyed if a second distinct identity calls `ensureChannel` while the channel is already open).
