-- ============ Phase 5: Lists ============

CREATE TABLE public.lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  context public.context_kind NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lists_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE public.list_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role public.list_role NOT NULL DEFAULT 'collaborator',
  added_by_profile_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_id, profile_id)
);

CREATE TABLE public.list_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
  author_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT list_messages_body_not_blank CHECK (length(btrim(body)) > 0)
);

CREATE INDEX idx_lists_owner ON public.lists(owner_profile_id);
CREATE INDEX idx_list_members_profile ON public.list_members(profile_id);
CREATE INDEX idx_list_members_list ON public.list_members(list_id);
CREATE INDEX idx_list_messages_list_created ON public.list_messages(list_id, created_at DESC);

ALTER TABLE public.things
  ADD CONSTRAINT things_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.lists(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_things_list ON public.things(list_id);

CREATE TRIGGER trg_lists_updated_at BEFORE UPDATE ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_list_members_updated_at BEFORE UPDATE ON public.list_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_list_messages_updated_at BEFORE UPDATE ON public.list_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Ownership immutability
CREATE OR REPLACE FUNCTION public.enforce_list_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'lists.id is immutable';
  END IF;
  IF NEW.owner_profile_id <> OLD.owner_profile_id THEN
    RAISE EXCEPTION 'List ownership cannot be transferred';
  END IF;
  IF NEW.context IS DISTINCT FROM OLD.context THEN
    RAISE EXCEPTION 'a List''s context cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_lists_immutable BEFORE UPDATE ON public.lists
  FOR EACH ROW EXECUTE FUNCTION public.enforce_list_immutability();

-- Owner may never appear in list_members
CREATE OR REPLACE FUNCTION public.forbid_owner_membership()
RETURNS trigger LANGUAGE plpgsql SET search_path = 'pg_catalog','public' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.lists l WHERE l.id = NEW.list_id AND l.owner_profile_id = NEW.profile_id) THEN
    RAISE EXCEPTION 'the List Owner is not a member row';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_list_members_no_owner BEFORE INSERT OR UPDATE ON public.list_members
  FOR EACH ROW EXECUTE FUNCTION public.forbid_owner_membership();

-- ============ Helpers ============

