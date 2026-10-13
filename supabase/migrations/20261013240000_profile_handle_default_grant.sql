-- profiles.connect_handle defaults to katalist_priv.new_connect_handle(), and a
-- column default runs with the caller's privileges. Signed-in users upsert their
-- own profile at first login, so they must be able to evaluate it. The function
-- only returns a random handle and reads nothing.
GRANT EXECUTE ON FUNCTION katalist_priv.new_connect_handle() TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
