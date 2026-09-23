/**
 * F02: gates Morning Brief's AUTOMATIC opening only -- manual reopening
 * (the existing Catch Up banner/button) is unaffected either way. Off by
 * default. Flip to "true" only once the presentation-receipt migration
 * (supabase/migrations/20260923100000_morning_brief_receipts.sql) has
 * actually been deployed and live-verified; the app and manual review
 * both work correctly before that.
 */
export function morningBriefAutoOpenEnabled(): boolean {
  return import.meta.env.VITE_KATALIST_MORNING_BRIEF_AUTO_OPEN === "true";
}
