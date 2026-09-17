-- Team screen: full company-directory read access (chosen by the product owner).
-- Allow any authenticated user to read all profiles so the Team table can show
-- each teammate's role (occupation), phone, email, and connected-since. This
-- intentionally exposes personal contact data to every signed-in user.
--
-- Note: RLS is row-level, so this grants read of the whole profiles row
-- (including age/timezone) to authenticated users, not just the columns the
-- Team screen renders.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'profiles select all authenticated'
  ) THEN
    CREATE POLICY "profiles select all authenticated"
      ON public.profiles FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
