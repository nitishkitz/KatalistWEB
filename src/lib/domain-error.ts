export function domainErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : err && typeof err === "object" && "message" in err && typeof err.message === "string"
          ? err.message
          : "";
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
  if (lower.includes("fetch") || lower.includes("network") || lower.includes("failed to")) {
    return "Couldn’t reach Katalist. Try again.";
  }
  return raw || "Something didn’t go through. Try again.";
}
