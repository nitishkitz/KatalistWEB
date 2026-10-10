-- Thing references on list messages and Thing comments. A dedicated ID array, deliberately separate from the people
-- mention arrays: references never notify anyone and grant no access. Whoever reads the message resolves each ID through
-- their own Thing access, so a source they cannot see renders as unavailable.

ALTER TABLE public.list_messages
  ADD COLUMN IF NOT EXISTS thing_reference_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.thing_comments
  ADD COLUMN IF NOT EXISTS thing_reference_ids uuid[] NOT NULL DEFAULT '{}';

-- Reference-only messages are allowed, like attachment-only ones.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'list_messages_body_or_attachment') THEN
    ALTER TABLE public.list_messages DROP CONSTRAINT list_messages_body_or_attachment;
  END IF;
  ALTER TABLE public.list_messages
    ADD CONSTRAINT list_messages_body_or_attachment
    CHECK (length(btrim(body)) > 0 OR attachment IS NOT NULL OR cardinality(thing_reference_ids) > 0);
END $$;

-- The comment body check also has to allow a reference-only comment.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.thing_comments'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%btrim(body)%'
  LOOP
    EXECUTE format('ALTER TABLE public.thing_comments DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.thing_comments
    ADD CONSTRAINT thing_comments_body_or_references
    CHECK (length(btrim(body)) > 0 OR cardinality(thing_reference_ids) > 0);
END $$;

-- Authors can only reference Things they can see themselves, capped at 10 and without duplicates.
CREATE OR REPLACE FUNCTION katalist_priv.validate_thing_reference_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF cardinality(NEW.thing_reference_ids) = 0 THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF cardinality(NEW.thing_reference_ids) > 10 THEN
    RAISE EXCEPTION 'too many references';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(NEW.thing_reference_ids) AS x) <> cardinality(NEW.thing_reference_ids) THEN
    RAISE EXCEPTION 'duplicate references';
  END IF;
  FOREACH v_id IN ARRAY NEW.thing_reference_ids LOOP
    IF NOT katalist_priv.can_view_thing(v_id) THEN
      RAISE EXCEPTION 'Referenced Thing not found';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_list_messages_thing_references ON public.list_messages;
CREATE TRIGGER trg_list_messages_thing_references
  BEFORE INSERT ON public.list_messages
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.validate_thing_reference_ids();

DROP TRIGGER IF EXISTS trg_thing_comments_thing_references ON public.thing_comments;
CREATE TRIGGER trg_thing_comments_thing_references
  BEFORE INSERT ON public.thing_comments
  FOR EACH ROW EXECUTE FUNCTION katalist_priv.validate_thing_reference_ids();

NOTIFY pgrst, 'reload schema';
