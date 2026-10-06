-- The restored target schema contains public.handle_new_user(), but the
-- auth.users trigger that wires signup to profile/actor creation was missing.
-- Keep new accounts linked to their public profile before client RLS writes.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
