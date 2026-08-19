CREATE OR REPLACE FUNCTION katalist_priv.test_seed_user(_id uuid, _email text, _phone text, _name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'katalist_priv'
AS $$
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, phone, raw_user_meta_data, created_at, updated_at)
  VALUES (_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          _email, _phone,
          jsonb_build_object('display_name', _name) || CASE WHEN _phone IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('phone', '+' || _phone) END,
          now(), now());
END;
$$;
REVOKE EXECUTE ON FUNCTION katalist_priv.test_seed_user(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION katalist_priv.test_seed_user(uuid, text, text, text) TO service_role;