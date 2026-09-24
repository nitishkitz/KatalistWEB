-- T04: deterministic keyset histories, selected-member mentions and one
-- notification attempt per persisted chat message. Apply through the Supabase
-- migration path before enabling the new chat client against staging.

CREATE INDEX IF NOT EXISTS idx_list_messages_history
  ON public.list_messages (list_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_list_messages_pinned_history
  ON public.list_messages (list_id, pinned_at DESC, id DESC)
  WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_thing_comments_history
  ON public.thing_comments (thing_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_thing_activity_history
  ON public.thing_activity (thing_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION public.validate_list_message_mentions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.mentioned_profile_ids) AS mention(profile_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lists l
      WHERE l.id = NEW.list_id AND l.owner_profile_id = mention.profile_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.list_members m
      WHERE m.list_id = NEW.list_id AND m.profile_id = mention.profile_id
    )
  ) THEN
    RAISE EXCEPTION 'mentions must belong to this List' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_list_message_mentions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_list_message_mentions() TO authenticated;
DROP TRIGGER IF EXISTS trg_list_message_mentions_member ON public.list_messages;
CREATE TRIGGER trg_list_message_mentions_member
  BEFORE INSERT ON public.list_messages
  FOR EACH ROW EXECUTE FUNCTION public.validate_list_message_mentions();

-- The server claims BEFORE calling the push provider. A retry or concurrent
-- request sees the existing key and cannot issue the push again. This chooses
-- at-most-once delivery attempts: a provider failure after claiming can lose
-- that push, since the provider has no end-to-end idempotency contract.
CREATE TABLE IF NOT EXISTS public.message_push_claims (
  message_id uuid PRIMARY KEY REFERENCES public.list_messages(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_push_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.message_push_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.message_push_claims TO service_role;

CREATE OR REPLACE FUNCTION public.claim_list_message_push(p_message_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER
SET search_path = 'pg_catalog','public' AS $$
  WITH inserted AS (
    INSERT INTO public.message_push_claims(message_id)
    VALUES (p_message_id)
    ON CONFLICT (message_id) DO NOTHING
    RETURNING message_id
  )
  SELECT EXISTS (SELECT 1 FROM inserted);
$$;
REVOKE ALL ON FUNCTION public.claim_list_message_push(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_list_message_push(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
