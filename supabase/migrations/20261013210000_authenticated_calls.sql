-- Authenticated calls (closes the call-impersonation gap from the re-review).
--
-- * Rings are rows written by ring_call(): the caller is auth.uid(), never a
--   payload claim. Recipients receive their own rows through Realtime
--   postgres_changes, which applies RLS, so nobody sees a ring meant for
--   someone else and a ring cannot claim another caller.
-- * WebRTC connection signalling (offer/answer/ICE/bye) is rows in
--   call_signals. The sender profile is stamped by the database; insertion is
--   refused for blocked pairs (either direction) and unconnected DM pairs.
--   A participant who claims another member's id in presence never receives
--   that member's signals and cannot send as them.
-- * The in-call broadcast channel (reactions, drawing, shared state) is
--   private: only conversation participants may join it.
-- * Blocking hangs up any call between the pair and withdraws pending rings.

-- Rings.
CREATE TABLE IF NOT EXISTS public.call_rings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id              uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  caller_profile_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  call_type            text CHECK (call_type IN ('audio', 'video')),
  caller_name          text NOT NULL,
  caller_avatar_url    text,
  list_name            text NOT NULL,
  list_kind            text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL DEFAULT now() + interval '60 seconds'
);
CREATE INDEX IF NOT EXISTS call_rings_recipient ON public.call_rings (recipient_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_rings_created ON public.call_rings (created_at);
ALTER TABLE public.call_rings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_rings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.call_rings TO authenticated;
GRANT ALL ON public.call_rings TO service_role;
DROP POLICY IF EXISTS "rings for caller and recipient" ON public.call_rings;
CREATE POLICY "rings for caller and recipient" ON public.call_rings FOR SELECT TO authenticated
  USING (recipient_profile_id = auth.uid() OR caller_profile_id = auth.uid());

CREATE OR REPLACE FUNCTION public.ring_call(p_list_id uuid, p_recipients uuid[], p_call_type text DEFAULT NULL)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
DECLARE
  v_me     uuid := auth.uid();
  v_list   public.lists;
  v_name   text;
  v_avatar text;
  v_ok     uuid[];
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_list FROM public.lists WHERE id = p_list_id;
  IF NOT FOUND OR NOT katalist_priv.is_conversation_party(p_list_id, v_me) THEN RAISE EXCEPTION 'conversation not found'; END IF;
  IF coalesce(array_length(p_recipients, 1), 0) > 50 THEN RAISE EXCEPTION 'too many people to ring at once'; END IF;
  SELECT COALESCE(NULLIF(btrim(display_name), ''), 'Someone'), avatar_url INTO v_name, v_avatar FROM public.profiles WHERE id = v_me;
  SELECT COALESCE(array_agg(DISTINCT r), '{}') INTO v_ok FROM unnest(COALESCE(p_recipients, '{}')) r
   WHERE katalist_priv.may_call(p_list_id, v_me, r);
  DELETE FROM public.call_rings WHERE created_at < now() - interval '1 day';
  INSERT INTO public.call_rings (list_id, caller_profile_id, recipient_profile_id, call_type, caller_name, caller_avatar_url, list_name, list_kind)
  SELECT p_list_id, v_me, r, CASE WHEN p_call_type IN ('audio', 'video') THEN p_call_type END, v_name, v_avatar,
         COALESCE(v_list.name, 'a conversation'), v_list.kind::text
    FROM unnest(v_ok) r;
  RETURN v_ok;
END;
$$;
REVOKE ALL ON FUNCTION public.ring_call(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ring_call(uuid, uuid[], text) TO authenticated;

-- Policy helpers that only ever answer about the caller's own relationships.
CREATE OR REPLACE FUNCTION katalist_priv.can_signal(p_list uuid, p_to uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$ SELECT katalist_priv.may_call(p_list, auth.uid(), p_to) $$;
CREATE OR REPLACE FUNCTION katalist_priv.in_call_room(p_topic text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
  SELECT p_topic ~ '^call:[0-9a-f-]{36}$' AND katalist_priv.is_conversation_party(substring(p_topic FROM 6)::uuid, auth.uid())
$$;
REVOKE ALL ON FUNCTION katalist_priv.can_signal(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION katalist_priv.in_call_room(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.can_signal(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.in_call_room(text) TO authenticated;

-- Connection signalling.
CREATE TABLE IF NOT EXISTS public.call_signals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id       uuid REFERENCES public.lists(id) ON DELETE CASCADE,
  from_profile  uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  from_session  text NOT NULL CHECK (length(from_session) BETWEEN 1 AND 64),
  to_profile    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_session    text CHECK (to_session IS NULL OR length(to_session) BETWEEN 1 AND 64),
  kind          text NOT NULL CHECK (kind IN ('sdp', 'ice', 'bye')),
  payload       jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(payload) <= 65536),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS call_signals_to ON public.call_signals (to_profile, created_at);
CREATE INDEX IF NOT EXISTS call_signals_created ON public.call_signals (created_at);
ALTER TABLE public.call_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.call_signals FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.call_signals TO authenticated;
GRANT ALL ON public.call_signals TO service_role;
DROP POLICY IF EXISTS "signals to their recipient" ON public.call_signals;
CREATE POLICY "signals to their recipient" ON public.call_signals FOR SELECT TO authenticated USING (to_profile = auth.uid());
DROP POLICY IF EXISTS "signals from the authenticated sender to an allowed peer" ON public.call_signals;
CREATE POLICY "signals from the authenticated sender to an allowed peer" ON public.call_signals FOR INSERT TO authenticated
  WITH CHECK (from_profile = auth.uid() AND list_id IS NOT NULL AND katalist_priv.can_signal(list_id, to_profile));

CREATE OR REPLACE FUNCTION katalist_priv.prune_call_signals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $$
BEGIN
  DELETE FROM public.call_signals WHERE created_at < now() - interval '10 minutes';
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION katalist_priv.prune_call_signals() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_call_signals_prune ON public.call_signals;
CREATE TRIGGER trg_call_signals_prune AFTER INSERT ON public.call_signals
  FOR EACH STATEMENT EXECUTE FUNCTION katalist_priv.prune_call_signals();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'call_rings') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.call_rings;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'call_signals') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.call_signals;
    END IF;
  END IF;
END $$;

-- Private in-call channel "call:<list id>": participants only.
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "call room participants read" ON realtime.messages';
    EXECUTE 'DROP POLICY IF EXISTS "call room participants write" ON realtime.messages';
    EXECUTE $p$CREATE POLICY "call room participants read" ON realtime.messages FOR SELECT TO authenticated
      USING (katalist_priv.in_call_room(realtime.topic()))$p$;
    EXECUTE $p$CREATE POLICY "call room participants write" ON realtime.messages FOR INSERT TO authenticated
      WITH CHECK (katalist_priv.in_call_room(realtime.topic()))$p$;
  END IF;
END $$;

-- Blocking hangs up and withdraws rings.
CREATE OR REPLACE FUNCTION public.block_contact(p_other_profile_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'katalist_priv'
AS $function$
DECLARE
  v_me    uuid := auth.uid();
  v_other uuid := katalist_priv.resolve_profile_id(p_other_profile_id);
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_other IS NULL OR v_other = v_me THEN RAISE EXCEPTION 'unknown person'; END IF;
  PERFORM public.disconnect_contact(v_other);
  INSERT INTO katalist_priv.connection_blocks (blocker_profile_id, blocked_profile_id)
  VALUES (v_me, v_other) ON CONFLICT DO NOTHING;
  DELETE FROM public.call_rings
   WHERE (caller_profile_id = v_me AND recipient_profile_id = v_other)
      OR (caller_profile_id = v_other AND recipient_profile_id = v_me);
  -- Any live connection between the two drops on both sides (list_id NULL = every conversation).
  INSERT INTO public.call_signals (list_id, from_profile, from_session, to_profile, kind)
  VALUES (NULL, v_other, 'server', v_me, 'bye'), (NULL, v_me, 'server', v_other, 'bye');
  RETURN true;
END;
$function$;

NOTIFY pgrst, 'reload schema';
