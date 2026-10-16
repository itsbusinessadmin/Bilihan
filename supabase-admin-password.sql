-- Run after supabase-setup.sql in the Supabase SQL Editor.
-- Enable Authentication -> Sign In / Providers -> Anonymous Sign-Ins.
-- Then set the password with admin_set_password() from the SQL Editor only.
-- No email or phone account is used by this login flow.
begin;

create extension if not exists pgcrypto;

create table if not exists public.admin_password_config (
  id integer primary key check (id = 1),
  password_hash text,
  failures integer not null default 0,
  blocked_until timestamptz
);
insert into public.admin_password_config(id) values (1) on conflict do nothing;
alter table public.admin_password_config enable row level security;
revoke all on public.admin_password_config from public, anon, authenticated;

-- Only the SQL Editor / service role may set or reset this password.
create or replace function public.admin_set_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_password is null or octet_length(p_password) < 8 or octet_length(p_password) > 72 then
    raise exception 'Use a password between 8 and 72 bytes.';
  end if;
  update public.admin_password_config
  set password_hash = crypt(p_password, gen_salt('bf', 12)),
      failures = 0, blocked_until = null
  where id = 1;
end;
$$;
revoke all on function public.admin_set_password(text) from public, anon, authenticated;
grant execute on function public.admin_set_password(text) to service_role;

-- All identities share this attempt limit, so creating another anonymous
-- identity cannot bypass it. A failure returns normally to persist the counter.
create or replace function public.admin_password_login(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  cfg public.admin_password_config%rowtype;
  attempts integer;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'message', 'Start a sign-in session first.');
  end if;

  select * into cfg from public.admin_password_config where id = 1 for update;
  if not found or cfg.password_hash is null then
    return jsonb_build_object('ok', false, 'message', 'The admin password has not been set in Supabase yet.');
  end if;
  if cfg.blocked_until > clock_timestamp() then
    return jsonb_build_object('ok', false, 'message', 'Too many sign-in attempts. Wait one minute and try again.');
  end if;

  -- Reject long values before bcrypt, which truncates passwords at 72 bytes.
  if p_password is null or octet_length(p_password) > 72
     or crypt(p_password, cfg.password_hash) is distinct from cfg.password_hash then
    attempts := case when cfg.blocked_until is not null then 1 else cfg.failures + 1 end;
    update public.admin_password_config
    set failures = attempts,
        blocked_until = case when attempts >= 5 then clock_timestamp() + interval '1 minute' else null end
    where id = 1;
    return jsonb_build_object('ok', false, 'message',
      case when attempts >= 5 then 'Too many sign-in attempts. Wait one minute and try again.'
           else 'That password did not match. Please try again.' end);
  end if;

  insert into public.admin_users(user_id) values (auth.uid()) on conflict do nothing;
  update public.admin_password_config set failures = 0, blocked_until = null where id = 1;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.admin_password_login(text) from public, anon, authenticated;
grant execute on function public.admin_password_login(text) to authenticated;

commit;
