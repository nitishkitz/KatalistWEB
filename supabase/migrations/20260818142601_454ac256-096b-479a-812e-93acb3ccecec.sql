-- =========================================================
-- KATALIST PHASE 2 + 3 — THINGS, HISTORY, VISIBILITY
-- =========================================================

CREATE TABLE public.things (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                   text NOT NULL CHECK (length(btrim(title)) > 0),
  notes                   text,
  creator_actor_id        uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
  owner_actor_id          uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
  current_assignee_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
  current_assignment_id   uuid,
  list_id                 uuid,
  context                 public.context_kind NOT NULL,
  owner_importance        public.importance NOT NULL DEFAULT 'next',
  assignee_personal_pace  public.pace,
  acknowledgement         public.acknowledgement_state NOT NULL DEFAULT 'waiting_for_catch',
  work_status             public.work_status NOT NULL DEFAULT 'not_started',
  caught_at               timestamptz,
  due_at                  timestamptz,
  due_has_time            boolean NOT NULL DEFAULT false,
  sorted_at               timestamptz,
  cancelled_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thing_pace_requires_catch CHECK (
    acknowledgement = 'caught' OR assignee_personal_pace IS NULL
  ),
  CONSTRAINT thing_caught_timestamp CHECK (
    (acknowledgement = 'caught') = (caught_at IS NOT NULL)
  ),
  CONSTRAINT thing_sorted_timestamp CHECK (
    (work_status = 'sorted') = (sorted_at IS NOT NULL)
  ),
  CONSTRAINT thing_cancelled_timestamp CHECK (
    (work_status = 'cancelled') = (cancelled_at IS NOT NULL)
  ),
  CONSTRAINT thing_due_time_needs_due CHECK (due_at IS NOT NULL OR due_has_time = false)
);

CREATE TABLE public.thing_assignments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thing_id             uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  assignee_actor_id    uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
  assigned_by_actor_id uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
  acknowledgement      public.acknowledgement_state NOT NULL DEFAULT 'waiting_for_catch',
  caught_at            timestamptz,
  assigned_at          timestamptz NOT NULL DEFAULT now(),
  ended_at             timestamptz,
  ended_reason         text
);

ALTER TABLE public.things
  ADD CONSTRAINT things_current_assignment_fk
  FOREIGN KEY (current_assignment_id)
  REFERENCES public.thing_assignments(id) ON DELETE SET NULL;

CREATE TABLE public.thing_activity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thing_id    uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES public.actors(id) ON DELETE SET NULL,
  event       public.activity_event NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.thing_comments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thing_id         uuid NOT NULL REFERENCES public.things(id) ON DELETE CASCADE,
  author_actor_id  uuid NOT NULL REFERENCES public.actors(id) ON DELETE RESTRICT,
  body             text NOT NULL CHECK (length(btrim(body)) > 0),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------- Indexes ----------
CREATE INDEX idx_things_my_court
  ON public.things (current_assignee_actor_id, context, work_status);
CREATE INDEX idx_things_their_court
  ON public.things (owner_actor_id, context, work_status);
CREATE INDEX idx_things_list
  ON public.things (list_id, created_at DESC) WHERE list_id IS NOT NULL;
CREATE INDEX idx_things_waiting
  ON public.things (current_assignee_actor_id)
  WHERE acknowledgement = 'waiting_for_catch'
    AND work_status NOT IN ('sorted','cancelled');
CREATE INDEX idx_things_due
  ON public.things (due_at)
  WHERE due_at IS NOT NULL AND work_status NOT IN ('sorted','cancelled');
CREATE INDEX idx_things_creator ON public.things (creator_actor_id);
CREATE INDEX idx_thing_assignments_thing
  ON public.thing_assignments (thing_id, assigned_at DESC);
CREATE INDEX idx_thing_assignments_assignee
  ON public.thing_assignments (assignee_actor_id);
CREATE INDEX idx_thing_activity_thing
  ON public.thing_activity (thing_id, created_at DESC);
CREATE INDEX idx_thing_comments_thing
  ON public.thing_comments (thing_id, created_at DESC);

-- ---------- Immutability ----------
CREATE OR REPLACE FUNCTION public.enforce_thing_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'things.id is immutable';
  END IF;
  IF NEW.creator_actor_id <> OLD.creator_actor_id THEN
    RAISE EXCEPTION 'things.creator_actor_id is immutable';
  END IF;
  IF NEW.owner_actor_id <> OLD.owner_actor_id THEN
    RAISE EXCEPTION 'things.owner_actor_id is immutable in this baseline (owner transfer is not supported)';
  END IF;
  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'things.created_at is immutable';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_thing_immutability() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_things_immutable
  BEFORE UPDATE ON public.things
  FOR EACH ROW EXECUTE FUNCTION public.enforce_thing_immutability();

