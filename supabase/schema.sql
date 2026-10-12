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
  currency text not null default 'USD',
  primary key (account_id, user_id)
);

-- Add currency column if table already exists
alter table public.fb_ad_accounts
  add column if not exists currency text not null default 'USD';

alter table public.fb_ad_accounts enable row level security;

create policy "Users manage own fb ad accounts"
  on public.fb_ad_accounts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ─── spending limit monitor: per-account alert threshold + dedup flag ─────────
-- Run in Supabase SQL editor to enable the Spending Limit Monitor tool.
alter table public.fb_ad_accounts
  add column if not exists alert_threshold numeric;

alter table public.fb_ad_accounts
  add column if not exists alert_sent boolean not null default false;

-- ─── RBAC: role column on profiles ────────────────────────────────────────────
alter table public.profiles
  add column if not exists role text not null default 'staff'
  check (role in ('admin', 'leader', 'staff'));

-- Update handle_new_user to preserve role default
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'staff')
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ─── team_members: leader → staff assignments ─────────────────────────────────
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  leader_id uuid not null references auth.users(id) on delete cascade,
  staff_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (leader_id, staff_id)
);

alter table public.team_members enable row level security;

-- Leaders and staff can see their own team rows (writes done via service client in admin routes)
create policy "Team members can read own rows"
  on public.team_members for select
  using (auth.uid() = leader_id or auth.uid() = staff_id);

-- ─── campaign_snapshots: named metric snapshots for compare feature ────────────
-- Run this block in Supabase SQL editor to enable the snapshot/compare feature.

create table if not exists public.campaign_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- { campaigns: SnapshotRow[], adsets: SnapshotAdSetRow[] }
  snapshot_data jsonb not null,
  created_at timestamptz default now() not null
);

alter table public.campaign_snapshots enable row level security;

create policy "Users manage own snapshots"
  on public.campaign_snapshots for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Snapshots per platform (FB + TikTok dashboards keep separate snapshot lists). Idempotent;
-- existing rows default to 'facebook'.
alter table public.campaign_snapshots
  add column if not exists platform text not null default 'facebook';
do $$ begin
  alter table public.campaign_snapshots
    add constraint campaign_snapshots_platform_check check (platform in ('facebook','tiktok'));
exception when duplicate_object then null; end $$;
create index if not exists campaign_snapshots_user_platform_idx
  on public.campaign_snapshots (user_id, platform, created_at desc);

-- ─── Adjust API token ─────────────────────────────────────────────────────────
-- Run this in Supabase SQL editor to add Adjust API token support.
alter table public.profiles
  add column if not exists adjust_api_token text;

-- Adjust app token(s) — comma-separated, required by Adjust Reports API to identify which app to query.
alter table public.profiles
  add column if not exists adjust_app_token text;

-- ─── TikTok Ads: org-wide OAuth connection ────────────────────────────────────
-- Run this in Supabase SQL editor to enable the TikTok Ads tab.
-- Singleton row (id is always `true`) — one org-wide connection, mirrors the
-- org-wide Adjust token pattern rather than FB's per-user pasted token.
-- RLS enabled with NO policies: only the service-role client (server-only) can
-- read/write this table; anon/authenticated keys are denied by default.
create table if not exists public.tiktok_connection (
  id boolean primary key default true check (id),
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  connected_by uuid references auth.users(id),
  connected_at timestamptz,
  updated_at timestamptz default now()
);

alter table public.tiktok_connection enable row level security;

-- ─── TikTok Ads: org-wide advertiser account selection ────────────────────────
create table if not exists public.tiktok_advertiser_accounts (
  advertiser_id text primary key,
  name text not null,
  currency text not null default 'USD',
  is_selected boolean not null default true
);

alter table public.tiktok_advertiser_accounts enable row level security;

-- ─── TikTok Ads: PER-USER connections (plan 261012-1101) ─────────────────────
-- Idempotent. Additive: safe to run while the old org-wide code is still deployed.
-- RLS enabled with NO policies on both tables: service-role client only (tokens).
create table if not exists public.tiktok_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,                 -- null for long-term Marketing API tokens
  token_expires_at timestamptz,       -- null = never expires (only revocable)
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tiktok_connections enable row level security;

create table if not exists public.tiktok_ad_accounts (
  advertiser_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  currency text not null default 'USD',
  is_selected boolean not null default true,
  primary key (advertiser_id, user_id)
);
create index if not exists tiktok_ad_accounts_user_id_idx on public.tiktok_ad_accounts (user_id);
alter table public.tiktok_ad_accounts enable row level security;

