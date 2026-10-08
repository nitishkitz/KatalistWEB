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
 *
 * T10/mobile-entry: `node:test`'s `--experimental-test-module-mocks` loader
 * sits later in this same hook chain and re-requests a mocked module's real
 * URL with an appended `?mock=...`-style query string (to bypass Node's own
 * module cache) -- a plain `url.endsWith(".tsx")` check went false for that
 * decorated URL and fell through to Node's default loader, which has no
 * idea what a `.tsx` file is (`ERR_UNKNOWN_FILE_EXTENSION`) regardless of
 * any query string. Stripping the query/hash before checking the extension
 * fixes `mock.module()` for `.tsx` specifiers (previously only exercised
 * for `.ts` ones in this codebase's tests) without changing behavior for
 * any non-mocked `.tsx` import.
 */
export async function load(url, context, nextLoad) {
  const urlPath = url.startsWith("file:") ? url.split("?")[0].split("#")[0] : url;
  if (urlPath.endsWith(".tsx") && url.startsWith("file:")) {
    const filePath = fileURLToPath(urlPath);
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
  // T10/mobile-entry: source under src/assets/ imports plain-looking
  // `*.json` files (e.g. `*.asset.json`) the way Vite always has --
  // Node's own ESM loader requires an explicit `with { type: "json" }`
  // import attribute at every call site for that (`ERR_IMPORT_ATTRIBUTE_
  // MISSING`), which this source doesn't have and shouldn't need to add
  // just to satisfy a test-only Node loader. Emitting the parsed JSON as a
  // tiny synthetic ES module (a plain `export default {...}`) sidesteps
  // the attribute requirement entirely, matching how Vite's real JSON
  // handling already behaves for these imports in the app itself.
  // Plain stylesheets imported for their side effect (Vite handles them in the app): an empty module is enough under test.
  if (urlPath.endsWith(".css") && url.startsWith("file:")) {
    return { format: "module", source: "export default {};", shortCircuit: true };
  }
  if (urlPath.endsWith(".json") && url.startsWith("file:")) {
    const filePath = fileURLToPath(urlPath);
    const source = readFileSync(filePath, "utf8");
    JSON.parse(source); // fail loudly here, not with a cryptic module-eval error, if it's ever not valid JSON
    return { format: "module", source: `export default ${source};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
