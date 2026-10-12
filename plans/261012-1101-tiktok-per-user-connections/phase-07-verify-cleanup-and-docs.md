# Phase 07 — Verify, drop old tables, docs

## Context Links
- All prior phases; `supabase/schema.sql`; `docs/journals/` (historical, do not rewrite)

## Overview
- Priority: P1. Status: pending. Effort: 1h (+ >= 2-day soak before cleanup SQL). Blocked by 3, 4, 5, 6 deployed.

## Manual test matrix (no automated suite)
Setup: users A=admin (migrated owner), L=leader with staff S1 in `team_members`, S2=staff of another leader. Gate first: `npx tsc --noEmit` and `npm run lint` clean.

| # | Area | Steps | Expected |
|---|------|-------|----------|
| 1 | Migration | A opens Settings + TikTok tab, no reconnect | A connected, same advertisers + same is_selected |
| 2 | Migration | S1, L open Settings | "Not connected", Connect button visible |
| 3 | Long-term token | A fetch campaigns | 200, no refresh attempt (no `auth_code` / refresh error) |
| 4 | OAuth | S1 connects | Rows only under S1 user_id; `?tiktok=connected` |
| 5 | OAuth CSRF | Start as S1, switch session to L, finish callback | `reason=state` error, no rows written |
| 6 | Shared advertiser | S1 authorizes an advertiser A also has | Two rows (adv,A) and (adv,S1); A's selection untouched |
| 7 | Toggle | S1 unticks advertiser | Only (adv,S1).is_selected changes |
| 8 | Disconnect | S1 disconnects | S1 token + rows gone; A still works for shared adv |
| 9 | Picker staff | S1 opens TikTok tab | No picker; own advertisers only |
| 10 | Picker leader | L opens tab | Picker lists S1 (connected) only; not S2 |
| 11 | viewAs | L views S1, toggles ad-group view | S1 campaigns + ad groups; no action bar / budget button |
| 12 | Picker admin | A opens tab | Picker lists all connected users |
| 13 | viewAs abuse | L calls `/api/tiktok/campaigns?viewAs=<S2>` | 403 |
| 14 | Control own | S1 pause/enable/budget own campaign | 200, change visible in TikTok |
| 15 | Control foreign | S1 PATCH with advertiser_id only A connected | 403 "only control TikTok accounts you connected" |
| 16 | Control id-swap | S1 PATCH own advertiser_id + campaign of another advertiser | 403 ownership |
| 17 | Export leader | L exports TikTok | Only advertisers of L+S1; shared adv once |
| 18 | Export admin | A exports | All users' advertisers, each once; revoked token -> warning, others present |
| 19 | Account owners | L lists + edits TikTok label | Only visible advertisers; edit S2-only advertiser -> 403 |
| 20 | Token leak | Inspect JSON of `/api/tiktok/accounts`, dashboard RSC payload | No `access_token`/`refresh_token` anywhere |
| 21 | RLS | Supabase anon/user JWT `select * from tiktok_connections` | 0 rows / denied |

## Cleanup SQL (run after soak; then replace old blocks in schema.sql)
```sql
-- TikTok per-user cutover complete (plan 261012-1101): drop org-wide tables. Idempotent.
drop table if exists public.tiktok_advertiser_accounts;
drop table if exists public.tiktok_connection;
```
Note: `tiktok_connection` carries the `migrated_per_user_at` run-once marker (added in Phase 1, review H1); it is dropped with the table. The Phase 1 DO-block then self-skips (`to_regclass` is null).
In `schema.sql`: delete the old `tiktok_connection` / `tiktok_advertiser_accounts` create blocks, keep the Phase 1 block (its DO-block self-skips when old tables are absent), append the drop statements with comment, and fix the `account_owners` comment ("mirrors tiktok_advertiser_accounts" -> "service-role-only").

## Reverse SQL (only if rolling back AFTER cleanup; set the admin uuid)
```sql
create table if not exists public.tiktok_connection (
  id boolean primary key default true check (id), access_token text, refresh_token text,
  token_expires_at timestamptz, connected_by uuid references auth.users(id),
  connected_at timestamptz, updated_at timestamptz default now(), migrated_per_user_at timestamptz);
alter table public.tiktok_connection enable row level security;
create table if not exists public.tiktok_advertiser_accounts (
  advertiser_id text primary key, name text not null,
  currency text not null default 'USD', is_selected boolean not null default true);
alter table public.tiktok_advertiser_accounts enable row level security;
insert into public.tiktok_connection (id, access_token, refresh_token, token_expires_at, connected_by, connected_at, updated_at)
select true, access_token, refresh_token, token_expires_at, user_id, connected_at, updated_at
  from public.tiktok_connections where user_id = '<ADMIN_UUID>'
on conflict (id) do nothing;
-- Mark as migrated so a later re-run of the Phase 1 block cannot re-copy a stale token (review H1).
update public.tiktok_connection set migrated_per_user_at = now() where id;
insert into public.tiktok_advertiser_accounts (advertiser_id, name, currency, is_selected)
select advertiser_id, name, currency, is_selected from public.tiktok_ad_accounts where user_id = '<ADMIN_UUID>'
on conflict (advertiser_id) do nothing;
```
Then redeploy the pre-plan commit.

## Docs
- No living docs in `docs/` describe the TikTok connection (only `page-scheduler-setup.md` + journals). Journals are historical — do NOT edit.
- Add journal `docs/journals/2026MMDD-tiktok-per-user-connections.md` (via journal-writer) stating: org-wide model retired, why admin-only gates were removed, control = own token parity with FB.
- Update in-code header comments already covered in Phases 2-6; `app/tools/page.tsx` description unchanged (export still admin/leader).
- Mark prior plan note: add one line to `plans/260718-1343-tiktok-ads-tab-foundation/plan.md` "Auth model superseded by 261012-1101".

## Related Code Files
- Modify: `supabase/schema.sql` (cleanup), `plans/260718-1343-tiktok-ads-tab-foundation/plan.md` (one line)
- Create: journal entry
- Delete: none (tables dropped via SQL)

## Todo List
- [ ] tsc + lint clean
- [ ] Tests 1-21 pass
- [ ] Soak >= 2 days, no TikTok errors in Vercel logs
- [ ] Cleanup SQL run; schema.sql updated
- [ ] Journal + prior-plan pointer

## Success Criteria
All 21 tests pass; `grep -rn "tiktok_connection'\|tiktok_advertiser_accounts" app lib` empty; old tables dropped.

## Risk Assessment
| Risk | L x I | Mitigation |
|------|-------|-----------|
| Cleanup run before verification | L x H | Soak gate; reverse SQL ready |
| Data created post-cutover lost on rollback | M x L | Users reconnect; acceptable |

## Security Considerations
Tests 13, 15, 16, 19, 20, 21 are the security gates — any failure blocks release.

## Next Steps
Optional follow-ups (not in scope): encrypt TikTok tokens at rest like `ps_fb_profiles.token_enc`; FB export dedupe for shared accounts.
