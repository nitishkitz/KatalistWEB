import { normalizePhone, validateRequiredProfile } from "@/lib/auth/profile-validation";

export type LocalStorageLike = Pick<Storage, "getItem" | "setItem">;

export type LocalPersona = {
  key: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  initials: string;
  color: string;
  age?: number;
  occupation?: string;
  avatarUrl?: string | null;
};

export type LocalProfileDraft = {
  fullName: string;
  age: string;
  occupation: string;
  avatarUrl: string | null;
};

export type LocalProfileErrors = Partial<Record<"fullName" | "age" | "occupation", string>>;

type CreateLocalUserResult =
  | { ok: true; persona: LocalPersona }
  | { ok: false; errors: LocalProfileErrors };

const LOCAL_USERS_STORAGE_KEY = "katalist_local_users";

export function normalizeLocalPhone(phone: string): string {
  return normalizePhone(phone) ?? "";
}

function readLocalUsers(storage: LocalStorageLike): Record<string, LocalPersona> {
  try {
    const parsed = JSON.parse(storage.getItem(LOCAL_USERS_STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function loadLocalUser(storage: LocalStorageLike, phone: string): LocalPersona | null {
  const normalizedPhone = normalizeLocalPhone(phone);
  const persona = readLocalUsers(storage)[normalizedPhone];
  return persona && persona.phone === normalizedPhone ? persona : null;
}

export function validateLocalProfile(profile: LocalProfileDraft): LocalProfileErrors {
  const result = validateRequiredProfile(profile);
  return result.ok ? {} : result.errors;
}

export function createLocalUser(
  storage: LocalStorageLike,
  phone: string,
  profile: LocalProfileDraft,
): CreateLocalUserResult {
  const result = validateRequiredProfile(profile);
  if (!result.ok) return { ok: false, errors: result.errors };

  const normalizedPhone = normalizeLocalPhone(phone);
  const digits = normalizedPhone.slice(1);
  const { fullName: name, age, occupation } = result.value;
  const persona: LocalPersona = {
    key: `local-${digits}`,
    name,
    role: occupation,
    phone: normalizedPhone,
    email: `local-${digits}@katalist.local`,
    initials: initialsFor(name),
    color: "bg-primary/10 text-primary",
    age,
    occupation,
    avatarUrl: profile.avatarUrl,
  };

  const users = readLocalUsers(storage);
  users[normalizedPhone] = persona;
  storage.setItem(LOCAL_USERS_STORAGE_KEY, JSON.stringify(users));
  return { ok: true, persona };
}

export function resolveLocalLogin(
  storage: LocalStorageLike,
  phone: string,
  seededPeople: readonly LocalPersona[],
): LocalPersona | null {
  const normalizedPhone = normalizeLocalPhone(phone);
  return (
    seededPeople.find((persona) => normalizeLocalPhone(persona.phone) === normalizedPhone) ??
    loadLocalUser(storage, normalizedPhone)
  );
}

export function resolveFixedOtpOutcome(
  storage: LocalStorageLike,
  phone: string,
  seededPeople: readonly LocalPersona[],
): { kind: "sign-in"; persona: LocalPersona } | { kind: "profile-setup"; phone: string } {
  const persona = resolveLocalLogin(storage, phone, seededPeople);
  if (persona) return { kind: "sign-in", persona };
  return { kind: "profile-setup", phone: normalizeLocalPhone(phone) };
}
