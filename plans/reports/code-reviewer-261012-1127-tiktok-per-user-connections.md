# Code Review — TikTok per-user connections

Plan: `plans/261012-1101-tiktok-per-user-connections/` · Score 8/10 → fixes applied below · tsc 0 errors, eslint clean.

## Verified OK
- Token table only touched in `lib/tiktok/tiktok-connection.ts`; no token in JSON.
- All 14 `tiktok_ad_accounts` call sites scoped by `user_id` (eq / in visibleIds); upserts `onConflict advertiser_id,user_id`.
- OAuth state cookie bound `${userId}:${nonce}`, cleared before check.
- `viewAs` gated by `canViewAs`; control routes via `resolveOwnAdvertiserToken` (own + selected, own token).
- Read-only UI when viewing others; export/owners scoped + deduped.

## Findings → status
| Sev | Issue | Status |
|-----|-------|--------|
| High H1 | Re-running schema.sql resurrected disconnected token / stale advertiser rows | Fixed: `migrated_per_user_at` run-once marker on old table (added via `execute`) |
| Med M1 | Picker switch mid-fetch rendered wrong user's data | Fixed: `fetchSeq` ref drops stale responses (hub) |
| Med M2 | Export had no fallback when first owner token revoked at TikTok | Fixed: job carries all owner tokens, tries in order |
| Med M3 | `syncUserAdvertisers` ignored stored-row read error → 'USD' overwrite | Fixed: throw on select error |
| Low L1 | `getConnection` swallowed DB errors as "not connected" | Fixed |
| Low L2 | Fresh connect kept stale refresh_token | Fixed: `freshConnect` flag clears it (refresh path untouched) |
| Low L3 | Auth error copy says "Connect in Settings" when viewing others; export warnings show raw uuid | Open (cosmetic) |
| Low L4 | DB errors → empty lists in a few GETs | Open |
| Low L5 | Callback returns raw 401 when session expired | Open |
| Low L6 | `listUsers` cap 200 (existing pattern) | Open |
| Low L7 | No Reconnect button while connected (picking up new advertisers needs Disconnect) | Open (UX) |

## Unresolved questions
- Should accounting export include non-selected advertisers? (Current = yes, matches old behavior.)
