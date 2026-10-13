-- Quiet Coey (spec §12.9): Full, Light or Quiet. Quiet keeps functional
-- moments (validation, nudges, relays) and drops optional appearances.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS coey_presence text NOT NULL DEFAULT 'full';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_coey_presence_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_coey_presence_check CHECK (coey_presence IN ('full', 'light', 'quiet'));
NOTIFY pgrst, 'reload schema';
