/** Test phone login accepts canonical international numbers only. */
export function normalizeTestPhone(value: unknown): string | null {
  if (typeof value !== "string" || !/^\+?[\d\s()-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{6,14}$/.test(digits)) return null;
  // Indian national mobile numbers are exactly ten digits after +91.
  if (digits.startsWith("91") && digits.length !== 12) return null;
  return `+${digits}`;
}
