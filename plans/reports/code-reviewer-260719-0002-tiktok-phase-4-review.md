# Code Review: TikTok Phase 4 — Control Parity (Budget Edit + On/Off Toggle)

Scope: all new/modified files per task. Read full phase spec, mirror sources, prior tester report
(`plans/reports/tester-260719-0001-tiktok-phase-4-verification.md`). `tsc --noEmit` clean, `eslint`
clean on all touched files. All files <200 lines (largest new file: adgroup-flat-view.tsx @ 187).

## Confirmed correct (independent re-verification, not just trusting tester report)

- **Check order** in both PATCH routes: auth(401) -> role(403) -> body parse(400) -> advertiser_id
  presence(400) -> advertiser selected in DB(403) -> token fetch -> ownership(403) -> action. Role
  gate fires before any TikTok API call or DB write, matches spec requirement #1 exactly.
- **Ownership check fail-closed**: `.catch(() => false)` in both routes; `verifyCampaignOwnership`/
  `verifyAdGroupOwnership` return `false` on any fetch error, network error, or non-match — 403.
- **Ownership check correctness is robust even if `filtering` param is a no-op.** Traced the logic:
  the function fetches under `advertiser_id` (with an optional `filtering` narrowing) and then does
  `raws.some(r => r.campaign_id === campaignId)`. Even in the worst case where TikTok ignores/rejects
  the `filtering` query shape, the fallback (full unfiltered list for that advertiser) still yields a
  *correct* ownership determination via the `.some()` scan — filtering is a perf optimization, not a
  correctness dependency. This de-risks review focus area #2 substantially. (`campaign_ids`/
  `adgroup_ids` filter key names are also independently confirmed plausible against TikTok's real
  `/campaign/status/update/` and `/adgroup/status/update/` batch bodies documented in this project's
  own research report — not directly documented for the GET+filtering combo, so still worth the
  live-verification the phase's own Risk table already flags post-Portal-whitelist.)
- **Budget amount validation**: `Number.isFinite(amount) && amount > 0` correctly rejects strings,
  null, NaN, Infinity (no unsafe coercion — `Number.isFinite` does not coerce, unlike global
  `isFinite`).
- **No secret/token leakage**: `errorResponse` only ever wraps `err.message` (TikTok's own envelope
  `message` field, a validation string) or static app strings. No stack traces, no token strings, no
  raw TikTok response bodies surfaced.
- **Currency invariant closes a VND-vs-USD-minimum gap I initially suspected**: `budget-limits.ts`
  minimums are hardcoded USD ($50/$20). I checked whether a non-USD (e.g. VND) TikTok advertiser
  account could make this check meaningless (comparing raw VND units against a dollar threshold).
  `app/api/tiktok/accounts/route.ts:93` already hard-blocks `is_selected=true` for any account with
  `currency !== 'USD'`, and both PATCH routes' advertiser check requires `is_selected=true` — so a
  non-USD advertiser can never reach the control routes. Not a bug; confirmed existing invariant.
- **Ad-group scoping / campaign-name-join staleness fix — independently confirmed correct**, not
  just "present." `tiktok-results-panel.tsx`: `campaignNameById` keys off `allCampaigns` (unfiltered,
  `useMemo([allCampaigns])`), `displayedCampaignIds` off `displayedCampaigns` (post-filter,
  `useMemo([displayedCampaigns])`), `displayedAdgroups` recomputed from both plus `rawAdgroups`
  (`useMemo` with all three as deps). No `useCallback`-memoized closures anywhere in the chain that
  could pin a stale `adjustRows`/`allCampaigns` snapshot — `loadAdgroups` is a plain function
  re-created every render, so it always closes over the current render's `adjustRows` prop. Toggling
  filters after ad-groups are loaded correctly re-derives both the visible set and the campaign-name
  join on every relevant state change. I traced this by hand rather than accepting the prior
  "verified" comment at face value; it holds up.
- Bulk reconciliation (`tiktok-action-bar.tsx handleBulkStatus`) correctly refetches regardless of
  partial failure and reports exact failed names, not a generic toast — matches spec requirement #4.
