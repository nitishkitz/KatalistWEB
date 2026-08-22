-- Configure the one-minute Katalist push drain Cron for UAT.
-- Invoke with psql variables; do not print secrets.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

select vault.create_secret(:'push_drain_url', 'katalist_push_drain_url', 'UAT push drain URL')
where not exists (select 1 from vault.secrets where name = 'katalist_push_drain_url');

select vault.create_secret(:'push_drain_secret', 'katalist_push_drain_secret', 'UAT push drain secret')
where not exists (select 1 from vault.secrets where name = 'katalist_push_drain_secret');

update vault.secrets
   set secret = :'push_drain_url'
 where name = 'katalist_push_drain_url';

update vault.secrets
   set secret = :'push_drain_secret'
 where name = 'katalist_push_drain_secret';

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'katalist-push-drain';

select cron.schedule(
  'katalist-push-drain',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'katalist_push_drain_url'),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'katalist_push_drain_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $$
);
