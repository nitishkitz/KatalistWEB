-- Store the application's intended local timezone for new profiles.
-- PostgreSQL itself may remain on UTC; this column is an IANA preference
-- consumed by Morning Brief, quiet hours, and profile displays.
ALTER TABLE public.profiles
  ALTER COLUMN timezone SET DEFAULT 'Asia/Kolkata';