- `budget-modal.tsx` confirmed byte-for-byte unchanged (`git diff` empty, no commits touching it in
  this session's range).
- No XSS sinks (`dangerouslySetInnerHTML`/`innerHTML`) in any new component; all TikTok-sourced names
  render via JSX text interpolation (auto-escaped).

## High Priority

### H1 — Bulk actions amplify into an unbounded, unchunked fan-out against a shared single-org credential
Every PATCH call site (`updateCampaignStatus`/`updateAdGroupStatus`) is invoked with a **single-element
array** — `[campaignId]` / `[adgroupId]` — never a real batch. Grep confirms no call site ever passes
more than one ID. That means:
- The 100-ID chunking built in Phase 1 (`campaign-actions.ts`) is **dead code** for every path
  reachable from this UI. The spec's Success Criteria line "Bulk status on >100 selected items splits
  into ≤100-ID batches" is technically true only because each individual TikTok call always carries
  exactly 1 ID (trivially under the cap) — not because chunking logic ever executes.
- Bulk UI actions are implemented as `Promise.all` over N independent `fetch()` calls
  (`tiktok-action-bar.tsx handleBulkStatus`), each of which is its own Next.js request that does: role
  check, advertiser check, **one full ownership-verification TikTok API call** (potentially
  multi-page if `filtering` doesn't narrow server-side — see confirmed-correct section above), plus
  one mutation TikTok API call. For N selected items that's up to **2N+ TikTok API calls** fired
  near-simultaneously, where a batched design would need ~`ceil(N/100)` calls.
- Unlike FB (per-user token, blast radius = one user's own rate limit), TikTok uses **one shared
  org-wide credential** (this phase's own stated rationale for the stricter role gate). A single
  leader selecting "all" in a large filtered view and clicking Pause/Turn On can burn through the
  org's shared TikTok rate-limit bucket, degrading or blocking every other user's TikTok actions and
  the read-only dashboard's fetches at the same time. This is a direct, non-obvious extension of the
  phase's own "shared credential = larger blast radius" theme — just applied to rate limits instead of
  auth.
- Not a data-integrity or auth bug, and not blocking for typical small selections, but should be
  tracked as a near-term follow-up: either (a) add a real batch PATCH endpoint that accepts
  `ids: string[]`, does one ownership-check pass (fetch the advertiser's full list once, check
  membership of all N ids locally) and one chunked status/update call, or (b) at minimum cap
  client-side concurrency (e.g. `p-limit`-style batching of 5-10 at a time) to reduce burst pressure,
  same as `campaigns/route.ts`'s own `CONCURRENCY=3` pattern already used for reads.

## Medium Priority

### M1 — Client-supplied `budget_mode` is trusted for local minimum-check branching, wider gap than DAILY-vs-LIFETIME
Reviewed per the task's specific ask (point 3). Confirmed: `ActionBody`'s `budget_mode` type is
`'DAILY' | 'LIFETIME' | string` and the route's check is `if (budget_mode === 'DAILY' && amount < MIN)`.
This means the local $50/$20 minimum is skipped for **any** value other than the exact literal string
`'DAILY'` — not just a spoofed `'LIFETIME'`, but any typo, `undefined`, or omitted field silently
skips the check too. However, traced the actual exploit surface and conclude **this is not currently
exploitable as a security bypass**, only a correctness/UX gap:
- `updateCampaignBudget`/`updateAdGroupBudget` never send `budget_mode` to TikTok — only
  `{advertiser_id, campaign_id/adgroup_id, budget}`. TikTok's backend determines the real,
  immutable, already-stored `budget_mode` for that campaign server-side and validates against it
  independent of anything in our request body. So even if a caller lies about `budget_mode` to skip
  our local pre-check, TikTok's own authoritative validation still applies to the real stored mode —
  worst case the caller gets a TikTok 502 error instead of our friendlier 400.
- The exploit would additionally require an already-`admin`/`leader`-role actor deliberately crafting
  a raw request outside the UI (the UI itself only ever sends the row's real last-fetched
  `budget_mode`, never a user-editable value) — i.e., a trusted role choosing to bypass their own
  friendly validation, gaining nothing since the backstop is server-side at TikTok, not client-side.
- Recommend (low effort, not urgent): widen `verifyCampaignOwnership`/`verifyAdGroupOwnership`'s
  return type from `{campaign_id: string}` to include `budget_mode` (the field already exists at
  runtime in TikTok's response, just untyped) and use *that* real, freshly-fetched value for the
  minimum-check branch instead of trusting the request body. Removes reliance on client honesty and
  fixes both the spoofing angle and the "any non-'DAILY' string silently skips" fail-open default,
  as pure defense-in-depth — not because it's exploitable today.

### M2 — Missing ID format validation on route params
FB's `adsets/[adsetId]/route.ts` validates `/^\d+$/.test(adsetId)` before use; neither new TikTok route
validates `campaignId`/`adgroupId` shape before passing it into the ownership-check fetch. Low actual
risk (ownership check will simply fail to find a match for a garbage ID and 403 fail-closed, and IDs
only ever flow into an outbound fetch to TikTok's API, never a raw SQL/shell sink), but worth adding
for consistency with the FB mirror and to fail faster/cheaper (skip the outbound API round-trip
entirely for obviously-malformed input).

## Low Priority

- **Selection is wiped on any refetch, even a partial-failure bulk action.** `handleFetchData` (hub)
  unconditionally does `setSelectedIds(new Set())` on every successful campaign refetch; since
  `handleBulkStatus` calls `onActionComplete()` (→ `handleFetchData`) even on partial failure, the
  user's selection of "which ones failed" is cleared right after the error message renders — the
  failed items are still named in the error text, just no longer selected for a one-click retry. Minor
  UX friction, matches the spec's literal requirement (explicit named failure message), not a
  correctness bug.
- `tiktok-action-bar.tsx`'s `<BudgetModal onConfirm={(amount) => handleBudgetConfirm(amount)} .../>`
  drops the `currency` second argument `BudgetModal` passes back. Harmless here — the PATCH body
  doesn't use currency at all (TikTok budget update is currency-implicit from the advertiser account) —
  but slightly inconsistent with `adset-flat-view.tsx`'s `handleBudgetConfirm(amount, currency)` mirror
  signature. No functional impact given M1's USD-only invariant.
- `lib/types.ts` is 285 lines, already over the 200-line guideline before this phase (only +6 lines
  added here for `FlatTiktokAdGroup`). Pre-existing debt, not introduced by Phase 4; flagging for
  awareness only.

## Not flagging (per task instruction)

LIFETIME-mode skipping the flat DAILY minimum — explicit, documented Plan-1 decision, correctly
implemented and correctly branches on the (server-fetched-in-the-UI, if not server-verified-in-the-
route per M1) `budget_mode`.

## Unresolved Questions

1. Whether TikTok's `/campaign/get/` and `/adgroup/get/` GET endpoints actually honor a `filtering`
   query param shaped `{campaign_ids:[...]}` / `{adgroup_ids:[...]}` the way `campaign-actions.ts`'s
   POST batch endpoints do — this project's own research report only documents `filtering` shapes for
   the POST batch-update endpoints, not the GET list endpoints used by the new ownership-check
   functions. Per the analysis above this doesn't threaten *correctness* (fallback to full list still
   works), only *efficiency* (H1). Confirm empirically once Portal whitelist unblocks live testing —
   this is already flagged as a manual-test prerequisite in the phase's own Risk Assessment, not a new
   gap.
2. Real-world selection sizes in practice — if leaders never select more than ~20-30 rows at once, H1
   is a latent risk rather than an active one; worth a product/usage-pattern sanity check before
   deciding H1's priority for a follow-up phase.

---

**Status:** DONE
**Summary:** Both PATCH routes correctly role-gate before any mutation, fail closed on ownership-check
errors, and don't leak secrets; ad-group scoping/staleness fix independently re-verified correct, not
just present. One High-priority production-readiness finding not caught by the prior tester pass:
bulk actions fan out into 2N+ uncapped TikTok API calls (ownership-check + mutation, per item) against
a single shared org-wide credential, with Phase 1's 100-ID chunking effectively dead code since every
call site passes a 1-element array. The client-trust `budget_mode` gap named in the task is real but
not exploitable today — TikTok's own API is authoritative and never receives our body's `budget_mode`.
**Concerns/Blockers:** H1 (bulk fan-out / shared-credential rate-limit exposure) should be tracked as a
near-term follow-up before this ships to a team that routinely does large bulk pauses; not a hard
blocker for a first release with typical small selections.

**Verdict: Approve with fixes** — no security bypass found (the two things that looked like one on
first read, M1 and the ownership `filtering` assumption, both traced through to a fail-closed or
authoritative-backstop outcome). Ship-blocking only if bulk selections are expected to be large;
otherwise land now and open a fast-follow for H1 + the M1 defense-in-depth improvement.

**Score: 8/10**
