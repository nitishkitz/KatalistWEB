# Code Activity: operator setup (GitHub App and local environment)

One-time setup per environment. Users never do this: they connect inside Katalist. Nothing here is applied by the code; the operator performs it. **Never paste a secret into chat or commit it.** GitHub's settings labels can change, so match by meaning if a label differs.

## 1. Register a GitHub App (use a test account or organization first)

| Setting | Value |
|---|---|
| Name / Homepage URL | Any (for example "Katalist Code Activity (dev)") |
| Callback URL | `http://localhost:8080/api/code-activity/github/authorize/callback` for local development. One exact URL per environment; add the HTTPS URL for a deployed environment only when that environment is set up |
| Expire user authorization tokens | On |
| Request user authorization (OAuth) during installation | On (this disables the Setup URL) |
| Webhook | **Inactive / unchecked for now.** Webhooks arrive with G11 |
| Repository permissions | Metadata: Read. Pull requests: Read. Checks: Read. Commit statuses: Read. Contents: Read. **No write permission anywhere.** No organization or account permissions |
| Where it can be installed | "Only on this account" for the first test |

After creating it, note the **App ID**, **App slug** (the name in `github.com/apps/<slug>`), and **Client ID**. Generate a **client secret** and a **private key** (a `.pem` download). Install the App on one **test repository you own** using **Only select repositories**.

## 2. Environment variables (names are final for this build; values come only from step 1)

Put them in `.env.local` for `npm run dev` (that file is not committed) or the host's secret store. Restart the dev server after editing.

```
CODE_ACTIVITY_GITHUB_APP_ID=
CODE_ACTIVITY_GITHUB_APP_SLUG=
CODE_ACTIVITY_GITHUB_CLIENT_ID=
CODE_ACTIVITY_GITHUB_CLIENT_SECRET=
CODE_ACTIVITY_GITHUB_PRIVATE_KEY=        # the PEM, with \n for newlines, or the whole PEM base64-encoded
CODE_ACTIVITY_STATE_SECRET=              # 32+ random characters, for example: openssl rand -base64 48
CODE_ACTIVITY_GITHUB_CALLBACK_URL=http://localhost:8080/api/code-activity/github/authorize/callback
CODE_ACTIVITY_ALLOWED_ORIGINS=http://localhost:8080
```

Production requires `https` for both the callback URL and the allowed origins; `http` is accepted only for a loopback host outside production. A missing or invalid value switches Code Activity to "not configured" and nothing else.

## 3. Database (blocked on schema approval)

The routes call database functions that exist only in the **unapplied** G03 draft. Until the reviewed schema is applied to a database, the tab stays on "GitHub connection is not configured yet", whatever the environment holds. After approval, the operator enables it by SQL console (no product UI can): insert `('master', 'true'::jsonb)` into `code_activity_settings`, and the test List's id into `code_activity_list_allowlist`.

## 4. First live exercise (after steps 1 to 3)

1. `npm run dev`, sign in normally, open the allowlisted test List, open Code Activity as its owner.
2. Connect GitHub, authorize, choose the test repository, tick the sharing acknowledgement, connect.
3. Reload: the connection must persist. Open the List as a collaborator and as View Only: both see it, neither sees Manage.
4. Disconnect, then reconnect.

Test in Chrome first. Firefox and Safari handling of the nonce cookie is not yet verified.


## Fastest path for local development (added after the connector card work)

One command registers a **private, read-only** App through GitHub's manifest flow and writes the eight server settings into an uncommitted `.env.local`. You click through GitHub; nothing is created until you confirm there. No secret is printed, and the file is written readable by its owner only.

```sh
node scripts/code-activity-bootstrap.mjs            # add  --org <organization>  to register under an organization instead
```

1. Open the printed `http://127.0.0.1:8787/` in the browser where you are signed in to GitHub, continue, review the read-only permissions, and choose **Create GitHub App**.
2. The command writes `CODE_ACTIVITY_GITHUB_APP_ID`, `_APP_SLUG`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_PRIVATE_KEY`, `CODE_ACTIVITY_STATE_SECRET`, `_CALLBACK_URL`, `CODE_ACTIVITY_ALLOWED_ORIGINS` (and the webhook secret if GitHub returns one). Other lines in `.env.local` are kept as they were.
3. Restart `npm run dev`.
4. Install the App on **one test repository you own**, choosing *Only select repositories* (the command prints the link).
5. Check without exposing values: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs scripts/code-activity-config-check.mjs`. It lists each variable as ok, MISSING or INVALID. Then confirm the *running server* has them: an unauthenticated `GET /api/code-activity/github/authorize/callback` answers **503** while settings are missing and **400** once the server has loaded them.

What the manifest requests: private App, read-only Metadata, Pull requests, Checks, Commit statuses and Contents, the exact local callback, OAuth on install, no webhook configuration and no events. The optional webhook configuration is omitted because GitHub rejects localhost hook URLs even with `active:false`. Configure a real public HTTPS receiver separately before enabling webhooks. The manifest flow was run successfully against GitHub on 7 Oct 2026; see `local-connector-activation.md` for the exact deployed scope and remaining processing-migration blocker.

The App is created under your account. An App for other users later needs its installation availability widened and a deployed callback URL; that is a separate operator decision. Katalist cannot use a Codex or other existing GitHub connection as a credential: each user authorizes their own account inside Katalist.
