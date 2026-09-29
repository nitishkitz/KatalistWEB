/**
 * Extracts a human-readable message from an unknown thrown value.
 *
 * Supabase's PostgrestError/AuthError extend Error, but not every error this
 * app catches does — RPC wrappers and server route handlers also throw or
 * reject with plain `{ message, ... }` objects (e.g. a hand-thrown object,
 * or a value that has been JSON round-tripped and lost its prototype). Only
 * checking `instanceof Error` silently drops the message on those and falls
 * through to a generic fallback, which breaks any caller that branches on
 * message text (e.g. rpc.ts's fallback-to-preview substring checks).
 */
export function extractErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return undefined;
}

/** Only classify transport failures as connection failures. Domain errors can
 * also begin with "Failed to", and those should keep their useful message. */
export function isNetworkError(err: unknown): boolean {
  const message = (extractErrorMessage(err) ?? "").toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("network is unreachable") ||
    message.includes("err_network")
  );
}

export function domainErrorMessage(err: unknown): string {
  const raw = extractErrorMessage(err) ?? "";
  const lower = raw.toLowerCase();
  if (lower.includes("permission") || lower.includes("row-level") || lower.includes("42501") || lower.includes("not allowed")) {
    return "You don’t have permission to do that.";
  }
  if (lower.includes("cooldown") || lower.includes("recently nudged") || lower.includes("too soon")) {
    return "Give it a moment — this one was just nudged.";
  }
  if (lower.includes("lifecycle") || lower.includes("cannot") || lower.includes("not available")) {
    return "That move isn’t available anymore.";
  }
  if (isNetworkError(err)) {
    return "Couldn’t reach Katalist. Try again.";
  }
  return raw || "Something didn’t go through. Try again.";
}
