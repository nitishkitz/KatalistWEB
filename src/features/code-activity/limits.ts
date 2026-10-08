/**
 * Provisional resource limits for Code Activity (contract draft v3, section 7).
 * They are engineering defaults, not measured values, and may change at review.
 * Client-side bounds only mirror what a server contract will later enforce.
 */
export const CODE_ACTIVITY_LIMITS = {
  /** Largest patch text rendered for one file, in bytes (100 KiB). */
  patchMaxBytes: 102_400,
  /** Largest patch text rendered for one file, in lines. */
  patchMaxLines: 2_000,
  /** Files listed for one change. */
  filesMax: 300,
  /** Check runs read for one revision. */
  checksMax: 200,
  /** Title length accepted when confirming a draft. */
  titleMax: 300,
  /** Description length accepted when confirming a draft. */
  notesMax: 8_000,
  /** Stored feed title length. */
  feedTitleMax: 300,
} as const;
