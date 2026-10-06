# Automatic-only Quest pass — 2.0.4

User request: retain Daily Set and Keep earning, remove manual tasks, and allow
Auto All to finish the Quest pass then Search even with stale/missing offers.

## RED

`node --test tests/quest-api.test.cjs tests/quest-ui.test.cjs tests/manual-handoff.test.cjs`
failed for the intended bugs: stale pending aliases survived completion filtering;
completed DOM evidence did not prevent a stale duplicate click; unavailable/missing
offers created manual tabs/counts; three missing offers suppressed Search.
`node --test tests/popup.test.cjs` also failed the new skipped-only notice behavior.
Additional RED checked completed stable IDs with no destination and removal of
skipped activities from the task total.

## GREEN

The same paths now pass. `npm test`: 143/143 tests pass. Tests retain protections
for two affirmative credit observations, no replay of completed cards, distinct
offer identities, expired permits, Stop/new-run races, Pause/Resume, tab closure,
network failures, rate limits and worker restart. Legacy persisted manual state
is discarded; skipped counts survive popup/worker reload without asserting credit.

Edge fixture: PASS, including three stale pending API cards with matching
completed DOM, zero card clicks/manual destinations, and one subsequent Search.
Existing Pause/Resume, Stop/new-run races and actual extension reload pass.
Six native popup scenarios pass at 420px; an initially failing footer-height
check was fixed by hiding the redundant finished summary beside the skipped
notice. Popup JavaScript errors: zero. Intercepted fixture-page errors: 16,
all the known `_G is not defined` message, recorded separately.
`npm run check`, `git diff --check` and packaging pass. The 12-file ZIP passed
independent CRC and byte equality checks, then loaded unpacked in installed Edge:
MV3 worker, both imported modules, word data and popup pass (2.0.4, zero popup errors).
ZIP SHA-256: `6fd654a885c4d28aba29d9d03bb4757c6f460b8cdb7a62a58a24a7ae368cf736`.
There is no TypeScript or configured lint/build tool; syntax and package checks
are the applicable gates. Security/diff review found no new permissions,
claim/report requests, sensitive log values or changed sender/permit checks.
Fixtures do not prove current account data
or actual credit. VM-based tests do not provide meaningful production coverage percentages.
No Git checkpoint was created: `.git` is read-only here and publication remains
under the user's control. Earlier uncommitted changes were preserved.
