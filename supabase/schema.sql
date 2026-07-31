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

-- ─── AFS Niche Testing ────────────────────────────────────────────────────────
-- Ads-launching FB token, AES-256-GCM encrypted at rest. Deliberately NOT a profiles
-- column: profiles' own SELECT policy exposes rows to the owning browser, and the
-- accounting-export fan-out reads other users' profiles.fb_access_token server-side.
-- RLS enabled with NO policies → only createServiceClient() can touch this table.
create table if not exists public.afs_launch_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_enc text not null,               -- "v1:<iv>:<tag>:<ciphertext>" base64 parts
  granted_scopes text[] not null default '{}',
  verified_at timestamptz,
  updated_at timestamptz default now()
);
alter table public.afs_launch_tokens enable row level security;

create table if not exists public.afs_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  status text not null default 'draft'
    check (status in ('draft','generating','ready','publishing','published','failed')),
  publish_active boolean not null default false,   -- false ⇒ create FB objects PAUSED
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.afs_batches enable row level security;
create policy "Users manage own afs batches" on public.afs_batches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.afs_topics (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.afs_batches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position int not null default 0,
  topic_text text not null,
  target_url text not null,
  ad_account_id text, page_id text, page_name text, pixel_id text,
  countries text[] not null default '{}',          -- ISO-3166-1 alpha-2
  primary_text text not null default '',           -- FB ad body copy (NOT the on-image headline)
  ad_headline text not null default '',            -- link_data.name
  special_ad_category text not null default 'NONE'
    check (special_ad_category in ('NONE','EMPLOYMENT','HOUSING','CREDIT','ISSUES_ELECTIONS_POLITICS')),
  daily_budget_minor bigint not null default 1000, -- minor units (USD cents; VND has none)
  status text not null default 'draft'
    check (status in ('draft','generating','ready','publishing','published','partial_failed','failed')),
  fb_campaign_id text, fb_adset_id text,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.afs_topics enable row level security;
create policy "Users manage own afs topics" on public.afs_topics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists afs_topics_batch_idx on public.afs_topics(batch_id);

-- One row per generated image AND per Kie job — this IS the job/status table.
create table if not exists public.afs_creatives (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.afs_topics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  style_key text not null check (style_key in
    ('notes_app','retro_pixel','editorial','craft_paper','bold_type')),
  image_headline text not null default '',   -- headline baked INTO the image
  image_prompt text not null default '',     -- fully substituted prompt sent to Kie
  kie_task_id text,
  status text not null default 'pending'
    -- 'reconciling' is a transient atomic-claim state (Phase 04 reconcile-on-poll) —
    -- not in the original Phase 01 draft, added here since the state machine requires it.
    check (status in ('pending','submitted','reconciling','succeeded','failed')),
  storage_path text,                         -- afs/{user}/{batch}/{topic}/{creative_id}-{style}.png
                                              -- [Red Team Fix] keyed by creative_id (not just topic+style) so a
                                              -- regenerate race can never let a stale write land on a live path
  fb_image_hash text, fb_creative_id text, fb_ad_id text,
  error text,
  submitted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.afs_creatives enable row level security;
create policy "Users manage own afs creatives" on public.afs_creatives
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists afs_creatives_topic_idx on public.afs_creatives(topic_id);
create unique index if not exists afs_creatives_kie_task_idx
  on public.afs_creatives(kie_task_id) where kie_task_id is not null;