-- One-time data move: org-wide singleton -> connected_by's personal rows. Re-runnable.
do $$
declare v_owner uuid;
begin
  if to_regclass('public.tiktok_connection') is null then
    raise notice 'tiktok_connection not present - nothing to migrate';
    return;
  end if;
  -- Durable run-once marker (old code ignores the column): re-running this file must not
  -- resurrect a token the admin later disconnected, or advertiser rows a sync removed.
  execute 'alter table public.tiktok_connection add column if not exists migrated_per_user_at timestamptz';
  if exists (select 1 from public.tiktok_connection where id and migrated_per_user_at is not null) then
    raise notice 'tiktok_connection already migrated - skipped';
    return;
  end if;
  select connected_by into v_owner from public.tiktok_connection
   where id and access_token is not null;
  if v_owner is null then
    raise notice 'No singleton token or connected_by is null - skipped (admin reconnects)';
    return;
  end if;
  insert into public.tiktok_connections (user_id, access_token, refresh_token, token_expires_at, connected_at, updated_at)
  -- No refresh_token = long-term token; the old row's expiry was a guessed 24h, so drop it.
  select v_owner, access_token, refresh_token,
         case when refresh_token is null then null else token_expires_at end,
         coalesce(connected_at, now()), coalesce(updated_at, now())
    from public.tiktok_connection where id
  on conflict (user_id) do nothing;
  if to_regclass('public.tiktok_advertiser_accounts') is not null then
    insert into public.tiktok_ad_accounts (advertiser_id, user_id, name, currency, is_selected)
    select advertiser_id, v_owner, name, currency, is_selected
      from public.tiktok_advertiser_accounts
    on conflict (advertiser_id, user_id) do nothing;
  end if;
  update public.tiktok_connection set migrated_per_user_at = now() where id;
end $$;

-- ─── account_owners: person-in-charge / department mapping for Accounting Export ──
-- Org-wide, service-role-only (mirrors tiktok_advertiser_accounts): RLS enabled with
-- NO policies — only createServiceClient() reads/writes; the API route enforces access.
create table if not exists public.account_owners (
  account_id text not null,
  platform text not null check (platform in ('facebook','tiktok')),
  owner_label text not null default '',
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id),
  primary key (account_id, platform)
);

-- Owner (person-in-charge) and department are tracked as two independent labels — not one
-- combined field. Additive, backward compatible: existing owner_label values are untouched.
alter table public.account_owners
  add column if not exists department_label text not null default '';

alter table public.account_owners enable row level security;

-- Atomic partial upsert: a NULL argument means "leave this field untouched" (COALESCE falls
-- back to the current stored value, or '' on first insert). Exists because owner_label and
-- department_label are edited via two independent inline inputs that PATCH one field at a
-- time — a plain select-then-upsert from the API route has a TOCTOU race (and fails open into
-- silent data loss if the select itself errors), so the merge must happen in one atomic
-- statement instead of two round-trips.
create or replace function public.upsert_account_owner_label(
  p_account_id text,
  p_platform text,
  p_owner_label text,
  p_department_label text,
  p_updated_by uuid
) returns table(owner_label text, department_label text)
language sql
set search_path = public
as $$
  insert into public.account_owners (account_id, platform, owner_label, department_label, updated_at, updated_by)
  values (p_account_id, p_platform, coalesce(p_owner_label, ''), coalesce(p_department_label, ''), now(), p_updated_by)
  on conflict (account_id, platform) do update set
    owner_label = coalesce(p_owner_label, account_owners.owner_label),
    department_label = coalesce(p_department_label, account_owners.department_label),
    updated_at = now(),
    updated_by = p_updated_by
  returning account_owners.owner_label, account_owners.department_label;
$$;

-- ─── Page Scheduler ───────────────────────────────────────────────────────────
-- APPLY MANUALLY in the Supabase SQL editor (idempotent: safe to run repeatedly).
-- Also create a PRIVATE storage bucket `page-scheduler-media` (no policies).
-- ps_fb_profiles / ps_pages hold ciphertext tokens: RLS enabled with NO policies →
-- only createServiceClient() can touch them. All other ps_* tables: own-row SELECT-only
-- policy (the app reads AND writes via the service client and filters by getVisibleUserIds);
-- no write policy, so a user's JWT cannot bypass server validation (status, metrics, image_ref).

create table if not exists public.ps_fb_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  fb_user_id text not null,                -- /me id (user id or system-user id)
  fb_user_name text not null default '',
  token_enc text not null,                 -- "v1:<iv>:<tag>:<ciphertext>" (AAD = user_id)
  token_type text not null default 'USER'
    check (token_type in ('USER','SYSTEM_USER')),
  app_id text,                             -- from debug_token
  expires_at timestamptz,                  -- NULL = never expires (debug_token expires_at 0)
  granted_scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active','invalid')),
  last_error text,
  synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, fb_user_id)
);
alter table public.ps_fb_profiles enable row level security;

create table if not exists public.ps_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.ps_fb_profiles(id) on delete cascade,
  page_id text not null,
  name text not null default '',
  category text,
  picture_url text,
  tasks text[] not null default '{}',
  page_token_enc text not null,
  is_active boolean not null default true,
  synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, page_id)
);
alter table public.ps_pages enable row level security;
create index if not exists ps_pages_profile_idx on public.ps_pages(profile_id);

