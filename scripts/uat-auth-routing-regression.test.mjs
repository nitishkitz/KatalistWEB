import assert from "node:assert/strict";
import test from "node:test";

async function optionalImport(path) {
  try {
    return await import(path);
  } catch {
    return {};
  }
}

test("UAT mode selects the server OTP broker", async () => {
  const contract = await optionalImport("@/lib/auth/uat-contract");

  assert.equal(typeof contract.isUatClient, "function");
  assert.equal(contract.isUatClient?.({ VITE_KATALIST_ENV: "uat" }), true);
  assert.equal(contract.isUatClient?.({ VITE_KATALIST_ENV: "production" }), false);
});

test("UAT OTP requests use the private request endpoint", async () => {
  const client = await optionalImport("@/lib/auth/uat-client");
  const requests = [];
  const fetchImpl = async (input, init) => {
    requests.push({ input, init });
    return Response.json({ ok: true });
  };

  assert.equal(typeof client.postUatRequest, "function");
  const result = await client.postUatRequest?.("+919876543210", fetchImpl);

  assert.deepEqual(result, { ok: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, "/api/uat-auth/request");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), { phone: "+919876543210" });
});

test("UAT OTP verification uses the private verify endpoint", async () => {
  const client = await optionalImport("@/lib/auth/uat-client");
  const requests = [];
  const fetchImpl = async (input, init) => {
    requests.push({ input, init });
    return Response.json({
      status: "authenticated",
      session: { access_token: "access", refresh_token: "refresh" },
    });
  };

  assert.equal(typeof client.postUatVerify, "function");
  const result = await client.postUatVerify?.(
    { phone: "+919876543210", otp: "111111" },
    fetchImpl,
  );

  assert.equal(result?.status, "authenticated");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, "/api/uat-auth/verify");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    phone: "+919876543210",
    otp: "111111",
  });
});

test("UAT server keeps public Supabase configuration when Netlify exposes it only at build time", async () => {
  const server = await optionalImport("@/lib/auth/uat-auth.server");

  assert.equal(typeof server.resolveUatServerEnv, "function");
  assert.deepEqual(
    server.resolveUatServerEnv?.(
      { KATALIST_ENV: "uat" },
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "publishable",
      },
    ),
    {
      KATALIST_ENV: "uat",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "publishable",
    },
  );
});
