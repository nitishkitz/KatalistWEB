-- Profile wallpaper: a preset cover theme key shown behind the profile hero.
-- Editable by the owner via the existing "profiles update own" RLS policy.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cover_theme text;

NOTIFY pgrst, 'reload schema';
