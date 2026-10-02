-- Rich private Bucket notes. The old body column stays for legacy clients.
ALTER TABLE public.bucket_notes
  ADD COLUMN IF NOT EXISTS content_json jsonb,
  ADD COLUMN IF NOT EXISTS plain_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz,
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;

UPDATE public.bucket_notes
SET plain_text = body,
    content_json = jsonb_build_object('type', 'doc', 'content',
      jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content',
        jsonb_build_array(jsonb_build_object('type', 'text', 'text', body)))))
WHERE content_json IS NULL AND body <> '';

CREATE INDEX IF NOT EXISTS bucket_notes_search_idx ON public.bucket_notes
  USING gin (to_tsvector('simple', title || ' ' || plain_text));
CREATE INDEX IF NOT EXISTS bucket_notes_order_idx ON public.bucket_notes
  (bucket_id, pinned_at DESC NULLS LAST, updated_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.bucket_note_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.bucket_notes(id) ON DELETE CASCADE,
  owner_profile_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  alt_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT bucket_note_attachment_owner_path CHECK (storage_path LIKE owner_profile_id::text || '/%')
);
CREATE INDEX IF NOT EXISTS bucket_note_attachments_note_idx ON public.bucket_note_attachments(note_id) WHERE deleted_at IS NULL;
ALTER TABLE public.bucket_note_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "note attachments owner read" ON public.bucket_note_attachments FOR SELECT TO authenticated
  USING (owner_profile_id = auth.uid() AND EXISTS (SELECT 1 FROM public.bucket_notes n WHERE n.id = note_id AND n.author_profile_id = auth.uid() AND n.deleted_at IS NULL));
CREATE POLICY "note attachments owner insert" ON public.bucket_note_attachments FOR INSERT TO authenticated
  WITH CHECK (owner_profile_id = auth.uid() AND EXISTS (SELECT 1 FROM public.bucket_notes n WHERE n.id = note_id AND n.author_profile_id = auth.uid() AND n.deleted_at IS NULL));
CREATE POLICY "note attachments owner update" ON public.bucket_note_attachments FOR UPDATE TO authenticated
  USING (owner_profile_id = auth.uid()) WITH CHECK (owner_profile_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.bucket_note_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.bucket_notes(id) ON DELETE CASCADE,
  thing_id uuid REFERENCES public.things(id) ON DELETE CASCADE,
  list_id uuid REFERENCES public.lists(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('thing', 'list')),
  target_id uuid NOT NULL,
  relation text NOT NULL DEFAULT 'reference' CHECK (relation IN ('reference', 'created_from')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(note_id, target_kind, target_id, relation),
  CONSTRAINT bucket_note_link_one_target CHECK (
    (target_kind = 'thing' AND thing_id = target_id AND list_id IS NULL)
    OR (target_kind = 'list' AND list_id = target_id AND thing_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS bucket_note_links_note_idx ON public.bucket_note_links(note_id);
ALTER TABLE public.bucket_note_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "note links owner read" ON public.bucket_note_links FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bucket_notes n WHERE n.id = note_id AND n.author_profile_id = auth.uid() AND n.deleted_at IS NULL));
CREATE POLICY "note links owner insert" ON public.bucket_note_links FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.bucket_notes n WHERE n.id = note_id AND n.author_profile_id = auth.uid() AND n.deleted_at IS NULL)
    AND ((target_kind = 'thing' AND EXISTS (SELECT 1 FROM public.things t WHERE t.id = thing_id))
      OR (target_kind = 'list' AND EXISTS (SELECT 1 FROM public.lists l WHERE l.id = list_id)))
  );
CREATE POLICY "note links owner delete" ON public.bucket_note_links FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bucket_notes n WHERE n.id = note_id AND n.author_profile_id = auth.uid()));

INSERT INTO storage.buckets (id, name, public) VALUES ('bucket-note-files', 'bucket-note-files', false)
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "bucket note files owner read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'bucket-note-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "bucket note files owner insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bucket-note-files' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "bucket note files owner delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'bucket-note-files' AND (storage.foldername(name))[1] = auth.uid()::text);

NOTIFY pgrst, 'reload schema';
