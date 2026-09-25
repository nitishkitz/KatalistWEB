export type OnboardingState = {
  step: number;
  completed: boolean;
  skipped: boolean;
};

const STORAGE_PREFIX = "katalist_onboarding_state:";
const DEFAULT_STATE: OnboardingState = { step: 0, completed: false, skipped: false };

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storageKey(identityId: string): string {
  return `${STORAGE_PREFIX}${identityId}`;
}

/**
 * Onboarding progress is scoped per identity (profile/demo/local-user id) so
 * that switching accounts on the same browser never resumes or auto-skips a
 * different person's onboarding.
 */
export function loadOnboardingState(storage: StorageLike, identityId: string): OnboardingState {
  try {
    const raw = storage.getItem(storageKey(identityId));
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw) as Partial<OnboardingState> | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_STATE;
    return {
      step: Number.isInteger(parsed.step) && (parsed.step as number) >= 0 ? (parsed.step as number) : 0,
      completed: parsed.completed === true,
      skipped: parsed.skipped === true,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export type OnboardingEntry = {
  redirectHome: boolean;
  stepIndex: number;
  onDiscoveryStep: boolean;
};

/**
 * Decides where a returning identity resumes: a completed tour never
 * replays (redirectHome), an in-progress or skipped one resumes at its last
 * saved step -- including the one-past-the-tour "discovery" step, which has
 * no index of its own in the tour array.
 */
export function resolveOnboardingEntry(state: OnboardingState, totalSteps: number): OnboardingEntry {
  if (state.completed) return { redirectHome: true, stepIndex: 0, onDiscoveryStep: false };
  const clamped = Math.min(Math.max(state.step, 0), totalSteps);
  return {
    redirectHome: false,
    stepIndex: Math.min(clamped, Math.max(totalSteps - 1, 0)),
    onDiscoveryStep: clamped >= totalSteps,
  };
}

export function saveOnboardingState(
  storage: StorageLike,
  identityId: string,
  state: OnboardingState,
): void {
  try {
    storage.setItem(storageKey(identityId), JSON.stringify(state));
  } catch {
    // Best-effort persistence; an in-session-only resume is an acceptable
    // fallback when storage is unavailable (e.g. private browsing).
  }
}
