-- Bucket notes: Apple-Notes-style free-form notes attached to a private Bucket.
-- Buckets are private to their owner, so notes are scoped to the author (who is
-- also the bucket owner). Multiple notes per bucket are supported.

CREATE TABLE IF NOT EXISTS public.bucket_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id uuid NOT NULL REFERENCES public.buckets(id) ON DELETE CASCADE,
  author_profile_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS bucket_notes_bucket_idx
  ON public.bucket_notes (bucket_id)
  WHERE deleted_at IS NULL;

ALTER TABLE public.bucket_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bucket_notes' AND policyname='bucket_notes select own') THEN
    CREATE POLICY "bucket_notes select own" ON public.bucket_notes
      FOR SELECT TO authenticated USING (author_profile_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bucket_notes' AND policyname='bucket_notes insert own') THEN
    CREATE POLICY "bucket_notes insert own" ON public.bucket_notes
      FOR INSERT TO authenticated
      WITH CHECK (
        author_profile_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.buckets b WHERE b.id = bucket_id AND b.owner_profile_id = auth.uid())
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bucket_notes' AND policyname='bucket_notes update own') THEN
    CREATE POLICY "bucket_notes update own" ON public.bucket_notes
      FOR UPDATE TO authenticated USING (author_profile_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='bucket_notes' AND policyname='bucket_notes delete own') THEN
    CREATE POLICY "bucket_notes delete own" ON public.bucket_notes
      FOR DELETE TO authenticated USING (author_profile_id = auth.uid());
  END IF;
END $$;

-- Realtime (ignore if already a member of the publication).
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bucket_notes;
  EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
  END;
END $$;

NOTIFY pgrst, 'reload schema';
