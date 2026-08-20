import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, statSync } from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function existingFile(candidate) {
  if (!existsSync(candidate)) return null;
  try {
    return statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function resolveToSource(base) {
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
  for (const candidate of candidates) {
    const hit = existingFile(candidate);
    if (hit) return hit;
  }
  return null;
}

/** Test-only ESM resolver so Node can import `@/` and extensionless TS paths. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const hit = resolveToSource(path.join(root, "src", specifier.slice(2)));
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    typeof context.parentURL === "string" &&
    context.parentURL.startsWith("file:")
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const hit = resolveToSource(path.resolve(parentDir, specifier));
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  }
  return nextResolve(specifier, context);
}
