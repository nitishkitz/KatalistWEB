-- FCM web-push device tokens, one row per browser/device per profile.
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.device_tokens TO authenticated;
GRANT ALL ON public.device_tokens TO service_role;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='device_tokens' AND policyname='own device tokens read') THEN
    CREATE POLICY "own device tokens read" ON public.device_tokens FOR SELECT TO authenticated USING (profile_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='device_tokens' AND policyname='own device tokens insert') THEN
    CREATE POLICY "own device tokens insert" ON public.device_tokens FOR INSERT TO authenticated WITH CHECK (profile_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='device_tokens' AND policyname='own device tokens update') THEN
    CREATE POLICY "own device tokens update" ON public.device_tokens FOR UPDATE TO authenticated USING (profile_id = auth.uid());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_device_tokens_profile ON public.device_tokens (profile_id);
CREATE TRIGGER trg_device_tokens_updated_at
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
