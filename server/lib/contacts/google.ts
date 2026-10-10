export const CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";

export type GooglePerson = {
  resourceName?: string;
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string; canonicalForm?: string }[];
};
export type ContactMatchInput = { resource: string; name: string; emails: string[]; phones: string[] };

export function normalizeContactPhone(value: string): string | null {
  const raw = value.trim();
  const digits = raw.replace(/\D/g, "");
  if (/^00/.test(raw) && digits.length >= 10 && digits.length <= 17) return `+${digits.slice(2)}`;
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  // Katalist's default country is India. Prefer Google's canonicalForm for other countries.
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

export function normalizeGoogleContacts(people: GooglePerson[]): ContactMatchInput[] {
  const seen = new Set<string>();
  return people.flatMap(person => {
    const resource = person.resourceName;
    if (!resource || seen.has(resource)) return [];
    seen.add(resource);
    const emails = [...new Set((person.emailAddresses ?? []).map(e => e.value?.trim().toLowerCase() ?? "")
      .filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !e.endsWith(".invalid")))];
    const phones = [...new Set((person.phoneNumbers ?? []).map(p => normalizeContactPhone(p.canonicalForm || p.value || ""))
      .filter((p): p is string => p !== null))];
    return [{ resource, name: (person.names?.[0]?.displayName ?? "").slice(0, 200), emails, phones }];
  });
}

async function googleJson(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) {
    // Do not propagate Google's response body: it may include authorization details.
    throw new Error(response.status === 401 || response.status === 403
      ? "Google Contacts permission was denied or expired. Connect again."
      : "Google Contacts is temporarily unavailable. Try again.");
  }
  return await response.json();
}

export async function readGoogleContacts(code: string, config: { clientId: string; clientSecret: string; origin: string }, fetcher = fetch) {
  const token = await googleJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.origin, grant_type: "authorization_code" }),
  }, fetcher);
  if (typeof token.access_token !== "string" || typeof token.scope !== "string" || !token.scope.split(" ").includes(CONTACTS_SCOPE)) {
    throw new Error("Allow read-only Google Contacts access to sync your contacts.");
  }
  const people: GooglePerson[] = [];
  const pageTokens = new Set<string>();
  let pages = 0;
  let pageToken = "";
  do {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("personFields", "names,emailAddresses,phoneNumbers");
    url.searchParams.set("sources", "READ_SOURCE_TYPE_CONTACT");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await googleJson(url.href, { headers: { Authorization: `Bearer ${token.access_token}` } }, fetcher);
    if (Array.isArray(page.connections)) people.push(...page.connections as GooglePerson[]);
    pageToken = typeof page.nextPageToken === "string" ? page.nextPageToken : "";
    if (people.length > 10_000 || (++pages > 20) || (pageToken && pageTokens.has(pageToken))) {
      throw new Error("Google Contacts sync could not finish. Your previous contacts were kept.");
    }
    if (pageToken) pageTokens.add(pageToken);
  } while (pageToken);
  // Access/refresh tokens are deliberately not persisted or returned to the browser.
  return normalizeGoogleContacts(people);
}

export function googleContactsConfig() {
  const clientId = process.env.VITE_GOOGLE_CONTACTS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CONTACTS_CLIENT_SECRET;
  const configuredOrigin = process.env.GOOGLE_CONTACTS_ORIGIN;
  if (!clientId || !clientSecret || !configuredOrigin) return null;
  try {
    const url = new URL(configuredOrigin);
    if (url.origin !== configuredOrigin || (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) return null;
    return { clientId, clientSecret, origin: url.origin };
  } catch { return null; }
}
