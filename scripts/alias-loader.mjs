import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, statSync, readFileSync } from "node:fs";
import ts from "typescript";

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

/**
 * Node's own --experimental-strip-types only recognizes .ts/.mts/.cts --
 * .tsx is unconditionally unknown to it (ERR_UNKNOWN_FILE_EXTENSION),
 * regardless of whether the file actually contains JSX. Real .tsx
 * components (e.g. IdentityBoundary.tsx) still need to be importable
 * directly from plain node:test component-level tests, so this hook
 * transpiles .tsx source with the TypeScript compiler already installed
 * in this project (used for `tsc --noEmit` too) -- strips types AND
 * transforms JSX via the automatic runtime, then hands the emitted JS to
 * Node as a normal ES module. Only .tsx is intercepted; .ts/.mjs keep
 * using Node's own native type-stripping unchanged.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".tsx") && url.startsWith("file:")) {
    const filePath = fileURLToPath(url);
    const source = readFileSync(filePath, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: filePath,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
