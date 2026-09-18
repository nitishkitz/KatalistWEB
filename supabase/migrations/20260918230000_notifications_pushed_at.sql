-- Track which in-app notifications have already been delivered as a browser push,
-- so the escalation cron can send a push exactly once per Coey notification
-- (auto-nudge, stale alert, morning brief, spring-clean) without re-sending on
-- the next run. NULL = not yet pushed.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

-- Partial index keeps the "unpushed" lookup cheap.
CREATE INDEX IF NOT EXISTS idx_notifications_unpushed
  ON public.notifications (created_at)
  WHERE pushed_at IS NULL;