CREATE OR REPLACE FUNCTION katalist_priv.is_list_owner(_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
  SELECT EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.owner_profile_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION katalist_priv.is_list_member(_list_id uuid, _roles public.list_role[] DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.list_members m
    WHERE m.list_id = _list_id
      AND m.profile_id = auth.uid()
      AND (_roles IS NULL OR m.role = ANY(_roles))
  );
$$;

CREATE OR REPLACE FUNCTION katalist_priv.can_view_list(_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
  SELECT katalist_priv.is_list_owner(_list_id) OR katalist_priv.is_list_member(_list_id);
$$;

CREATE OR REPLACE FUNCTION katalist_priv.list_context(_list_id uuid)
RETURNS public.context_kind LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
  SELECT l.context FROM public.lists l WHERE l.id = _list_id;
$$;

CREATE OR REPLACE FUNCTION katalist_priv.can_create_thing_in_list(_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
  SELECT _list_id IS NULL
      OR (
        EXISTS (SELECT 1 FROM public.lists l WHERE l.id = _list_id AND l.archived_at IS NULL)
        AND (
          katalist_priv.is_list_owner(_list_id)
          OR katalist_priv.is_list_member(_list_id, ARRAY['collaborator']::public.list_role[])
        )
      );
$$;

CREATE OR REPLACE FUNCTION katalist_priv.can_view_thing(_thing_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.things t
    WHERE t.id = _thing_id
      AND (
        EXISTS (
          SELECT 1 FROM public.actors a
          WHERE a.id IN (t.owner_actor_id, t.current_assignee_actor_id)
            AND a.profile_id = auth.uid()
        )
        OR (t.list_id IS NOT NULL AND katalist_priv.can_view_list(t.list_id))
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION katalist_priv.is_list_owner(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION katalist_priv.is_list_member(uuid, public.list_role[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION katalist_priv.can_view_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.is_list_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.is_list_member(uuid, public.list_role[]) TO authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.can_view_list(uuid) TO authenticated;

-- ============ GRANTs + RLS ============

GRANT SELECT ON public.lists TO authenticated;
GRANT UPDATE ON public.lists TO authenticated;
GRANT ALL ON public.lists TO service_role;

GRANT SELECT ON public.list_members TO authenticated;
GRANT ALL ON public.list_members TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.list_messages TO authenticated;
GRANT ALL ON public.list_messages TO service_role;

ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lists visible to owner and members" ON public.lists
  FOR SELECT TO authenticated USING (katalist_priv.can_view_list(id));
CREATE POLICY "lists updated by owner" ON public.lists
  FOR UPDATE TO authenticated
  USING (owner_profile_id = auth.uid()) WITH CHECK (owner_profile_id = auth.uid());

CREATE POLICY "list members visible to list viewers" ON public.list_members
  FOR SELECT TO authenticated USING (katalist_priv.can_view_list(list_id));

CREATE POLICY "list messages visible to list viewers" ON public.list_messages
  FOR SELECT TO authenticated USING (katalist_priv.can_view_list(list_id));
CREATE POLICY "list messages written by owner or collaborators" ON public.list_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    author_profile_id = auth.uid()
    AND (
      katalist_priv.is_list_owner(list_id)
      OR katalist_priv.is_list_member(list_id, ARRAY['collaborator']::public.list_role[])
    )
  );
CREATE POLICY "list messages edited by author" ON public.list_messages
  FOR UPDATE TO authenticated
  USING (author_profile_id = auth.uid()) WITH CHECK (author_profile_id = auth.uid());
CREATE POLICY "list messages deleted by author" ON public.list_messages
  FOR DELETE TO authenticated USING (author_profile_id = auth.uid());

-- ============ RPCs ============

CREATE OR REPLACE FUNCTION public.create_list(p_name text, p_context public.context_kind DEFAULT NULL)
RETURNS public.lists LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE
  v_list public.lists;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'a List needs a name';
  END IF;

  INSERT INTO public.lists (name, owner_profile_id, context)
  VALUES (btrim(p_name), auth.uid(), COALESCE(p_context, katalist_priv.active_context()))
  RETURNING * INTO v_list;

  RETURN v_list;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_list_member(p_list_id uuid, p_profile_id uuid, p_role public.list_role DEFAULT 'collaborator')
RETURNS public.list_members LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE
  v_member public.list_members;
BEGIN
  IF NOT katalist_priv.is_list_owner(p_list_id) THEN
    RAISE EXCEPTION 'only the List Owner can add members';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_profile_id) THEN
    RAISE EXCEPTION 'unknown person';
  END IF;

  INSERT INTO public.list_members (list_id, profile_id, role, added_by_profile_id)
  VALUES (p_list_id, p_profile_id, COALESCE(p_role, 'collaborator'), auth.uid())
  ON CONFLICT (list_id, profile_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING * INTO v_member;

  RETURN v_member;
END;
$$;

CREATE OR REPLACE FUNCTION public.change_list_role(p_list_id uuid, p_profile_id uuid, p_role public.list_role)
RETURNS public.list_members LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE
  v_member public.list_members;
BEGIN
  IF NOT katalist_priv.is_list_owner(p_list_id) THEN
    RAISE EXCEPTION 'only the List Owner can change roles';
  END IF;
  IF p_role IS NULL THEN
    RAISE EXCEPTION 'a role is required';
  END IF;

  UPDATE public.list_members SET role = p_role
   WHERE list_id = p_list_id AND profile_id = p_profile_id
  RETURNING * INTO v_member;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'that person is not a member of this List';
  END IF;
  RETURN v_member;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_list_member(p_list_id uuid, p_profile_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
BEGIN
  IF NOT (katalist_priv.is_list_owner(p_list_id) OR p_profile_id = auth.uid()) THEN
    RAISE EXCEPTION 'only the List Owner can remove other members';
  END IF;

  DELETE FROM public.list_members
   WHERE list_id = p_list_id AND profile_id = p_profile_id;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_thing_person_to_list(p_thing_id uuid, p_list_id uuid, p_role public.list_role DEFAULT 'collaborator')
RETURNS public.list_members LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
DECLARE
  v_profile uuid;
  v_member  public.list_members;
BEGIN
  IF NOT katalist_priv.is_list_owner(p_list_id) THEN
    RAISE EXCEPTION 'only the List Owner can promote someone into this List';
  END IF;

  SELECT a.profile_id INTO v_profile
    FROM public.things t
    JOIN public.actors a ON a.id = t.current_assignee_actor_id
   WHERE t.id = p_thing_id;

  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'this Thing is not held by a Katalist user';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lists l WHERE l.id = p_list_id AND l.owner_profile_id = v_profile) THEN
    RAISE EXCEPTION 'this person already owns the List';
  END IF;

  INSERT INTO public.list_members (list_id, profile_id, role, added_by_profile_id)
  VALUES (p_list_id, v_profile, COALESCE(p_role, 'collaborator'), auth.uid())
  ON CONFLICT (list_id, profile_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING * INTO v_member;

  PERFORM katalist_priv.log_activity(p_thing_id, katalist_priv.current_actor_id(), 'promoted_to_list',
    jsonb_build_object('list_id', p_list_id, 'role', COALESCE(p_role, 'collaborator')));

  RETURN v_member;
END;
$$;

-- Thing-only List label
CREATE OR REPLACE VIEW public.thing_list_label
WITH (security_invoker = on) AS
  SELECT t.id AS thing_id, l.id AS list_id, l.name AS list_name, l.context AS list_context
    FROM public.things t
    JOIN public.lists l ON l.id = t.list_id;

GRANT SELECT ON public.thing_list_label TO authenticated;

CREATE OR REPLACE FUNCTION public.get_thing_list_label(p_thing_id uuid)
RETURNS TABLE (list_id uuid, list_name text, list_context public.context_kind)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = 'pg_catalog','public','katalist_priv' AS $$
  SELECT l.id, l.name, l.context
    FROM public.things t
    JOIN public.lists l ON l.id = t.list_id
   WHERE t.id = p_thing_id
     AND katalist_priv.can_view_thing(p_thing_id);
$$;

REVOKE EXECUTE ON FUNCTION public.create_list(text, public.context_kind) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.add_list_member(uuid, uuid, public.list_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.change_list_role(uuid, uuid, public.list_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_list_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.promote_thing_person_to_list(uuid, uuid, public.list_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_thing_list_label(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_list(text, public.context_kind) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_list_member(uuid, uuid, public.list_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_list_role(uuid, uuid, public.list_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_list_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promote_thing_person_to_list(uuid, uuid, public.list_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_thing_list_label(uuid) TO authenticated;
