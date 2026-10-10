/**
 * Whether the QA tab may appear. QA needs its schema migration and (for passwords) vault keys, so it is
 * off by default in production builds. VITE_QA_ENABLED=true turns it on once those are verified;
 * VITE_QA_ENABLED=false forces it off everywhere, including development.
 */
export function resolveQaEnabled(input: { development: boolean; flag: string | undefined }): boolean {
  const flag = input.flag?.trim().toLowerCase();
  if (flag === "false") return false;
  if (flag === "true") return true;
  return input.development;
}
