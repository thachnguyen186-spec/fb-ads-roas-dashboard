# Code Review: Adjust "today" timezone fix (`lib/adjust/api-client.ts`)

Scope: uncommitted diff to `lib/adjust/api-client.ts` only (single file, revenue-affecting).

**Process note:** the Bash tool failed environment-wide this session (`unexpected EOF while looking for
matching \`"'` on every invocation, including trivial ones like `pwd`/`ls`/`whoami` — looks like a broken
shell profile/init script, not something triggered by a specific command). Could not run `git diff`, `tsc
--noEmit`, or a live `node -e` check of `Intl.DateTimeFormat` output. Reviewed via `Read`/`Grep` against the
current working-tree file plus `WebSearch`/`WebFetch` against Adjust's own docs to verify the two claims that
mattered most (offset format, DST). Recommend running `tsc --noEmit` once the shell is usable again — the
change itself is type-safe on inspection (interface field removed is unexported and unread elsewhere), so this
is a formality, not a real risk flag.

## Verdict
No blocking issues. The core fix is correct. One minor, non-blocking comment-accuracy nit (below).

## Point-by-point

**1. `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' })` → `YYYY-MM-DD`?**
Correct. `en-CA` is the standard trick for ISO-shaped output (`yyyy-MM-dd`) in modern ICU/V8 — old ICU builds
had a bug where `en-CA` used `/` separators, but that was fixed years ago and this repo is on Next 16 /
`@types/node ^20`, well past any affected runtime. Confirmed against Adjust's own docs: `date_period` absolute
format is documented as `YYYY-MM-DD:YYYY-MM-DD`, matching exactly what `${today}:${today}` produces.
[Adjust CSV report endpoint docs](https://dev.adjust.com/en/api/rs-api/csv/)

**2. Does the date string and `utc_offset` agree?**
Yes. Both are pinned to the same civil timezone: `today` is computed with `timeZone: 'Asia/Bangkok'`, and
`ADJUST_UTC_OFFSET = '+07:00'` is Bangkok's fixed offset. Adjust's docs confirm `utc_offset` format is
`[±]HH:MM` (example given: `utc_offset=+01:00`), so `+07:00` is a well-formed value.
[Adjust docs example](https://dev.adjust.com/en/api/rs-api/csv/) — no mismatch risk.

**3. Does Asia/Bangkok observe DST?**
No — Thailand has used a fixed UTC+7 (Indochina Time) year-round since 1920, never DST. Hardcoding
`'+07:00'` as a literal alongside the `Asia/Bangkok` IANA zone is safe permanently, not just "safe today."
No future drift risk between the two values.

**4. Any other code reading `AdjustApiRow.network_cost` or relying on `ad_spend_mode`?**
Confirmed clean via grep across the whole repo:
- `network_cost` and `ad_spend_mode` only appear in stale planning docs (`plans/reports/researcher-260415-*`,
  `plans/260415-1811-*`) — never in live `.ts`/`.tsx` code.
- `AdjustApiRow` is not exported from `api-client.ts`; its only consumer is the `Papa.parse<AdjustApiRow>`
  call in the same file, and the row-mapping loop (lines ~139–157) never referenced `network_cost`.
- `lib/adjust/merge.ts` confirms `spend` is unconditionally `campaign.spend` from Facebook Insights
  (`mergeCampaigns`/`mergeAdSets`), never from any Adjust field — so the removed metric was genuinely dead
  weight, not a behavior change for any consumer.
- `lib/adjust/csv-parser.ts` (the CSV-upload fallback path) never referenced `network_cost` either — the two
  ingestion paths were already inconsistent on this before the diff; the diff doesn't introduce a new
  inconsistency, it just deletes unused code from one of them.

**5. JSDoc/comment accuracy**
Mostly accurate and actually improved (the new inline comment at line 97–98 correctly explains why the date
label and `ADJUST_UTC_OFFSET` must agree). One nit:
```ts
// Revenue only — spend is always sourced from Facebook's own Insights API (lib/adjust/merge.ts),
// never from Adjust, since Adjust's cost reporting lags behind Facebook's.
```
The clause "since Adjust's cost reporting lags behind Facebook's" is presented as an established fact but
isn't backed by anything in this diff, the task's stated rationale, or the codebase/docs (grepped `docs/` for
"lag"/"cost report" — no prior mention). The actual, verified reason `network_cost` was dropped is simply that
it was fetched-but-never-read (confirmed via `merge.ts`), not a documented data-quality/latency issue with
Adjust's cost reporting. As written, a future reader might treat "cost reporting lags" as a known, cited fact
rather than incidental color. Low priority — suggest trimming to just the verified claim:
```ts
// Revenue only — spend is always sourced from Facebook's own Insights API (lib/adjust/merge.ts), never
// from Adjust; the previously-requested network_cost metric was never read into AdjustRow.
```

**6. General correctness**
- `ADJUST_UTC_OFFSET` and `Asia/Bangkok` are two independent literals that must stay in sync; low risk today
  (single fixed-offset zone, no DST — see point 3) but worth a one-line comment if this tool ever needs a
  second timezone. Not worth abstracting now (YAGNI) for a single-tenant tool.
- Removing `ad_spend_mode: 'network'` is correct and consistent — that param only affects which cost source
  Adjust uses for cost metrics, and no cost metric is requested anymore.
- CSV column removal is safe: `Papa.parse` uses `header: true` (maps by column name, not position), so
  dropping `network_cost` from the requested `metrics` and the interface can't cause a column-shift bug.
- No other behavior in the file changed; error handling, auth header, timeout, and the Facebook-partner /
  campaign-ID filtering logic are all untouched.

## Unresolved questions
None blocking. Recommend a follow-up `tsc --noEmit` + `eslint` pass once the Bash/shell environment is
working again, purely as a formality given the change is a straightforward field/param removal plus a
timezone computation swap.