CREATE TRIGGER trg_things_updated_at
  BEFORE UPDATE ON public.things
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_thing_comments_updated_at
  BEFORE UPDATE ON public.thing_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- History rows are append-only.
CREATE OR REPLACE FUNCTION public.forbid_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'history rows in % are append-only', TG_TABLE_NAME;
END;
$$;
REVOKE ALL ON FUNCTION public.forbid_history_mutation() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_thing_activity_append_only
  BEFORE UPDATE OR DELETE ON public.thing_activity
  FOR EACH ROW EXECUTE FUNCTION public.forbid_history_mutation();

-- Assignment rows may only be closed out (ended_at / ended_reason / ack fields
-- are maintained by lifecycle functions); identity fields never change.
CREATE OR REPLACE FUNCTION public.enforce_assignment_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'assignment history cannot be deleted';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.thing_id <> OLD.thing_id
     OR NEW.assignee_actor_id <> OLD.assignee_actor_id
     OR NEW.assigned_by_actor_id <> OLD.assigned_by_actor_id
     OR NEW.assigned_at <> OLD.assigned_at THEN
    RAISE EXCEPTION 'assignment history is immutable';
  END IF;
  IF OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at THEN
    RAISE EXCEPTION 'a closed assignment cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_assignment_immutability() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_thing_assignments_immutable
  BEFORE UPDATE OR DELETE ON public.thing_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_assignment_immutability();

-- ---------- Visibility helpers ----------
-- can_view_thing is extended in later phases (List membership, Bridge grants).
CREATE OR REPLACE FUNCTION katalist_priv.can_view_thing(_thing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.things t
    JOIN public.actors a
      ON a.id IN (t.owner_actor_id, t.current_assignee_actor_id)
    WHERE t.id = _thing_id
      AND a.profile_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION katalist_priv.can_view_thing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.can_view_thing(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION katalist_priv.is_thing_owner(_thing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.things t
    JOIN public.actors a ON a.id = t.owner_actor_id
    WHERE t.id = _thing_id AND a.profile_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION katalist_priv.is_thing_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.is_thing_owner(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION katalist_priv.is_current_assignee(_thing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, katalist_priv
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.things t
    JOIN public.actors a ON a.id = t.current_assignee_actor_id
    WHERE t.id = _thing_id AND a.profile_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION katalist_priv.is_current_assignee(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION katalist_priv.is_current_assignee(uuid) TO authenticated, service_role;

-- ---------- Grants ----------
-- Things and history are read-only from the client; all writes go through RPCs.
GRANT SELECT ON public.things TO authenticated;
GRANT ALL ON public.things TO service_role;
GRANT SELECT ON public.thing_assignments TO authenticated;
GRANT ALL ON public.thing_assignments TO service_role;
GRANT SELECT ON public.thing_activity TO authenticated;
GRANT ALL ON public.thing_activity TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.thing_comments TO authenticated;
GRANT ALL ON public.thing_comments TO service_role;

-- ---------- RLS ----------
ALTER TABLE public.things ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thing_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thing_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thing_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "things visible to permitted participants"
  ON public.things FOR SELECT TO authenticated
  USING (katalist_priv.can_view_thing(id));

CREATE POLICY "thing assignments visible to thing viewers"
  ON public.thing_assignments FOR SELECT TO authenticated
  USING (katalist_priv.can_view_thing(thing_id));

CREATE POLICY "thing activity visible to thing viewers"
  ON public.thing_activity FOR SELECT TO authenticated
  USING (katalist_priv.can_view_thing(thing_id));

CREATE POLICY "thing comments visible to thing viewers"
  ON public.thing_comments FOR SELECT TO authenticated
  USING (katalist_priv.can_view_thing(thing_id));

CREATE POLICY "thing comments written by thing viewers"
  ON public.thing_comments FOR INSERT TO authenticated
  WITH CHECK (
    katalist_priv.can_view_thing(thing_id)
    AND author_actor_id = katalist_priv.current_actor_id()
  );

CREATE POLICY "thing comments edited by their author"
  ON public.thing_comments FOR UPDATE TO authenticated
  USING (author_actor_id = katalist_priv.current_actor_id())
  WITH CHECK (author_actor_id = katalist_priv.current_actor_id());