-- @mentions in list/hub chat. A message can name any of the conversation's
-- members ("@Name") and that person gets a distinct, more prominent push
-- notification plus a queryable "mentioned me" count — separate from the
-- generic unread count already built client-side.
--
-- Stored as a plain uuid[] rather than a join table: mentions are immutable
-- once sent (editing a message to add/remove a mention isn't a feature here)
-- and the only query shape needed is "does this array contain me", which a
-- GIN index on the array serves directly.

ALTER TABLE public.list_messages
  ADD COLUMN IF NOT EXISTS mentioned_profile_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_list_messages_mentions
  ON public.list_messages USING gin (mentioned_profile_ids);

NOTIFY pgrst, 'reload schema';
