-- ===========================================================================
-- KK Financial Assistant — outstanding-payment reminders (OPTIONAL).
-- Run AFTER 0001_finance.sql.
--
-- An hourly pg_cron job invokes the `notify-due-payment` Edge Function, which
-- finds unpaid finance entries whose remind_at has passed and haven't been
-- notified, pushes a reminder to the owner's devices (Web Push / VAPID), then
-- stamps notified_at.
--
-- Requires a `push_subscriptions` table (endpoint, user_id, p256dh, auth) and
-- VAPID secrets on the Edge Function — see README.md. Edit the two
-- placeholders below before running, then run this block.
--
--   __PROJECT_REF__       your project ref (from the project URL)
--   __SERVICE_ROLE_KEY__  Project Settings → API → service_role key
-- ===========================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('finance-notifier');
exception
  when others then null;
end $$;

select cron.schedule(
  'finance-notifier',
  '0 * * * *',                       -- top of every hour
  $$
  select net.http_post(
    url     := 'https://__PROJECT_REF__.supabase.co/functions/v1/notify-due-payment',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer __SERVICE_ROLE_KEY__'
               ),
    body    := '{}'::jsonb
  );
  $$
);

-- Manual test:
--   select net.http_post(
--     url := 'https://__PROJECT_REF__.supabase.co/functions/v1/notify-due-payment',
--     headers := jsonb_build_object('Authorization','Bearer __SERVICE_ROLE_KEY__'),
--     body := '{}'::jsonb);
