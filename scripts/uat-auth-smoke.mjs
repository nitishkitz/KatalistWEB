import assert from "node:assert/strict";

const REQUIRED = ["UAT_BASE_URL", "UAT_TEST_PHONE"];

function missingEnv() {
  return REQUIRED.filter((name) => !String(process.env[name] ?? "").trim());
}

function decodeJwtSub(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) throw new Error("session token is not a JWT");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!payload.sub) throw new Error("session token is missing sub");
  return payload.sub;
}

async function post(base, path, body) {
  const response = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function main() {
  const missing = missingEnv();
  if (missing.length) {
    console.error(`UAT auth smoke: NOT RUN — missing ${missing.join(", ")}`);
    process.exit(2);
  }

  const base = String(process.env.UAT_BASE_URL).replace(/\/+$/, "") + "/";
  const phone = String(process.env.UAT_TEST_PHONE).trim();
  const profile = {
    fullName: "UAT Smoke",
    age: "29",
    occupation: "Tester",
  };

  const request = await post(base, "/api/uat-auth/request", { phone });
  assert.equal(request.status, 200);

  const invalidOtp = await post(base, "/api/uat-auth/verify", { phone, otp: "000000" });
  assert.equal(invalidOtp.status, 401);

  const freshVerify = await post(base, "/api/uat-auth/verify", { phone, otp: "111111" });
  assert.equal(freshVerify.status, 200);
  assert.deepEqual(freshVerify.json, { status: "needs_profile" });

  const created = await post(base, "/api/uat-auth/verify", { phone, otp: "111111", profile });
  assert.equal(created.status, 200);
  const createdBody = created.json;
  assert.equal(createdBody.status, "authenticated");
  assert.ok(createdBody.session?.access_token);
  assert.ok(createdBody.session?.refresh_token);

  const returning = await post(base, "/api/uat-auth/verify", { phone, otp: "111111" });
  assert.equal(returning.status, 200);
  const returningBody = returning.json;
  assert.equal(returningBody.status, "authenticated");
  assert.equal(decodeJwtSub(returningBody.session.access_token), decodeJwtSub(createdBody.session.access_token));

  console.log("UAT auth smoke: PASS");
}

main().catch((error) => {
  console.error("UAT auth smoke: FAIL");
  console.error(error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
