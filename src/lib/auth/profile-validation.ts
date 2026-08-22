export type RequiredProfile = { fullName: string; age: number; occupation: string };
export type ProfileFieldErrors = Partial<Record<"fullName" | "age" | "occupation", string>>;
export type ProfileValidationResult =
  | { ok: true; value: RequiredProfile }
  | { ok: false; errors: ProfileFieldErrors };

const NAME_MIN = 1;
const NAME_MAX = 100;
const AGE_MIN = 1;
const AGE_MAX = 120;

export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** E.164-like: `+` followed by 6–15 digits. Anything else is rejected. */
export function normalizePhone(value: string): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return `+${digits}`;
}

export function validateRequiredProfile(input: unknown): ProfileValidationResult {
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const errors: ProfileFieldErrors = {};

  const fullName = collapseWhitespace(typeof record.fullName === "string" ? record.fullName : "");
  if (fullName.length < NAME_MIN || fullName.length > NAME_MAX) {
    errors.fullName = "Enter your full name";
  }

  const occupation = collapseWhitespace(typeof record.occupation === "string" ? record.occupation : "");
  if (occupation.length < NAME_MIN || occupation.length > NAME_MAX) {
    errors.occupation = "Enter your occupation";
  }

  const ageRaw = record.age;
  const ageText =
    typeof ageRaw === "number" && Number.isFinite(ageRaw)
      ? String(ageRaw)
      : typeof ageRaw === "string"
        ? ageRaw.trim()
        : "";
  if (!/^[0-9]+$/.test(ageText)) {
    errors.age = "Enter a valid age";
  } else {
    const age = Number(ageText);
    if (!Number.isInteger(age) || age < AGE_MIN || age > AGE_MAX) {
      errors.age = "Enter a valid age";
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: { fullName, age: Number(ageText), occupation },
  };
}
