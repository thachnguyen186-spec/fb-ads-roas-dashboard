# Phase 01 — DB Schema + Storage Bucket + Types + Encryption Helper

## Context Links
- Schema: `supabase/schema.sql` (append at end; zero-policy org pattern at lines 140-150 `tiktok_connection`, 165-179 `account_owners`)
- Types: `lib/types.ts` (section-comment style, e.g. line 287 `// ─── Accounting Export ──`)
- Env template: `.env.local.example`
- Image ruleset (style keys): `image_ad_prompt_generator.md:21,31,41,51,61`

## Overview
- **Priority:** P0 — blocks 02-06
- **Status:** pending · **Effort:** 3h
- **Description:** Foundation only. 4 new tables, 1 private Storage bucket, types, and an AES-256-GCM token helper. No runtime behavior.

## Key Insights
- **The money-token gets its own zero-policy table, not a `profiles` column.** `profiles` RLS (`schema.sql:30-32`) lets any signed-in browser `select` its own row — today that already hands the plaintext `fb_access_token` to the client. Additionally `app/api/accounting-export/route.ts:60` selects *other* users' `profiles.fb_access_token` during a leader/admin export fan-out. A token that can spend money must not be reachable by either path → separate table, RLS enabled with **zero policies** (service-role only), ciphertext at rest.
- **Deliberate inconsistency:** existing `profiles.fb_access_token` (`schema.sql:5`) and `adjust_api_token` (`schema.sql:128`) stay plaintext. Accepted because their blast radius is read-only reporting; this new token can create ad objects and spend budget. No retroactive migration (explicit non-goal) — mixing a migration into this feature would need a dual-read path in 6 existing call sites for zero incremental safety.
- **No `afs_jobs` table.** One `afs_creatives` row per Kie task (`kie_task_id`, `status`) *is* the job record. A parallel job table = two sources of truth for the same state machine.
- **`special_ad_category` is per-topic, not global.** `image_ad_prompt_generator.md:11` itself uses "Solar Panel Jobs" as an example — an EMPLOYMENT special ad category. Hardcoding `[]` would push policy-violating ads.
- **[Red Team Fix] Budget unit contract, stated once, authoritatively:** `daily_budget_minor` **always holds FB-ready minor units** (cents for USD, whole units for VND — no sub-unit) by the time it lands in this column. The dollar→minor conversion happens **exactly once**, in Phase 05's PATCH route, reusing the existing VND-aware rule at `lib/facebook/campaign-actions.ts:145`. Phase 03's `ad-creation.ts` **must not** re-derive or re-convert this value — it passes `daily_budget_minor` straight through to FB's `daily_budget` field. (Two phases previously each assumed they owned the ×100 step — this is the single source of truth.)

## Requirements
- Idempotent SQL (`create table if not exists` / `add column if not exists`), applied manually in Supabase SQL Editor (repo has no migration tool).
- `afs_launch_tokens` readable **only** via `createServiceClient()`.
- `lib/crypto/token-crypto.ts` — AES-256-GCM, key from env, AAD-bound to `user_id`.
- Private Storage bucket `afs-creatives`.

## Architecture

```
afs_launch_tokens (user_id PK)      ← zero-policy, service-role only, ciphertext
afs_batches (id PK, user_id)
  └─ afs_topics (id PK, batch_id)   ← draft state: copy, targeting, account/page/pixel, budget
       └─ afs_creatives (id PK, topic_id)  ← 5 rows/topic; doubles as the Kie job table

token_crypto:  encrypt(plain, userId) → "v1:<iv_b64>:<tag_b64>:<ct_b64>"   (AAD = userId)
               decrypt(packed, userId) → plain   (throws on tamper/wrong-user)
```

## Related Code Files
**Modify:** `supabase/schema.sql`, `lib/types.ts`, `.env.local.example`
**Create:** `lib/crypto/token-crypto.ts`

## Implementation Steps

1. Append to `supabase/schema.sql`:
```sql
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
    check (status in ('pending','submitted','succeeded','failed')),
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
```
2. Storage: Dashboard → Storage → New bucket `afs-creatives`, **Public = off**. Add no policies (service-role client bypasses them; the app never uses an anon-key storage client). Review UI gets 1h signed URLs minted server-side.
3. Create `lib/crypto/token-crypto.ts` (~50 lines):
   - `getKey()`: `Buffer.from(process.env.AFS_TOKEN_ENCRYPTION_KEY ?? '', 'base64')`; throw `Error('AFS_TOKEN_ENCRYPTION_KEY missing or not 32 bytes (base64)')` unless `length === 32`.
   - `encryptToken(plain, userId)`: `randomBytes(12)` IV → `createCipheriv('aes-256-gcm', key, iv)` → `cipher.setAAD(Buffer.from(userId))` → return `v1:${iv}:${tag}:${ct}` (base64 parts).
   - `decryptToken(packed, userId)`: split on `:`; reject if `parts[0] !== 'v1'` or `parts.length !== 4` → `Error('Unsupported token envelope')`; `setAAD(userId)`; `setAuthTag`; `decipher.final()` throws on tamper → wrap as `Error('Launch token could not be decrypted — re-enter it in Settings')`.
   - AAD binds ciphertext to its row's `user_id`: a copied ciphertext fails to decrypt under another user.
