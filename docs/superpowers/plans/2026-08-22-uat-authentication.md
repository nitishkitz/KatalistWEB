# UAT Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-local fixed-OTP personas with a UAT-only server broker that accepts `111111`, creates a fully profiled Supabase user only after required fields are valid, and returns a normal Supabase session.

**Architecture:** Shared pure validation normalizes phones and profiles on both client and server. UAT API routes delegate to a dependency-injected server broker; the broker gates the environment, rate-limits attempts in Supabase, derives a deterministic phone password with HMAC, creates users through the Admin API, and signs in through a non-persisting server Supabase client. The existing Auth page calls this flow only when `VITE_KATALIST_ENV=uat`; demo and production remain separate.

**Tech Stack:** TypeScript 5.7, React 19, TanStack Start file routes, Supabase JS 2.112, Postgres/Supabase Auth, Node `crypto`, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-22-uat-auth-firebase-notifications-design.md`

**Execution order:** Complete this plan before `docs/superpowers/plans/2026-08-22-firebase-web-notifications.md`.

## Global Constraints

- UAT requires both `VITE_KATALIST_ENV=uat` and `KATALIST_ENV=uat`.
- The universal OTP is exactly `111111` and must be read server-side from `KATALIST_UAT_FIXED_OTP`.
- No Auth user, profile, actor, or Storage object may be created before Full name, Age, and Occupation pass server validation.
- Full name and Occupation are normalized to 1–100 characters; Age is an integer from 1 through 120.
- Profile photo is selectable and the UI must not display the word “optional.”
- UAT users receive real Supabase sessions and normal RLS permissions; no `provider: "demo"` session is allowed.
- Service-role keys, auth pepper, derived passwords, access tokens, and refresh tokens must never enter logs or client bundles.
- Existing uncommitted user changes must be preserved unless a listed file is deliberately replaced by this plan.

---

### Task 1: Shared UAT and profile contracts

**Files:**
- Create: `src/lib/auth/profile-validation.ts`
- Create: `src/lib/auth/uat-contract.ts`
- Create: `scripts/uat-auth-contract.test.mjs`
- Modify: `src/lib/auth/local-user.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `normalizePhone(value: string): string | null`
- Produces: `validateRequiredProfile(input: unknown): ProfileValidationResult`
- Produces: `isUatClient(env: ImportMetaEnv): boolean`
- Produces: `UatVerifyRequest` and `UatVerifyResponse`
- Consumes: no server secrets and no Supabase client.

- [ ] **Step 1: Write failing contract tests**

Create tests covering normalization, length limits, whitespace normalization, age boundaries, and client UAT gating:

```js
test("normalizes a valid phone and rejects invalid values", () => {
  assert.equal(normalizePhone("+91 98765 43210"), "+919876543210");
  assert.equal(normalizePhone("12345"), null);
  assert.equal(normalizePhone(`+${"1".repeat(16)}`), null);
});

test("requires a complete normalized profile", () => {
  assert.deepEqual(validateRequiredProfile({ fullName: "  Naga   Reddy ", age: "29", occupation: " Designer " }), {
    ok: true,
    value: { fullName: "Naga Reddy", age: 29, occupation: "Designer" },
  });
  assert.equal(validateRequiredProfile({ fullName: "", age: "0", occupation: "" }).ok, false);
  assert.equal(validateRequiredProfile({ fullName: "A", age: "29.5", occupation: "B" }).ok, false);
});

test("client UAT mode requires the exact public flag", () => {
  assert.equal(isUatClient({ VITE_KATALIST_ENV: "uat" }), true);
  assert.equal(isUatClient({ VITE_KATALIST_ENV: "production" }), false);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/uat-auth-contract.test.mjs`

Expected: FAIL because `profile-validation.ts` and `uat-contract.ts` do not exist.

- [ ] **Step 3: Implement the pure contracts**

Use this discriminated shape so the Auth page and server route agree:

