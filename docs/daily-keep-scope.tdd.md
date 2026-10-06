# Daily Set + Keep earning scope — 2.0.3, 2026-10-06

The user's clarified request keeps Daily Set and Keep earning and excludes
multi-step Quests on Earn so these goals do not block Auto All. Supplied HTML
shows “Complete the Daily Set for 7 days in a row” with `In progress`, identifying
an ongoing goal to ignore. It does not contain the signed-in API attributes.

## Evidence

- `node --test tests/quest-scope.test.cjs`: initial scope tests failed for
  unintended multi-step tasks, nested children and fallback records. The later
  ongoing-goal and rendered-alias regressions each failed before their fixes.
- The same target now passes all seven regressions. Daily Set quiz metadata stays
  eligible, as do single-card Keep earning quizzes and titles containing the
  word “quest”. The filter uses structured fields rather than title text.
- Both parsers remove excluded groups before automatic/manual partitioning.
  Nested groups are pruned; stable identities prevent their steps reappearing
  through another source. A genuine Daily Set card referenced by a goal remains
  eligible as an independent daily task; contradictory raw credit evidence is
  still checked before confirming completion. No permanent blacklist is stored.
- `node scripts/edge-smoke.cjs` loads the actual MV3 worker and popup in installed
  Edge. A synthetic scope fixture confirms one Daily Set and one Keep earning
  card, then performs one Search and finishes. Excluded weekly campaigns,
  seven-day ongoing goals and nested aliases have zero activations, destination
  tabs and manual task count. Existing lifecycle/reload tests also pass.
- Syntax/asset/manifest checks remain configured through `npm run check`.
- Full `npm test`: 139/139 pass, zero failures/skips/cancellations.

## Limits and manual comparison

The recognized markers are typed Quest/punch-card/search-streak records,
non-daily `activityProgressMax > 1`, and non-daily `inProgress`. Raw, transformed
and fallback formats are tested. Daily Set dates and context preserve ordinary
daily quizzes; unknown future metadata cannot be classified from title wording.

The user's supplied goal was not matched against an authenticated API response.
If it remains in a real run, compare its sanitized type/progress fields and
stable identity with the supported mappings; do not send account tokens or full
payloads. The dashboard route requires sign-in and is not accessible to the
public read tool. Synthetic fixtures do not prove live account credit.

Auto All still distinguishes excluded goals from eligible cards that fail to
load or receive confirmation. Eligible unconfirmed cards remain unconfirmed;
network/sign-in errors are not converted into successful completion.
The existing `vm` test harness does not produce usable production source coverage.
RED/GREEN proof is retained here; no commit/push was made for this change.