4. Append to `lib/types.ts` a `// ─── AFS Niche Testing ──` section: `AfsStyleKey`, `AfsBatch`, `AfsTopic`, `AfsCreative`, `AfsTopicStatus`, `AfsPublishResult { topic_id; status; campaign_id?; created_ads; failed_ads; error? }`, `FbPage {id,name}`, `FbPixel {id,name}`.
5. Append to `.env.local.example`:
```
# AFS Niche Testing
AFS_TOKEN_ENCRYPTION_KEY=   # base64 of 32 random bytes: openssl rand -base64 32
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna   # fallback gpt-5.4-nano if not enabled on the account
KIE_API_KEY=
KIE_MODEL=gpt-image/1.5-text-to-image   # [Validation Session 1] OpenAI's GPT-Image-1 hosted on Kie AI,
                                         # NOT google/nano-banana — user's explicit choice. Exact model id
                                         # string + input shape (quality vs resolution param) must be
                                         # confirmed against live docs.kie.ai before Phase 04 (see that
                                         # phase's Pre-Implementation note) — this value is a best-guess
                                         # placeholder from a WebSearch-only check, not a verified doc quote.
AFS_MAX_DAILY_BUDGET_MINOR=500000   # [Red Team Fix] hard server-side ceiling ($5,000/day-equiv); rejects above this regardless of UI confirm
```
**[Red Team Fix] No `AFS_PUBLIC_BASE_URL` / Kie webhook.** Per red-team review, the webhook path was cut: it duplicated the reconcile-on-poll sweep and never trusted its own payload anyway (re-fetched via `recordInfo` regardless). Generation status now completes exclusively via reconcile-on-poll (Phase 04) — simpler, no public unauthenticated route, no secret column, no extra env var. Completion latency becomes "within one 3s poll cycle" instead of near-instant; acceptable for an internal batch-review tool.
6. `npx tsc --noEmit`.

## Todo List
- [x] Append 4 tables + indexes to `supabase/schema.sql`
- [ ] Run migration in Supabase SQL editor; run **twice** to prove idempotency [BLOCKED: requires live Supabase access]
- [ ] Verify `select count(*) from pg_policies where tablename='afs_launch_tokens'` = 0 [BLOCKED: requires live Supabase access]
- [ ] Verify RLS enabled on all 4 tables (`pg_tables.rowsecurity`) [BLOCKED: requires live Supabase access]
- [ ] Create private bucket `afs-creatives` [BLOCKED: requires live Supabase access]
- [x] Create `lib/crypto/token-crypto.ts` + round-trip it in a scratch script
- [x] Add AFS types to `lib/types.ts`
- [x] Extend `.env.local.example`; generate a real key into `.env.local`
- [x] `npx tsc --noEmit` + `npm run lint` pass

## Success Criteria
- Re-running the SQL is a no-op (no error).
- `afs_launch_tokens` has 0 policies; the other 3 have exactly 1 own-row policy each.
- `encryptToken`/`decryptToken` round-trip; decrypting with a *different* userId throws; flipping one ciphertext char throws.
- Bucket `afs-creatives` exists and is not public.
- Typecheck + lint pass; no existing behavior changed.

## Risk Assessment
| Risk | L | I | Mitigation |
|------|---|---|-----------|
| Forgetting RLS on `afs_launch_tokens` → anon-key read of ciphertext | Low | High | Copy `tiktok_connection` block verbatim; assert `pg_policies` = 0 |
| `gen_random_bytes` unavailable (pgcrypto not enabled) | Med | Low | Supabase enables pgcrypto by default; if it errors, `create extension if not exists pgcrypto;` first |
| Key lost/rotated → all launch tokens undecryptable | Low | Med | `v1:` prefix reserved for future rotation; documented recovery = users re-paste (non-goal to automate) |
| **[Red Team Fix]** `AFS_TOKEN_ENCRYPTION_KEY` compromised (env leak, shared deploy access) → every user's ads-launching token decryptable at once | Low | **Critical** | Single shared key is accepted for this internal admin/leader-only tool (full envelope encryption/per-row DEK is disproportionate complexity here — YAGNI). Mitigation is procedural, not architectural: document an incident-response runbook (rotate `AFS_TOKEN_ENCRYPTION_KEY` immediately, which invalidates all rows via failed AAD/tag check, forcing every user to re-paste) and treat this key with the same access restriction as production DB credentials |
| Bucket left public by mistake | Med | Med | Explicit verification step; signed-URL path makes public access unnecessary |
| Budget minor-unit confusion (VND) | Med | High | Column named `daily_budget_minor`; conversion centralized in Phase 05's PATCH route only (Phase 01/03 both pass the value through unchanged) |

## Security Considerations
- Zero policies on `afs_launch_tokens` is intentional — the API route is the only enforcement point (matches `account_owners`, `schema.sql:165-179`).
- `AFS_TOKEN_ENCRYPTION_KEY` is server-only (no `NEXT_PUBLIC_` prefix) — never referenced from a `'use client'` file.
- **[Red Team Fix]** No Kie webhook exists (cut per red team review) — there is no public unauthenticated route in this feature at all; every route requires session + role + ownership.

## Next Steps
- Phase 02 (token API + Settings) consumes `token-crypto` + `afs_launch_tokens`.
- Phase 04 can start in parallel with 02/03 once types exist.