```ts
export type RequiredProfile = { fullName: string; age: number; occupation: string };
export type ProfileFieldErrors = Partial<Record<"fullName" | "age" | "occupation", string>>;
export type ProfileValidationResult =
  | { ok: true; value: RequiredProfile }
  | { ok: false; errors: ProfileFieldErrors };

export type UatVerifyRequest = {
  phone: string;
  otp: string;
  profile?: { fullName: string; age: string; occupation: string };
};
export type UatSessionPayload = { access_token: string; refresh_token: string };
export type UatVerifyResponse =
  | { status: "needs_profile" }
  | { status: "authenticated"; session: UatSessionPayload };
```

Make `src/lib/auth/local-user.ts` reuse `validateRequiredProfile` rather than retaining a second set of validation rules.

- [ ] **Step 4: Document environment names**

Add these exact entries without real secrets:

```dotenv
VITE_KATALIST_ENV=development
KATALIST_ENV=development
# UAT server only:
# KATALIST_UAT_FIXED_OTP=111111
# KATALIST_UAT_AUTH_PEPPER=
# SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 5: Run focused tests and commit**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/uat-auth-contract.test.mjs scripts/local-fixed-otp-auth.test.mjs`

Expected: PASS.

```bash
git add .env.example src/lib/auth/profile-validation.ts src/lib/auth/uat-contract.ts src/lib/auth/local-user.ts scripts/uat-auth-contract.test.mjs scripts/local-fixed-otp-auth.test.mjs
git commit -m "test: define UAT authentication contracts"
```

### Task 2: Profile fields and persistent rate limiting

**Files:**
- Create via Supabase CLI: `supabase/migrations/*_uat_profile_and_rate_limits.sql`
- Create: `supabase/tests/database/uat_profile_and_rate_limits.test.sql`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Produces: nullable `profiles.age smallint` and `profiles.occupation text`.
- Produces: service-role-only `public.consume_uat_auth_rate_limit(p_scope_hash text, p_limit integer, p_window_seconds integer)` returning `boolean`.
- Consumes: `handle_new_user()` metadata keys `age`, `occupation`, and `uat_profile_complete`.

- [ ] **Step 1: Create the migration through the CLI**

Run `npx supabase --help`, `npx supabase migration --help`, then:

```bash
npx supabase migration new uat_profile_and_rate_limits
```

Use the exact path printed by the CLI for every following edit and commit.

- [ ] **Step 2: Write the failing database test**

The pgTAP test must assert:

```sql
select has_column('public', 'profiles', 'age');
select has_column('public', 'profiles', 'occupation');
select has_table('katalist_priv', 'uat_auth_rate_limits');
select function_privs_are(
  'public', 'consume_uat_auth_rate_limit',
  array['text','integer','integer'], 'anon', array[]::text[]
);
select function_privs_are(
  'public', 'consume_uat_auth_rate_limit',
  array['text','integer','integer'], 'authenticated', array[]::text[]
);
```

Also create an Auth user with metadata `{full_name, age, occupation, uat_profile_complete: true}` and assert one profile and one actor are created with those values.

- [ ] **Step 3: Run the database test and confirm RED**

Run: `npx supabase test db supabase/tests/database/uat_profile_and_rate_limits.test.sql`

Expected: FAIL because the columns, table, and function do not exist.

- [ ] **Step 4: Implement the migration**

The migration must:

```sql
alter table public.profiles add column if not exists age smallint;
alter table public.profiles add column if not exists occupation text;
alter table public.profiles add constraint profiles_age_valid
  check (age is null or age between 1 and 120);
alter table public.profiles add constraint profiles_occupation_valid
  check (occupation is null or char_length(btrim(occupation)) between 1 and 100);
```

Create `katalist_priv.uat_auth_rate_limits` keyed by a server-generated HMAC scope hash, with window start and attempt count. Enable RLS as defense in depth, grant the table only to `service_role`, and implement the function with `SECURITY DEFINER`, a fixed search path, `FOR UPDATE`, and an atomic insert/update. Revoke function execution from `PUBLIC`, `anon`, and `authenticated`; grant it only to `service_role`.

Update `public.handle_new_user()` so metadata marked `uat_profile_complete=true` must contain valid Full name, Age, and Occupation before it inserts the profile. For non-UAT users, preserve the current backward-compatible behavior. Insert `age` and `occupation` into the profile.

- [ ] **Step 5: Regenerate public database types**

