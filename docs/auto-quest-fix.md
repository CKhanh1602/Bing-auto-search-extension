# Auto Quest repair evidence

## Repository and expected behavior

The initial working directory contained only an empty Git repository. Source
was fetched from CKhanh1602/Bing-auto-search-extension at
`e639cf6cc9fa9189fac9cd37810c48b4192817b5`; work is on `codex/fix-auto-quest`.
There were no tests, package scripts, build/lint/type configuration or AGENTS.md.

This is a plain JavaScript MV3 extension: background.js is the worker and injects
page functions via chrome.scripting; there is no separate content script.
popup.html/popup.js provide controls and settings in chrome.storage.local.
data/words.json supports the separate search engine. No alarms are registered.
README and popup define Quest as daily activities / Keep Earning. The old code
explicitly excludes multi-step Quests, app installation, streaks and search tasks;
that exclusion is retained. Visiting a card cannot prove points were credited.

## Reproduced causes

- `e639cf6` selects index i from a newly filtered pending-card list after every
  click. When A completes, [A,B,C] becomes [B,C]; index 1 skips B. Scan and click
  additionally used different selectors, omitting class-based cards on lookup.
- Cleanup compares all browser tabs before/after and closes every new tab,
  including independently opened user tabs.
- Empty scan, injection error and tab-loading timeout were swallowed, allowing
  the orchestrator to report Completed despite not processing a task.
- State lived only in worker globals. Restart lost running/paused status;
  commands returned true without responding, leaving message channels unresolved.

Four quest regression tests failed on the original source (checkpoint 6a9a615).
Lifecycle tests independently reproduced six failures before repair (test
checkpoint d3be0ed records RED/GREEN evidence). This is code/mock evidence,
not proof of a recent change to authenticated Bing DOM.

## Chosen implementation

One scanner is reused for discovery and activation. It resolves exact URLs
again after DOM changes and processes each once per run across Dashboard/Earn.
Discovery requires known section IDs or bounded containers with recognized
English/Vietnamese headings. It fails closed rather than expanding to all links.
Ordinary DOM click replaces coordinate CDP input; debugger permission is removed.
HTTPS URLs are restricted to the existing Bing/Rewards hosts. Destination tabs
remain open for interactive tasks; only the source tab created by the run is
closed in finally. Progress counts processed cards, including disappeared cards,
and does not claim reward completion.

Missing sections get three bounded scans, with cancellable waits. Loading waits
reject on timeout/closure and Stop releases pause/load waits. Same-tab destinations
are allowed to finish loading before returning to the source. Already dispatched
DOM activation cannot be recalled by Stop. Popup commands are acknowledged and
errors surfaced. Only this extension's popup may issue engine commands.

Progress snapshots persist locally without card URLs, titles, cookies or account
data. Restart turns an active run into an explicit stopped/interrupted state.
It deliberately does not replay actions whose remote completion is unknown.
No keepalive or periodic alarm is needed for that recovery policy.

## Verification

- `npm test`: 20 tests pass, including shrinking lists, tab ownership, missing
  selectors, injection failures, source cleanup, signed-out pages, URL validation,
  stop, pause/resume, timeout, tab closure, restart and START_ALL cancellation.
- `npm run check`: background/popup syntax and MV3 packaged-file checks pass.
- `git diff --check`: passes.
- `npm run test:coverage`: tests pass, but Node's report for these VM-executed
  scripts is empty. The displayed aggregate 100% is not application coverage;
  the ECC 80% coverage target has not been established.
- Build, TypeScript and ESLint: not configured; the extension loads source files.
- Security/diff review: no added permissions, trusted-input simulation, secrets,
  CAPTCHA handling or anti-detection features. Debugger permission removed.
  Existing unrelated search behavior was not expanded or redesigned.

## Remaining browser validation

See [Edge QA](edge-qa.md). Only a signed-out Codex browser was available; Rewards
redirected to /about. Actual Load unpacked, authenticated DOM, credited points,
real worker suspension and popup delivery remain unverified in Edge/Chrome.
The manifest check is not a substitute for browser loading. DOM fixtures are
synthetic, not a captured authenticated dashboard.

Restart can leave the source tab open because ownership is not persisted across
browser lifetimes; recovery avoids closing a potentially reused user tab.
URL deduplication may group distinct cards sharing an identical URL. Localized
headings outside the supported labels, lazy sections not yet rendered, interactive
quizzes, trusted-input-only handlers and changed site markup may require manual
work or a new selector adapter. No bypass is attempted.
