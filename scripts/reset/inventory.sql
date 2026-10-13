-- Read-only counts and schema metadata. No user contents or secret values.
SELECT jsonb_build_object(
  'counts', (SELECT coalesce(jsonb_agg(row_to_json(item)), '[]'::jsonb) FROM (SELECT n.nspname AS schema, c.relname AS table,
       ((xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text)::bigint AS rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND (
  n.nspname IN ('public', 'katalist_priv') OR
  (n.nspname = 'auth' AND c.relname IN ('users', 'sessions', 'refresh_tokens', 'identities')) OR
  (n.nspname = 'storage' AND c.relname IN ('objects', 'buckets')) OR
  (n.nspname IN ('net', 'pgmq') AND c.relname LIKE '%queue%')
) ORDER BY n.nspname, c.relname) item),
  'foreign_keys', (SELECT coalesce(jsonb_agg(row_to_json(item)), '[]'::jsonb) FROM (SELECT ns.nspname AS schema, t.relname AS table, a.conname AS constraint,
       rns.nspname AS referenced_schema, r.relname AS referenced_table,
       a.confdeltype AS delete_action
FROM pg_constraint a JOIN pg_class t ON t.oid = a.conrelid
JOIN pg_namespace ns ON ns.oid = t.relnamespace
JOIN pg_class r ON r.oid = a.confrelid JOIN pg_namespace rns ON rns.oid = r.relnamespace
WHERE a.contype = 'f' AND ns.nspname IN ('public', 'katalist_priv', 'auth', 'storage')
ORDER BY ns.nspname, t.relname, a.conname) item),
  'extensions', (SELECT coalesce(jsonb_agg(row_to_json(item)), '[]'::jsonb) FROM (SELECT extname, extversion FROM pg_extension ORDER BY extname) item),
  'policies', (SELECT coalesce(jsonb_agg(row_to_json(item)), '[]'::jsonb) FROM (SELECT schemaname, tablename, policyname, roles, cmd FROM pg_policies
WHERE schemaname IN ('public', 'katalist_priv', 'storage') ORDER BY schemaname, tablename, policyname) item),
  'realtime', (SELECT coalesce(jsonb_agg(row_to_json(item)), '[]'::jsonb) FROM (SELECT pubname, schemaname, tablename FROM pg_publication_tables ORDER BY pubname, schemaname, tablename) item),
  'triggers', (SELECT coalesce(jsonb_agg(row_to_json(item)), '[]'::jsonb) FROM (SELECT event_object_schema, event_object_table, trigger_name, event_manipulation
FROM information_schema.triggers WHERE event_object_schema IN ('public', 'katalist_priv', 'auth', 'storage')
ORDER BY event_object_schema, event_object_table, trigger_name) item),
  'sensitive_functions', (SELECT coalesce(jsonb_agg(row_to_json(item)), '[]'::jsonb) FROM (SELECT n.nspname AS schema, p.proname AS function, pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'execute') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'execute') AS authenticated_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'katalist_priv') AND
 (p.proname LIKE 'test_%' OR p.proname LIKE '%seed%' OR p.proname LIKE 'run_%' OR p.proname LIKE '%webhook%')
ORDER BY n.nspname, p.proname) item)
) AS inventory;