Run `npx supabase gen types --help`, then use the project's linked/local command to replace `src/integrations/supabase/types.ts`. Confirm `profiles.Row`, `Insert`, and `Update` contain:

```ts
age: number | null;
occupation: string | null;
```

- [ ] **Step 6: Run tests, advisors, and commit**

Run:

```bash
npx supabase test db supabase/tests/database/uat_profile_and_rate_limits.test.sql
npx supabase db advisors --local
npx supabase migration list --local
```

Expected: tests pass; no new security advisor findings; migration is listed once.

```bash
git add supabase/migrations supabase/tests/database/uat_profile_and_rate_limits.test.sql src/integrations/supabase/types.ts
git commit -m "feat: persist required UAT profile fields"
```

### Task 3: Server-side UAT authentication broker

**Files:**
- Create: `src/lib/auth/uat-auth.server.ts`
- Create: `src/integrations/supabase/auth-client.server.ts`
- Create: `scripts/uat-auth-server.test.mjs`

**Interfaces:**
- Consumes: `normalizePhone`, `validateRequiredProfile`, `UatVerifyRequest`, `supabaseAdmin`.
- Produces: `requestUatOtp(input, context, deps): Promise<{ok: true}>`.
- Produces: `verifyUatOtp(input, context, deps): Promise<UatVerifyResponse>`.
- Produces: `createSupabasePasswordClient()` with `persistSession: false` and no service-role key.

- [ ] **Step 1: Write failing broker tests with injected dependencies**

Cover fail-closed behavior, invalid OTP, fresh profile response without writes, complete creation, returning login, concurrent create conflict, and rate limiting. Use spies such as:

```js
test("fresh valid OTP does not create before profile submission", async () => {
  const deps = fakeDeps({ profile: null });
  const result = await verifyUatOtp(
    { phone: "+919876543210", otp: "111111" },
    { ip: "203.0.113.8", env: validUatEnv },
    deps,
  );
  assert.deepEqual(result, { status: "needs_profile" });
  assert.equal(deps.createUserCalls.length, 0);
  assert.equal(deps.signInCalls.length, 0);
});

test("non-UAT returns a not-found error before dependencies run", async () => {
  await assert.rejects(
    verifyUatOtp(validInput, { ip: "203.0.113.8", env: { KATALIST_ENV: "production" } }, fakeDeps()),
    (error) => error.status === 404,
  );
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/uat-auth-server.test.mjs`

Expected: FAIL because the server broker does not exist.

- [ ] **Step 3: Implement server configuration and cryptography**

Create a server-only config reader that requires exact UAT mode, a six-digit OTP, pepper, Supabase URL, publishable key, and service-role key. Use Node crypto:

```ts
const password = createHmac("sha256", pepper)
  .update(`katalist-uat-auth:${phone}`, "utf8")
  .digest("hex");

const submitted = Buffer.from(input.otp.padEnd(6, "\0"));
const expected = Buffer.from(config.fixedOtp.padEnd(6, "\0"));
if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
  throw new UatAuthError(401, "The verification code is invalid.");
}
```

Hash `phone` and source IP separately with the same pepper before passing rate-limit scopes to the database. Never persist raw IP addresses in the rate-limit table.

- [ ] **Step 4: Implement create/sign-in orchestration**

The broker must call:

```ts
await supabaseAdmin.auth.admin.createUser({
  phone,
  password,
  phone_confirm: true,
  user_metadata: {
    full_name: profile.fullName,
    display_name: profile.fullName,
    age: profile.age,
    occupation: profile.occupation,
    role_label: profile.occupation,
    phone,
    uat_profile_complete: true,
  },
});
```

Then sign in through a separate publishable-key client:

```ts
const { data, error } = await passwordClient.auth.signInWithPassword({ phone, password });
if (error || !data.session) throw new UatAuthError(401, "Unable to sign in.");
return {
  status: "authenticated",
  session: {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  },
};
```

On duplicate creation, re-query `profiles.phone_e164`; sign in only if that row exists. Log only an operation name, safe error code, and request ID.

