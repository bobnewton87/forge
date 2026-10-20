-- Forge cloud sync schema (CONTRACT §19, setup steps in docs/accounts-setup.md).
-- Run once in Supabase → SQL Editor → New query → Run. Safe to run again.
--
-- One row per synced item: store keys ('profile', 'body', 'meas', 'food', …) and one row per session ('s:<id>').
-- value null = deleted (tombstone). updated_at = the writing device's clock (last write wins);
-- synced_at = server time of the last change (incremental pulls).

create table if not exists public.forge_state (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key        text not null check (char_length(key) between 1 and 200),
  value      jsonb,
  updated_at timestamptz not null default now(),
  synced_at  timestamptz not null default now(),
  primary key (user_id, key)
);
create index if not exists forge_state_synced on public.forge_state (user_id, synced_at);

-- Row-level security: a signed-in user can only see and change their own rows. Anonymous requests see nothing.
alter table public.forge_state enable row level security;
drop policy if exists "forge_state own select" on public.forge_state;
drop policy if exists "forge_state own insert" on public.forge_state;
drop policy if exists "forge_state own update" on public.forge_state;
drop policy if exists "forge_state own delete" on public.forge_state;
create policy "forge_state own select" on public.forge_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "forge_state own insert" on public.forge_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "forge_state own update" on public.forge_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "forge_state own delete" on public.forge_state for delete to authenticated using ((select auth.uid()) = user_id);
revoke all on public.forge_state from anon;
grant select, insert, update, delete on public.forge_state to authenticated;

-- synced_at is always the server's clock, whatever the client sends.
create or replace function public.forge_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.synced_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists forge_state_touch on public.forge_state;
create trigger forge_state_touch before insert or update on public.forge_state
  for each row execute function public.forge_touch();

-- Push: upsert a batch of { key, value, updated_at }, keeping a row only if it is newer than the stored one.
-- Runs as the caller (security invoker), so row-level security still applies. Returns how many rows changed.
create or replace function public.forge_push(rows jsonb) returns integer
language sql security invoker set search_path = '' as $$
  with input as (
    select distinct on (r->>'key') r->>'key' as key, r->'value' as value, (r->>'updated_at')::timestamptz as updated_at
    from jsonb_array_elements(rows) as r
    where coalesce(r->>'key', '') <> ''
    order by r->>'key', (r->>'updated_at')::timestamptz desc
  ), up as (
    insert into public.forge_state as s (user_id, key, value, updated_at)
    select auth.uid(), i.key, case when jsonb_typeof(i.value) = 'null' then null else i.value end, i.updated_at from input i
    on conflict (user_id, key) do update
      set value = excluded.value, updated_at = excluded.updated_at
      where s.updated_at < excluded.updated_at
    returning 1
  )
  select count(*)::integer from up;
$$;
revoke execute on function public.forge_push(jsonb) from public, anon;
grant execute on function public.forge_push(jsonb) to authenticated;

-- In-app account deletion (App Store guideline 5.1.1(v)): deletes the caller's auth user.
-- forge_state rows go with it (on delete cascade); the explicit delete just makes that obvious.
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from public.forge_state where user_id = uid;
  delete from auth.users where id = uid;
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
