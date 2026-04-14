-- Run this in the Supabase SQL editor (Dashboard → SQL editor)

-- profiles table: one row per auth user, stores FB credentials
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  fb_access_token text,
  fb_ad_account_id text,
  updated_at timestamptz default now()
);

-- Auto-create profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS: users can only read/write their own profile
alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ─── fb_ad_accounts: discovered FB ad accounts per user ──────────────────────
-- Run this block separately in Supabase SQL editor if profiles already exists.

create table if not exists public.fb_ad_accounts (
  account_id text not null,           -- "act_XXXXX" format
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_selected boolean not null default true,
  account_status int,                  -- 1=Active, 2=Disabled etc
  primary key (account_id, user_id)
);

alter table public.fb_ad_accounts enable row level security;

create policy "Users manage own fb ad accounts"
  on public.fb_ad_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