- [ ] **Step 5: Run tests and commit**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/uat-auth-server.test.mjs`

Expected: PASS.

```bash
git add src/lib/auth/uat-auth.server.ts src/integrations/supabase/auth-client.server.ts scripts/uat-auth-server.test.mjs
git commit -m "feat: add UAT Supabase auth broker"
```

### Task 4: UAT request and verify API routes

**Files:**
- Create: `src/routes/api/uat-auth/request.ts`
- Create: `src/routes/api/uat-auth/verify.ts`
- Create: `scripts/uat-auth-routes.test.mjs`

**Interfaces:**
- Consumes: `requestUatOtp`, `verifyUatOtp`.
- Produces: `POST /api/uat-auth/request` and `POST /api/uat-auth/verify` JSON contracts.

- [ ] **Step 1: Write failing route-handler contract tests**

Export dependency-injected handler factories from the server module so tests can create `Request` objects without loading route generation. Assert:

```js
assert.equal((await requestHandler(new Request(url, { method: "POST", body: "{" }))).status, 400);
assert.equal((await nonUatHandler(validRequest)).status, 404);
assert.deepEqual(await (await needsProfileHandler(validRequest)).json(), { status: "needs_profile" });
assert.deepEqual(await (await successHandler(validRequest)).json(), {
  status: "authenticated",
  session: { access_token: "access", refresh_token: "refresh" },
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/uat-auth-routes.test.mjs`

Expected: FAIL because route handlers do not exist.

- [ ] **Step 3: Implement routes with stable responses**

Both routes parse a maximum-size JSON body, derive IP from the first valid `x-forwarded-for` entry or `x-real-ip`, and set `cache-control: no-store`. Map errors to:

```ts
{ error: "invalid_request", message: "Check the information and try again." } // 400
{ error: "invalid_code", message: "The verification code is invalid." }       // 401
{ error: "rate_limited", message: "Too many attempts. Try again shortly." }    // 429
{ error: "unavailable", message: "Sign-in is temporarily unavailable." }       // 503
```

Do not return whether a phone exists. Outside UAT, return a plain `404` JSON response.

- [ ] **Step 4: Run tests and commit**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/uat-auth-routes.test.mjs scripts/uat-auth-server.test.mjs`

Expected: PASS.

```bash
git add src/routes/api/uat-auth/request.ts src/routes/api/uat-auth/verify.ts scripts/uat-auth-routes.test.mjs
git commit -m "feat: expose fail-closed UAT auth routes"
```

### Task 5: Auth page and real-session profile completion

**Files:**
- Modify: `src/routes/auth.tsx`
- Modify: `src/hooks/useSession.ts`
- Modify: `src/lib/session-mode.ts`
- Modify: `src/features/me/use-profile.ts`
- Create: `src/features/me/avatar-upload.ts`
- Create: `scripts/uat-auth-ui.test.mjs`
- Modify: `scripts/katalist-multipersona.test.mjs`
- Delete after replacement: `src/lib/fixed-otp.ts`

**Interfaces:**
- Consumes: `isUatClient`, `validateRequiredProfile`, UAT API responses, `supabase.auth.setSession`.
- Produces: `uploadAvatarForUser(userId: string, file: File): Promise<string>`.
- Produces: an Auth UI that holds `File | null` until a session exists.

- [ ] **Step 1: Write failing UI contract tests**

The source-level and pure-state tests must assert:

```js
assert.match(authSource, /\/api\/uat-auth\/request/);
assert.match(authSource, /\/api\/uat-auth\/verify/);
assert.match(authSource, /supabase\.auth\.setSession/);
assert.doesNotMatch(authSource, /signInAsDemo\(outcome\.persona\)/);
assert.doesNotMatch(authSource, />\s*Optional\s*</i);
assert.match(authSource, /Full name/);
assert.match(authSource, /Age/);
assert.match(authSource, /Occupation/);
```

Add a state-machine test showing a fresh phone reaches `needs_profile`, invalid required fields do not make a second verify request, and valid fields do.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs --test scripts/uat-auth-ui.test.mjs scripts/katalist-multipersona.test.mjs`

Expected: FAIL because Auth still creates a local demo session.

- [ ] **Step 3: Route UAT requests to the server broker**

In UAT phone mode:

```ts
await fetch("/api/uat-auth/request", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ phone: destination }) });
const response = await postUatVerify({ phone: destination, otp: code, profile });
if (response.status === "needs_profile") setProfilePhone(destination);
if (response.status === "authenticated") {
  const { error } = await supabase.auth.setSession(response.session);
  if (error) throw error;
}
```

Production phone/email paths continue using native Supabase OTP. Demo persona buttons continue using `signInAsDemo` only when the explicit demo flag is enabled.

- [ ] **Step 4: Complete profile and photo behavior**

Store the selected image as `File | null`, display a local object-URL preview, and send only required text fields to `/api/uat-auth/verify`. After `setSession`, call `uploadAvatarForUser(session.user.id, file)` if a file exists. Revoke the object URL on replacement/unmount. A photo upload error shows `Photo couldn’t be saved. You can retry from Me.` and still navigates into the app.

Extract the existing Storage logic from `useUploadAvatar` into `uploadAvatarForUser`; keep the hook as a mutation wrapper around that function.

- [ ] **Step 5: Remove synthetic fixed-OTP sessions**

Remove `localFixedOtp` branches from `useSession`, `session-mode`, and Auth. Delete `src/lib/fixed-otp.ts` once no import remains. Keep `local-user.ts` only as a demo/test helper if still referenced; otherwise remove it and migrate its validation tests to `profile-validation.ts`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test
npm run build:dev
npx eslint src/routes/auth.tsx src/hooks/useSession.ts src/lib/session-mode.ts src/features/me/use-profile.ts src/features/me/avatar-upload.ts src/lib/auth/profile-validation.ts src/lib/auth/uat-contract.ts
```

