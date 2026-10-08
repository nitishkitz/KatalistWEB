# Code Activity

Read-only GitHub activity for a List: pull requests, pushes, files, patches and checks, with optional Coey drafts and
confirmed Thing creation. **Development-only in the UI and off in every database gate by default.** No mock data exists in
the runtime; fixtures and the old preview harness live in `scripts/fixtures/code-activity/` and are used by tests only.

The plan, contracts, SQL drafts, tests and the release runbook are in `output/code-activity-execution/` (start with
`runbook.md`, which also lists what has never been run). The SQL there is **not applied** and is not in `supabase/migrations/`.

## Run it

```sh
npm run dev
```

Sign in normally and open a List's **Code Activity** tab. Until an operator configures the GitHub App and an approved
schema is applied, it shows "GitHub connection is not configured yet". The tab appears only when Vite runs in development and
`VITE_CODE_ACTIVITY_PREVIEW` is absent or `"true"`. That is a visibility gate, **not** authorization; production builds never render it.

## Layout

| Path | Purpose |
|---|---|
| `server/*.server.ts` | Server only (the suffix keeps them out of the client bundle). Config, PKCE and cookie helpers, the GitHub client and read layer, connection service, refresh/feed/detail, webhook intake, drain and reconcile, AI, confirmed creation |
| `live/` | The only place the browser talks to the API (`api.ts`), plus validators, the connection and feed hooks, and the live adapter |
| `CodeActivityRoot.tsx` | Lazy entry: connection states and, when connected, `ActivityView` |
| `ActivityView.tsx`, `ActivityFeed.tsx`, `ActivityRow.tsx` | Feed, filters, Refresh, click-open overlay |
| `ChangeInspector.tsx`, `FileDiff.tsx`, `ChecksPanel.tsx`, `CoeyDraftReview.tsx` | One change: overview, files, checks, Thing creation, Coey |
| `ConnectionPanels.tsx` | Not configured, connect, repository selection, manage |
| `types.ts`, `format.ts`, `access.ts`, `limits.ts` | Domain types and guards, formatting, role rules, limits |

## Rules the code keeps

- Authorization is checked first, by database functions that run as the caller; only then does a server-only function read
  the connection and call GitHub with a token narrowed to one repository. GitHub is only ever read.
- Provider text (descriptions, patches, check names) is rendered as text, never as markup.
- Unknown is `null`, never zero. A failed read is "unavailable", never "none" or "passed".
- Every failure is feature-local: the error boundary sits outside the lazy chunk, and Things, Chat and Members are unaffected.
- AI is off until the operator flag, a configured model key **and** the owner's consent are all on. Nothing is created from a
  draft or a webhook without a person confirming it.

## Tests

```sh
npm test                                         # includes scripts/code-activity-*.test.mjs
node --test output/code-activity-execution/g03/g03-security.test.mjs   # and g07, g12, g14, g15
```

`output/code-activity-execution/g10/integration.test.mjs` runs the real services against the real SQL drafts.
`tests/e2e/preview/code-activity-live.spec.ts` is a real-browser acceptance spec that has never been run.
