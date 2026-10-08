#!/usr/bin/env node
/**
 * Starts the app in the isolated Code Activity preview.
 *
 *   npm run dev:code-activity-preview
 *
 * What it does: runs `vite dev` with demo mode and the preview flag on, so the Code Activity tab appears
 * in List Detail with labeled sample data. The Supabase values below are inert placeholders that point at a
 * closed port on this machine. No real credentials are read, and no real service can be reached.
 *
 * It never overrides values you already set, so exporting real credentials in your shell is your decision and
 * is not recommended for this preview.
 */
import { spawn } from "node:child_process";

const inert = {
  VITE_KATALIST_DEMO_MODE: "true",
  VITE_CODE_ACTIVITY_PREVIEW: "true",
  VITE_SUPABASE_URL: "http://127.0.0.1:1",
  SUPABASE_URL: "http://127.0.0.1:1",
  VITE_SUPABASE_PUBLISHABLE_KEY: "inert-local-preview-key",
  SUPABASE_PUBLISHABLE_KEY: "inert-local-preview-key",
  VITE_SUPABASE_PROJECT_ID: "inert",
};

// Demo mode and the preview flag are always forced on. The Supabase placeholders only fill gaps.
const env = { ...process.env };
for (const [key, value] of Object.entries(inert)) {
  if (key === "VITE_KATALIST_DEMO_MODE" || key === "VITE_CODE_ACTIVITY_PREVIEW" || !env[key]) env[key] = value;
}

console.log("Code Activity preview: sample data only. No GitHub, AI, or database request is made by the feature.");
console.log("Open http://localhost:8080/auth, choose a demo account, open a List, then the Code Activity tab.");

const child = spawn("npx", ["vite", "dev", "--host", "0.0.0.0", "--port", "8080"], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