Expected: all Node tests pass, build succeeds, and touched files have no ESLint errors.

```bash
git add src/routes/auth.tsx src/hooks/useSession.ts src/lib/session-mode.ts src/features/me/use-profile.ts src/features/me/avatar-upload.ts src/lib/auth scripts/uat-auth-ui.test.mjs scripts/katalist-multipersona.test.mjs
git commit -m "feat: use real Supabase sessions in UAT"
```

### Task 6: End-to-end UAT authentication verification

**Files:**
- Create: `scripts/uat-auth-smoke.mjs`
- Modify: `.env.example`
- Create: `docs/uat-runbook.md`

**Interfaces:**
- Consumes: deployed UAT URL and server/client UAT secrets.
- Produces: a repeatable smoke command that uses a disposable phone number supplied via `UAT_TEST_PHONE`.

- [ ] **Step 1: Write the smoke script assertions**

The script must call request/verify and assert in order:

```js
assert.equal(request.status, 200);
assert.equal(invalidOtp.status, 401);
assert.deepEqual(await freshVerify.json(), { status: "needs_profile" });
assert.equal(created.status, 200);
assert.equal(createdBody.status, "authenticated");
assert.ok(createdBody.session.access_token);
assert.equal(returningBody.status, "authenticated");
assert.equal(decodeJwtSub(returningBody.session.access_token), decodeJwtSub(createdBody.session.access_token));
```

The script must not print tokens. It exits with a clear message when `UAT_BASE_URL` or `UAT_TEST_PHONE` is absent.

- [ ] **Step 2: Document UAT dashboard requirements**

Document that UAT is a separate Supabase project, public sign-up is disabled, server secrets are set only in UAT, and production must not contain `KATALIST_ENV=uat` or `KATALIST_UAT_FIXED_OTP`.

- [ ] **Step 3: Run local verification**

Run:

```bash
npm test
npm run build:dev
npm run typecheck
git diff --check
```

Expected: tests/build pass. If the known unrelated `server/middleware/grok-pwa.ts` TS2559 remains, record it separately and confirm no new errors originate in UAT-auth files.

- [ ] **Step 4: Run configured UAT smoke test**

Run: `node scripts/uat-auth-smoke.mjs`

Expected: `UAT auth smoke: PASS` without printing session credentials. If deployment credentials are not yet provisioned, stop here and report the exact missing environment names; do not claim live verification.

- [ ] **Step 5: Commit the verification assets**

```bash
git add scripts/uat-auth-smoke.mjs .env.example docs/uat-runbook.md
git commit -m "test: add UAT authentication smoke coverage"
```
