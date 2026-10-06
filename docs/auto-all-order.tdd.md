# Run all Quest-first evidence — 2.0.2, 2026-10-05

Scope comes directly from the user's request: complete Quests before Search so
the two phases do not conflict. No external plan file was used.

## Reproduction and fix

`START_ALL` already awaited `doQuests`, but ignored its handoff result and always
called `doDesktopSearches`. A resolved Quest pass can still have unconfirmed or
manual offers. The Search function also creates its initial tab before its own
pause check, so the transition requires a Pause/Stop gate in the orchestrator.

RED command: `node --test tests/lifecycle.test.cjs tests/popup.test.cjs`.
Result before production edits: 36 tests, 32 passed, 4 failed. The failures were
early Search after handoff, manual-only pending progress, paused phase transition,
and the missing localized explanation. Other sequencing/error tests passed.

Minimal fix: require no handoff, zero manual count and confirmed progress before
Search; otherwise retain Quest progress and finish at `needs_action`. Check
Pause/Stop before the Search call. Preserve the exact safe handoff status on
worker hydration and show its localized message in the existing popup notice.
Permissions, API calls and activation/credit logic are unchanged.

GREEN: the same command passes 36/36. `npm run test:coverage` runs the whole suite
and passes 132/132, with no failed, skipped or cancelled tests.

| User-visible guarantee | Evidence | Result |
| --- | --- | --- |
| Search waits for Quest confirmation | Lifecycle ordering test; real Edge first Search follows two credit responses | PASS |
| Pending/manual Quest keeps Quest progress and blocks Search | Lifecycle handoff/manual-only/partial-progress tests; Edge zero Search navigations | PASS |
| No eligible Quest permits Search | Lifecycle no-offer test | PASS |
| Pause at transition blocks Search until Resume | Lifecycle boundary test; Edge hold/Pause/Resume flow | PASS |
| Stop or Quest error never starts Search | Lifecycle tests; Edge Stop during Auto All | PASS |
| Handoff notice explains the next step after popup/worker restart | Lifecycle hydration, bilingual popup test and Edge popup reload | PASS |
| Popup remains readable and 420px wide | Native layout script, including Vietnamese Auto All handoff | PASS |

## Verification and limits

- `npm run check`: syntax, manifest, version and runtime allowlist PASS.
- `node scripts/edge-smoke.cjs`: installed Edge, fresh profile, actual unpacked
  MV3 worker/popup, synthetic Rewards data PASS. Popup JavaScript errors: zero.
  Thirteen intercepted web-page errors have the known `_G is not defined`
  message; this is not a clean live-webpage console claim.
- `node scripts/popup-layout.cjs`: six native popup scenarios PASS, no horizontal
  overflow, all tested enabled text contrast at least 4.5:1.
- TypeScript/lint/bundler checks are not configured in this plain JavaScript repo.
- The Node coverage command prints 100% with an empty source-file table because
  the harness executes production code through `vm`. That output does not measure
  production coverage; an 80% coverage claim is not established. Behavioral
  evidence is the tests and real extension fixture described above.
- Signed-in Rewards credit and natural idle worker suspension remain manual
  checks. Handoff does not monitor later manual completion: finish remaining
  offers and click Run all again to rescan before Search.

RED/GREEN evidence is preserved here. No checkpoint commits or push were made
for this change; publication remains under the user's control.
