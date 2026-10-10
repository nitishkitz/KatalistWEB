import { useCallback, useEffect, useRef, useState } from "react";
import type { QaApi } from "../api-types";
import { QaOperationError } from "../qa-queries";

export type SecretState =
  | { kind: "idle" }
  | { kind: "working"; action: "reveal" | "copy" }
  | { kind: "revealed"; value: string }
  | { kind: "copied" }
  | { kind: "clipboard_denied" }
  | { kind: "error"; error: QaOperationError };

export const REVEAL_TIMEOUT_MS = 30_000;
export const COPIED_FEEDBACK_MS = 2_000;

/**
 * Transient reveal/copy for ONE account's password.
 *
 * The plaintext lives only in this component's state while revealed. It is never put in React Query,
 * storage, URLs or logs, and it is dropped on timeout, window blur or tab hide, a change of account,
 * a different signed-in identity, and unmount (which covers List and route changes).
 * Copy goes straight from the server response to the clipboard without ever entering state.
 * Browsers offer no reliable way to expire clipboard contents, so this does not try to.
 */
export function useSecretAction(api: QaApi, accountId: string, identityKey: string | undefined) {
  const [state, setState] = useState<SecretState>({ kind: "idle" });
  const timers = useRef<{ reveal?: ReturnType<typeof setTimeout>; copied?: ReturnType<typeof setTimeout> }>({});
  // Guards against a response from a previous account or identity landing after a switch.
  const generation = useRef(0);

  const clear = useCallback(() => {
    generation.current++;
    clearTimeout(timers.current.reveal);
    clearTimeout(timers.current.copied);
    setState({ kind: "idle" });
  }, []);

  useEffect(() => {
    clear();
    const gen = generation;
    const tm = timers;
    return () => {
      gen.current++;
      clearTimeout(tm.current.reveal);
      clearTimeout(tm.current.copied);
    };
  }, [accountId, identityKey, clear]);

  useEffect(() => {
    const hide = () => clear();
    const onVisibility = () => document.visibilityState === "hidden" && hide();
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [clear]);

  const reveal = useCallback(async () => {
    if (state.kind === "revealed") return clear();
    const mine = ++generation.current;
    setState({ kind: "working", action: "reveal" });
    try {
      const value = await api.releaseSecret(accountId, "reveal");
      if (mine !== generation.current) return;
      setState({ kind: "revealed", value });
      timers.current.reveal = setTimeout(clear, REVEAL_TIMEOUT_MS);
    } catch (error) {
      if (mine !== generation.current) return;
      setState({ kind: "error", error: error instanceof QaOperationError ? error : new QaOperationError("unknown", "The password could not be revealed.") });
    }
  }, [api, accountId, state.kind, clear]);

  const copy = useCallback(async () => {
    const mine = ++generation.current;
    setState({ kind: "working", action: "copy" });
    try {
      const value = await api.releaseSecret(accountId, "copy");
      if (mine !== generation.current) return;
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        if (mine === generation.current) setState({ kind: "clipboard_denied" });
        return;
      }
      if (mine !== generation.current) return;
      setState({ kind: "copied" });
      timers.current.copied = setTimeout(() => mine === generation.current && setState({ kind: "idle" }), COPIED_FEEDBACK_MS);
    } catch (error) {
      if (mine !== generation.current) return;
      setState({ kind: "error", error: error instanceof QaOperationError ? error : new QaOperationError("unknown", "The password could not be copied.") });
    }
  }, [api, accountId]);

  return { state, reveal, copy, clear };
}

/** Copies non-secret text (for example a username). Reports success only after the write resolves. */
export async function copyPlainText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
