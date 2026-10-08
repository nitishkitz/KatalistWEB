# Code Activity — GitHub Provider Evidence

Status: supporting evidence for `contracts.md`. Research performed 7 October 2026 against docs.github.com. Pages are quoted or paraphrased from what the fetch returned. GitHub documentation changes, so re-verify at the start of T14.

Evidence grades:
- **OFFICIAL**: stated on a docs.github.com page I retrieved.
- **SECONDARY**: reported only by a community post or search summary. Do not build on it without confirmation.
- **NOT FOUND**: I looked and the official pages were silent.

## 1. Installation and user authorization

| Claim | Grade | Source |
|---|---|---|
| The installation URL is `https://github.com/apps/APP-NAME/installations/new`. A `state` query parameter may be added "to preserve the state of the application page and return people back to that state after they install, authenticate, or accept updates." | OFFICIAL | [Sharing your GitHub App](https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app) |
| With "Request user authorization (OAuth) during installation" selected, the Setup URL cannot be entered. "Users will instead be redirected to the Callback URL as part of the authorization flow." Up to 10 callback URLs may be registered. | OFFICIAL | [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) |
| The authorize endpoint is `https://github.com/login/oauth/authorize`. `client_id` is required. `redirect_uri`, `state`, `code_challenge`, and `code_challenge_method` are "strongly recommended." Code exchange is `POST https://github.com/login/oauth/access_token` with `client_id`, `client_secret`, `code`. | OFFICIAL | [Generating a user access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app) |
| If the returned `state` does not match, "the request cannot be trusted, and the web application flow should be aborted." | OFFICIAL | same |
| A user access token "only has permissions that both the user and the app have." By default it expires after 8 hours. Refresh tokens, when enabled, expire after 6 months. | OFFICIAL | same |
| Installations and repositories a user token can reach are checked with `GET /user/installations` and `GET /user/installations/{installation_id}/repositories`. `per_page` maximum is 100. Installation objects include `id`, `account`, `suspended_at`, and `repository_selection` (`all` or `selected`). | OFFICIAL | same; [REST installations](https://docs.github.com/en/rest/apps/installations) |
| The redirect URL "must exactly match the callback URL." Wildcard matching exists but "can expose your app to security risks." | OFFICIAL | [About the user authorization callback URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url) |
| The callback redirect carries `code` and, when sent, `state`. | OFFICIAL | user access token page above |
| The callback redirect also carries `installation_id` and `setup_action`. | **SECONDARY** (community discussions and a third-party pull request surfaced by search; the official pages I retrieved do not enumerate them) | search results only |
| PKCE can be used when the OAuth flow is begun through the installation URL. | **NOT FOUND** | |
| What happens when the owner starts from the installation URL and the app is already installed on that account. | **NOT FOUND** | |

Design consequence: treat `installation_id` in the redirect as an unverified hint. Prove the actor can reach the installation by calling `GET /user/installations` with the exchanged user token.

## 2. Server credentials

| Claim | Grade | Source |
|---|---|---|
| App JWT: algorithm RS256. Claims `iat` (set 60 seconds in the past), `exp` (at most 10 minutes ahead), `iss` (client ID recommended, application ID accepted). | OFFICIAL | [Generating a JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app) |
| Installation token: `POST /app/installations/{installation_id}/access_tokens`. Expires after 1 hour. The body accepts `repository_ids` (or `repositories`), up to 500, and `permissions` to narrow the token. | OFFICIAL | [Installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app) |

## 3. Permissions needed for the read endpoints

| Endpoint | Fine-grained permission (read) | Grade |
|---|---|---|
| `GET /repos/{owner}/{repo}/pulls`, `…/pulls/{n}`, `…/pulls/{n}/files` | Pull requests | OFFICIAL ([permissions required](https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps)) |
| `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` | Checks | OFFICIAL |
| `GET /repos/{owner}/{repo}/commits/{ref}/status` | Commit statuses | OFFICIAL |
| `GET /repos/{owner}/{repo}/commits/{ref}` and `…/compare/{basehead}` | Contents | OFFICIAL |
| `GET /installation/repositories`, `GET /repositories/{id}` | not listed on that page | NOT FOUND (Metadata read is mandatory for every app; this was not re-confirmed) |

## 4. Webhooks

| Claim | Grade | Source |
|---|---|---|
| Signature header `X-Hub-Signature-256`, HMAC-SHA256 hex digest over the raw payload, prefixed `sha256=`. Use a constant-time comparison. Legacy `X-Hub-Signature` (SHA-1) is deprecated. Proxies must not alter the body. | OFFICIAL | [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) |
| Respond with a 2XX "within 10 seconds." Queue work for background processing. `X-GitHub-Delivery` is unique per event, and a redelivery keeps the original value. | OFFICIAL | [Best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) |
| Payloads are capped at 25 MB. A larger event is not delivered. | OFFICIAL | [Events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads) |
| Headers include `X-GitHub-Event`, `X-GitHub-Delivery`, `X-GitHub-Hook-ID`, `X-Hub-Signature-256`, `X-GitHub-Hook-Installation-Target-Type`, `X-GitHub-Hook-Installation-Target-ID`. | OFFICIAL | same |
| GitHub "does not automatically redeliver failed deliveries." | OFFICIAL | [Handling failed deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries) |
| Delivery logs are retained for 3 days. Deliveries from the past 3 days can be listed and redelivered. | OFFICIAL | [Redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks); [changelog](https://github.blog/changelog/2023-10-17-webhook-delivery-logs-will-only-be-retained-for-3-days/) |
| App webhook delivery API: `GET /app/hook/deliveries` (JWT; `per_page` max 100; `cursor`; `status`), `GET /app/hook/deliveries/{delivery_id}`, `POST /app/hook/deliveries/{delivery_id}/attempts`. | OFFICIAL | [REST app webhooks](https://docs.github.com/en/rest/apps/webhooks) |
| GitHub App events available: `push`, `pull_request`, `check_run`, `check_suite`, `status`, `installation`, `installation_repositories`, `github_app_authorization`. `installation` and `installation_repositories` are delivered by default. | OFFICIAL | events page |
| `installation` actions: `created`, `deleted`, `new_permissions_accepted`, `suspend`, `unsuspend`. `installation_repositories` actions: `added`, `removed`. | OFFICIAL | same |
| `check_run` actions: `completed`, `created`, `requested_action`, `rerequested`. Read access to Checks is required. | OFFICIAL | same |
| `push` carries `ref`, `before`, `after`, `head_commit`, and at most 2048 `commits`. Read access to Contents is required. | OFFICIAL | same |
| `pull_request` carries `number`, `pull_request.head.sha`, `pull_request.base.ref`, `pull_request.merged`, `pull_request.state`. Read access to Pull requests is required. | OFFICIAL | same |
| `status` carries `sha`, `state` (`pending`, `success`, `failure`, `error`), `context`. Read access to Commit statuses is required. | OFFICIAL | same |
| **Event ordering guarantees.** | **NOT FOUND**. The retrieved pages make no ordering promise. Assume events can arrive out of order. | |
| How long GitHub keeps retrying a slow receiver, and any automatic retry on non-2XX. | NOT FOUND beyond "does not automatically redeliver" | |

## 5. Reading changes

| Claim | Grade | Source |
|---|---|---|
| `GET /repos/{owner}/{repo}/pulls/{n}/files`: `per_page` max 100 (default 30); "Responses include a maximum of 3000 files." `status` values: `added`, `removed`, `modified`, `renamed`, `copied`, `changed`, `unchanged`. `patch` is optional in the schema. | OFFICIAL | [REST pulls](https://docs.github.com/en/rest/pulls/pulls) |
| Binary diffs have no `patch` property. Very large diffs may be omitted or time out with a 5xx. | SECONDARY (search summary of the same documentation family; thresholds not stated) | search results |
| `GET …/pulls/{n}` returns `additions`, `deletions`, `changed_files`, `mergeable`. The list endpoint `GET …/pulls` does not. | OFFICIAL | pulls page |
| `GET …/commits/{ref}/check-runs`: `per_page` max 100; `filter` is `latest` or `all`; `status` is `queued`, `in_progress`, or `completed`; `conclusion` is `success`, `failure`, `neutral`, `cancelled`, `skipped`, `timed_out`, `action_required`, or `null`. "If there are more than 1000 check suites on a single git reference," results are limited to the 1000 most recent. | OFFICIAL | [REST check runs](https://docs.github.com/en/rest/checks/runs) |
| A check run object carries `head_sha`, `app` (nullable), and `pull_requests`. | OFFICIAL | same |

## 6. Rate limits

| Claim | Grade | Source |
|---|---|---|
| Installation tokens: 5,000 requests per hour as the base. Installations with more than 20 repositories add 50 per hour per repository, and organizations with more than 20 users add 50 per hour per user, capped at 12,500. | OFFICIAL | [Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) |
| A primary-limit breach returns 403 or 429 with `x-ratelimit-remaining: 0`. Do not retry before `x-ratelimit-reset`. For secondary limits, honor `retry-after`, otherwise wait at least one minute and then back off exponentially. | OFFICIAL | same |
| Secondary limits: no more than 100 concurrent requests, 900 points per minute (GET is 1 point, writes are 5). | OFFICIAL | same |
| The current REST API version header shown in the retrieved pages is `X-GitHub-Api-Version: 2026-03-10`. | OFFICIAL | [REST installations](https://docs.github.com/en/rest/apps/installations) |

## 7. Hosting platform (Vercel), retrieved 7 October 2026

| Claim | Grade | Source |
|---|---|---|
| "The maximum payload size for the request body or the response body of a Vercel Function is 4.5 MB." Larger requests return 413 `FUNCTION_PAYLOAD_TOO_LARGE`. | OFFICIAL | [Vercel Functions limits](https://vercel.com/docs/functions/limitations) (page updated 24 Aug 2026) |
| With Fluid compute, maximum duration is 300 s default on Hobby, Pro, and Enterprise. Maximum is 300 s on Hobby and 800 s on Pro and Enterprise (1800 s extended, beta). Memory: 2 GB default; Pro and Enterprise up to 4 GB. | OFFICIAL | same |
| Cron jobs: Hobby limited to once per day, timing precision per hour (an entry set for 1:00 can run between 1:00 and 1:59). Pro and Enterprise: once per minute, per-minute precision. 100 cron jobs per project on every plan. | OFFICIAL | [Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) (updated 15 Jul 2026) |
| Whether a cron invocation can be duplicated or retried. | NOT FOUND in the retrieved page | |
| Whether production uses Vercel or Netlify, which plan, and whether Fluid compute is enabled. | NOT FOUND. The repository contains both `vercel.json` (two daily crons) and `netlify.toml` (Netlify build preset). | repository |
| `GET /installation/repositories`: no additional fine-grained permission required. | Reviewer's citation. My own retrieval of the endpoint page returned no permissions table, so T14 should re-confirm with a mocked call. | [REST installations](https://docs.github.com/en/rest/apps/installations) |

## 8. Not researched in this pass

- Sarvam API (no official documentation retrieved; T28 prerequisite).
- Vercel scheduler frequency and `waitUntil` support on the actual plan.
- GitHub App registration requirements for organization approval and private-repository access beyond the pages above.
