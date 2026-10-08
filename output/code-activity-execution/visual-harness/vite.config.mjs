import { fileURLToPath } from "node:url";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../../src");

export default {
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: "@/lib/authed-fetch", replacement: path.resolve(here, "mock-authed-fetch.ts") },
      { find: "@/features/court/MagicBox", replacement: path.resolve(here, "magic-box-stub.tsx") },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  server: { port: 5199, strictPort: true, fs: { allow: [path.resolve(here, "../../..")] } },
  logLevel: "warn",
};
