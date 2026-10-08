#!/usr/bin/env node
/**
 * One-time OPERATOR bootstrap for local development: registers a private, read-only GitHub App for Katalist Code Activity
 * through GitHub's manifest flow and writes its server-side settings into an uncommitted .env.local. Ordinary users never run
 * this: they only authorize their own account inside Katalist.
 *
 *   node scripts/code-activity-bootstrap.mjs [--org <organization>] [--env .env.local]
 *
 * It opens a local page on 127.0.0.1:8787, you click through GitHub (sign in, confirm the permissions, "Create GitHub App"),
 * and GitHub redirects back here with a one-time code. No secret is ever printed. Restart `npm run dev` afterwards, then
 * install the App on ONE test repository you own (the link is printed).
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { bootstrapAppName, buildManifest, checkRedirect, envFor, mergeEnv, parseConversion, randomState, registrationPage } from "./code-activity-bootstrap-lib.mjs";

const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const organization = flag("--org");
const envFile = flag("--env") ?? ".env.local";
const PORT = 8787;
const redirectUrl = `http://127.0.0.1:${PORT}/created`;
const state = randomState();
const name = bootstrapAppName();
const manifest = buildManifest({ name, redirectUrl });

function finish(code, message) {
  console.log(message);
  setTimeout(() => process.exit(code), 200);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return res.end(registrationPage({ manifest, state, organization }));
  }
  if (url.pathname !== "/created") {
    res.writeHead(404);
    return res.end();
  }
  const redirect = checkRedirect(url.searchParams, state);
  if (!redirect.ok) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("This link did not come from the page this command opened. Nothing was changed.");
    return finish(1, "Stopped: the redirect did not match this run. Nothing was written.");
  }
  try {
    const reply = await fetch(`https://api.github.com/app-manifests/${redirect.code}/conversions`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", "user-agent": "katalist-code-activity-bootstrap" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!reply.ok) throw new Error(`GitHub answered ${reply.status}`);
    const parsed = parseConversion(await reply.json());
    if (!parsed.ok) throw new Error(`GitHub's reply lacked: ${parsed.missing.join(", ")}`);
    const vars = envFor(parsed.value);
    const before = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
    const tmp = `${envFile}.tmp-${process.pid}`;
    writeFileSync(tmp, mergeEnv(before, vars), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, envFile);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;max-width:34rem;margin:4rem auto"><h1 style="font-size:20px">Done</h1><p>Return to the terminal. Next: install the App on one test repository you own.</p><p><a href="https://github.com/apps/${encodeURIComponent(parsed.value.slug)}/installations/new">Install on a repository</a></p></body>`);
    finish(
      0,
      `Wrote ${Object.keys(vars).length} settings to ${envFile} (names only):\n  ${Object.keys(vars).join("\n  ")}\n\nNext:\n  1. Restart \`npm run dev\` so the server reads them.\n  2. Install the App on ONE test repository (Only select repositories): https://github.com/apps/${parsed.value.slug}/installations/new\n  3. Check: node --experimental-strip-types --experimental-loader ./scripts/alias-loader.mjs scripts/code-activity-config-check.mjs`,
    );
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("Could not finish creating the App. Nothing was written. See the terminal.");
    finish(1, `Stopped: ${error instanceof Error ? error.message : "unknown error"}. Nothing was written to ${envFile}.`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Open http://127.0.0.1:${PORT}/ in the browser where you are signed in to GitHub${organization ? ` (organization: ${organization})` : ""}.`);
  console.log("This waits up to 10 minutes. Nothing is created until you confirm on GitHub.");
});
setTimeout(() => finish(1, "Timed out waiting for GitHub. Nothing was written."), 10 * 60_000).unref();
