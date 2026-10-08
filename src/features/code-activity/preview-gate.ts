/**
 * Pure gate for the Code Activity preview.
 *
 * Available in the development server regardless of session type. An explicit
 * false flag opts out. Production builds always resolve to off, even if a flag
 * was accidentally enabled. This gate does not change the app's auth/demo mode.
 */
export function resolveCodeActivityPreview(input: { development: boolean; flag: string | undefined }): boolean {
  return input.development === true && (input.flag === undefined || input.flag === "true");
}