create table if not exists public.ps_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_countries text[] not null
    default '{US,GB,CA,AU,NZ,IE,DE,FR,NL,SE,NO,DK,FI}',
  updated_at timestamptz default now()
);
alter table public.ps_settings enable row level security;
drop policy if exists "Users manage own ps settings" on public.ps_settings;
create policy "Users manage own ps settings" on public.ps_settings
  for select using (auth.uid() = user_id);

create table if not exists public.ps_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null default '',
  source_type text not null default 'csv' check (source_type in ('csv','json')),
  status text not null default 'awaiting_media' check (status in ('awaiting_media','ready')),
  row_count int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.ps_batches enable row level security;
drop policy if exists "Users manage own ps batches" on public.ps_batches;
create policy "Users manage own ps batches" on public.ps_batches
  for select using (auth.uid() = user_id);

create table if not exists public.ps_posts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ps_batches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  row_number int not null default 0,
  page_id text not null,
  page_name text not null default '',      -- snapshot at upload time
  scheduled_at timestamptz not null,
  message text not null default '',
  image_kind text not null default 'none' check (image_kind in ('none','url','upload')),
  image_ref text,                          -- https URL or storage path
  countries text[] not null default '{}',  -- empty = no geo targeting
  -- 'waiting' = approved but beyond the FB scheduling window; cron pushes it later
  status text not null default 'draft'
    check (status in ('draft','queued','waiting','pushing','scheduled','published','failed','cancelled')),
  attempts int not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz,             -- retry backoff after a rate-limit requeue
  fb_post_id text,
  fb_photo_id text,
  permalink_url text,
  error text,
  error_code int,
  pushed_at timestamptz,
  published_at timestamptz,
  reactions int, comments int, shares int, views int, unique_views int, clicks int,
  engagement int generated always as
    (coalesce(reactions,0) + coalesce(comments,0) + coalesce(shares,0)) stored,
  metrics_at timestamptz,
  metrics_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.ps_posts add column if not exists next_attempt_at timestamptz;
alter table public.ps_posts enable row level security;
drop policy if exists "Users manage own ps posts" on public.ps_posts;
create policy "Users manage own ps posts" on public.ps_posts
  for select using (auth.uid() = user_id);
create index if not exists ps_posts_batch_status_idx on public.ps_posts(batch_id, status);
create index if not exists ps_posts_waiting_idx on public.ps_posts(scheduled_at) where status = 'waiting';
create index if not exists ps_posts_status_sched_idx on public.ps_posts(status, scheduled_at);
create index if not exists ps_posts_user_published_idx on public.ps_posts(user_id, published_at);
create unique index if not exists ps_posts_fb_post_idx
  on public.ps_posts(fb_post_id) where fb_post_id is not null;
-- DB backstop against double upload of the same Page + time slot.
create unique index if not exists ps_posts_slot_idx
  on public.ps_posts(user_id, page_id, scheduled_at) where status not in ('cancelled','failed');

-- Atomic multi-row claim (FOR UPDATE SKIP LOCKED). Used by the client push step
-- (p_status='queued', batch+user set), the cron deferred push (p_status='waiting', both null) and the
-- cron sweep of abandoned 'queued' rows (batch+user null, p_idle_minutes>0 = only rows untouched that long).
-- Rows in retry backoff (next_attempt_at in the future) are skipped.
drop function if exists public.ps_claim_posts(text, uuid, uuid, int, timestamptz, timestamptz);
create or replace function public.ps_claim_posts(
  p_status text, p_batch_id uuid, p_user_id uuid, p_limit int,
  p_earliest timestamptz, p_latest timestamptz, p_idle_minutes int default 0
) returns setof public.ps_posts
language sql security definer set search_path = public as $$
  with c as materialized (
    select id from public.ps_posts
    where status = p_status and p_status in ('queued','waiting')
      and (p_batch_id is null or batch_id = p_batch_id)
      and (p_user_id is null or user_id = p_user_id)
      and scheduled_at between p_earliest and p_latest
      and (next_attempt_at is null or next_attempt_at <= now())
      and (p_idle_minutes <= 0 or updated_at <= now() - make_interval(mins => p_idle_minutes))
    order by scheduled_at, row_number
    limit p_limit
    for update skip locked
  )
  update public.ps_posts p
  set status = 'pushing', claimed_at = now(), attempts = p.attempts + 1, updated_at = now()
  from c
  where p.id = c.id
  returning p.*;
$$;
revoke execute on function public.ps_claim_posts(text, uuid, uuid, int, timestamptz, timestamptz, int)
  from public, anon, authenticated;
-- ─── /Page Scheduler ──────────────────────────────────────────────────────────
