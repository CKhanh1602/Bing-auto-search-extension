# Auto Quest repair evidence

Current release: **2.1.0**, scanner `auto-only-v19`. The 2.0.2–2.0.4 sections
below describe intermediate changes included in this release. See
[release notes](../CHANGELOG.md).

## Automatic-only pass 2.0.4 — 2026-10-06

Current scanner: `auto-only-v19`. Manual handoff is removed. Unavailable,
missing and unconfirmed cards are skipped, removed from the task total, and
reported separately; their destinations are not opened as manual tasks.
Auto All awaits the entire automatic Quest pass then starts Search, including
when activities were skipped. Pause, Stop and terminal failures still stop
advancement. Old persisted `needs_action` state and manual counts are retired
on reload. The popup says the run finished, without claiming skipped credit.

The reported v18 trace proves an API/UI disagreement (three API-eligible cards,
zero pending UI cards) followed by manual promotion and Search suppression. It
does not identify those account records. Regressions reproduce completed/pending
API aliases and stale pending API records whose matching DOM cards are completed.
Planning now suppresses identities with completion in either current source,
including completed IDs that have lost their URL. The DOM probe suppresses
completed matches before activation. Credit verification still refuses
contradictory pending evidence; skip is never a fabricated completion.

See [RED/GREEN evidence](auto-only-pass.tdd.md). Sections below retain historical
behavior and evidence; v18's manual handoff and Search gate are superseded.

## Daily Set + Keep earning scope 2.0.3 — 2026-10-06

The user clarified the scope: keep Daily Set and Keep earning, exclude the
multi-step Quests section on Earn. Their supplied HTML also identifies a
seven-day Daily Set goal in progress, which is not a single daily activity.
Previously, all raw Earn promotions were flattened into candidates, including
multi-step parents, ongoing goals and nested steps; these could become manual
handoffs that blocked the subsequent Search phase.

The scanner is now `daily-keep-v18`. Scope filtering excludes typed Quest/punch
cards, search-streak records, non-daily activity counts above one and non-daily
`inProgress` flags. Nested excluded groups are pruned, and their stable IDs
cannot reappear as rendered aliases. Daily Set quizzes and single-card Keep
earning remain eligible. Titles and URL wording are not used to classify scope.
Excluded records are removed before automatic/manual partitioning, so they do
not open tabs, increase totals, request user action or claim completion.

Seven scope regressions cover raw/fallback/combined data, nested aliases, ongoing
seven-day goals and preservation of daily/Keep cards. A Daily Set card referenced
by an excluded goal remains an independent task; scope filtering never hides
conflicting server evidence during credit verification. RED failures reproduced
the unwanted tasks before the fixes. In the real unpacked Edge fixture, two
in-scope cards confirm, ignored goals create no tabs or handoff, then one Search
runs and Auto All completes. This does not establish authenticated account
credit or prove every future dashboard schema. Supplied HTML identifies the
kind of goal to ignore, not its signed-in API record; the new mappings are tested
with synthetic metadata. See [scope evidence](daily-keep-scope.tdd.md).

## Sequential Run all 2.0.2 — 2026-10-05

Run all previously awaited the Quest function but still started Search after
that function handed off unfinished offers. It now requires no outstanding
manual offers and fully confirmed Quest progress before entering Search. It
also checks Pause/Stop at the phase boundary. A handoff retains Quest progress
and ends the run with a bilingual explanation that Search has not started.
Finish those offers on Rewards and click Run all again to rescan; completed
cards remain excluded. No background handoff monitoring was added.

Four regression failures reproduced the early Search and missing explanation
before the fix. The full suite now passes 132/132. Actual Edge fixture testing
verifies both the successful sequence and zero Search navigations on handoff or
Stop. Six native popup scenarios pass. See [TDD evidence](auto-all-order.tdd.md)
for commands, scope and coverage limitations.

## Release review 2.0.1 — 2026-10-04

Two independent reviewers examined Quest replay protection and repository release
readiness. The fallback parser previously accepted only boolean completion flags,
so `complete: "true"` on a disabled card could reopen its destination as a manual
task. Fallback Earn data also omitted the date check applied to combined/raw
payloads. Three failing regressions reproduced these bugs before the fix.
Fallback records now share completion, hidden/test flag normalization and date
filtering with the other data paths. Explicitly pending conflicting progress
is not mistaken for completion.

The complete suite passes **126/126**, syntax/asset checks pass, and isolated Edge
verifies that starting again after completion neither reactivates the handler
nor opens another task tab. Pause/Resume, Stop, partial progress, actual extension
reload and five native popup layout scenarios also pass. Completion is based on
current server/DOM evidence and per-run activation deduplication; no permanent
local identity blacklist is used, because it could suppress a new day's offer.

Manifest/package versions are 2.0.1 and unsupported STAR-bonus claims are removed.
The asset checker and deterministic ZIP packager share a 12-file runtime allowlist.
QA profiles, development tools, fixtures and documentation are excluded from the
installable ZIP. Source publication keeps tests and documentation. Portable
installation instructions and [GitHub preparation](github-preparation.md)
describe the two artifacts separately. GitHub publication is not performed by
these local checks.

Python's independent ZIP reader passes CRC checks, verifies the exact allowlist
and byte equality against source, then extracts the artifact. Installed Edge
loads that extracted ZIP unpacked: version 2.0.1, actual MV3 worker, both Quest
imports, bundled word data and 420px popup CSS/JS, with zero popup exceptions.

## Official Daily Set + Earn cards v17 — 2026-10-04

The user supplied a screenshot of the remaining Daily Set card, "Smith Stories?",
and clarified that clicking its official card earns completion in their account.
The v15 policy preemptively treated every quiz marker as manual and restricted
automatic tasks to dated simple search URL cards. Seven RED tests reproduced
that exclusion, missing Earn support, broad title exclusions and string-valued
availability flags. The policy now permits one official activation for pending,
positive-point Daily Set and Earn offers, regardless of quiz/poll/puzzle markers,
multi-step metadata, title words or destination shape. Origin/date/points/hidden
and explicit disabled/locked/in-progress checks are preserved.

Actual execution still requires one uniquely matching visible `.promo_cont`
anchor with the expected URL, title and points. Custom controls or cards omitted
from the mounted flyout cannot be activated and remain unconfirmed. The extension
does not answer quizzes, perform additional destination interactions, fabricate
completion or call a reporting endpoint. Two affirmative server observations are
still required to increase progress. Metadata is refreshed before each card;
Stop/Pause and worker restart behavior are unchanged.

The review identified fallback identities that can describe one physical card
more than once. Per-run activation fingerprints use the matched DOM signature,
including its actual title when the raw record omits it. A duplicate handler is
suppressed before acquiring another permit. Distinct offers are not merged by
URL alone. RED regressions for duplicate aliases and omitted raw titles now pass.
The Set is local to the run and contains no persisted or logged titles/URLs.

The popup was also restyled as a compact control console: graphite header,
layered warm-white/navy surfaces, cobalt Run all and amber quest control. It
retains intrinsic 420px sizing, local fonts, 44px action buttons, contrast, focus
indicators and reduced motion. The label is now Quests/Nhiệm vụ to reflect both
sections. No permissions or product dependencies were added.

Verification: full `npm test` 123/123; `npm run check`, both browser script syntax
checks and `git diff --check` pass. Actual unpacked Edge fixture smoke activates
the previously excluded Daily Set quiz and an undated Earn card through their
handlers exactly once, confirms both, and skips a zero-point card. A seven-offer
fixture finishes 5/7: one offer deliberately remains pending and another is
absent, proving partial progress continues without fabricated credit. Stop,
Pause/Resume, popup reopen and real extension/worker reload also pass. Native
popup QA passes five language/theme/settings/idle scenarios at 420px body width,
footer 506px within a 514px viewport, and tested text contrast at least 5.74:1.
These synthetic-profile checks do not prove live credit for the user's account.

## Toolbar popup sizing and appearance (previous styling) — 2026-10-04

The user's screenshot exposed a native popup sizing defect. The previous CSS
set `body { width: 380px; max-width: 100vw; }` without an intrinsic minimum on
`html`. Edge's toolbar popup initially measures a narrow viewport, causing that
viewport cap to constrain its own content measurement. A real
`chrome.action.openPopup()` reproduction measured a 173px body. Earlier smoke
tests used a 380px browser tab and therefore missed this feedback loop.

The root and body now explicitly size to 420px without a viewport-relative cap.
Native Edge measurement is 420px content plus a possible 15px scrollbar gutter.
The title and status/count no longer wrap; the three inputs stay about 115px wide.
White/slate surfaces and blue actions replace the previous cream/teal palette.
The dark palette has separately verified contrast. Buttons remain 44px tall.
Handoff instructions appear once inside the status card, while active status,
stopped status and command errors remain visible. Button descriptions move to
localized titles and accessible descriptions. Expanded settings and long errors
can scroll; the ordinary one-task handoff controls/footer fit the tested 514px
native viewport. Very long messages or constrained browser windows can still
require vertical scrolling.

UI/UX Pro Max was read from its official upstream and its local design-system,
UX and color searches informed the palette and layout. ECC taste was also read;
its video-oriented creative-direction guidance was only applicable to visual
consistency. No downloaded skill assets or remote fonts are packaged.

`scripts/popup-layout.cjs` reproduced the width failure before the CSS fix and
passes on the actual toolbar popup in English/light, Vietnamese/light,
Vietnamese/dark and expanded dark settings. Enabled text pairs tested at least
4.64:1 in light and 6.62:1 in dark. Full `npm test` passes 116/116, `npm run check`
and script syntax/diff checks pass. The unpacked Edge fixture smoke still passes
Start, Pause/Resume, immediate Stop, popup reopen and extension/worker reload,
with zero popup JavaScript errors. These isolated-profile results do not claim
that the user's existing Edge profile has reloaded this UI.

## Daily handoff v15 (historical, superseded by v17) — 2026-10-04

The user's authenticated v14 log confirms 3/5 activities and continues past the
missing card. The user clarified that the last Daily Set card still appears
incomplete. Its exact title/type is not supplied, so a quiz requirement or delayed
credit is not claimed as a proven account-specific cause.

The cached official flyout bundle consumes `flyoutResult.dailySetPromotions`
and requests getuserinfo with channel/partnerId. The earlier extension only
parsed raw `userInfo.activities/promotions` when both models were present. v15
uses `channel=BingFlyout&partnerId=BingRewards` for both data and UI, merges the
dated rendered model, and tests a third Daily Set card absent from the raw list.

Automatic execution requires current-date membership and a simple Bing URL
activity. Quiz, poll, puzzle, multi-step, undated and unconfirmed tasks are handed
to the user. Their destinations are opened once per URL; existing matching
result tabs are reused. The popup shows a remaining count after opening them.
That count is a handoff snapshot, not monitoring or a claim of manual completion.
No quiz answers or reporting APIs are automated. Manual offers do not block the
remaining daily URL cards or searches in Run all.

Stop previously kept `isRunning=true` until the awaited operation finished.
It now acknowledges stopped immediately without awaiting storage. Per-run
cancellation tokens and waiter sets prevent old browser callbacks, completion/
error paths and click nonces from affecting a replacement run. Already-dispatched
browser requests/site clicks cannot be retracted, but cannot start the next
extension action. Search uses the configured count/delay range without simulated
scrolling or random result clicks.

The monitoring window is removed. The original v15 popup used local fonts, a warm neutral
light theme with teal controls (superseded by the popup repair above), an optional dark theme, Vietnamese labels and
an accessible GitHub icon linking to CKhanh1602. No new permissions or remote
UI resources are introduced.

New manual-handoff and Stop regressions failed RED before implementation, then
passed GREEN. See daily-quest, manual-handoff, instant-stop and popup tests.
Final verification: full suite 114/114, syntax/manifest checks and diff check
passed; installed Edge unpacked fixture smoke passed with zero popup JS errors.
Edge fixture evidence is in `edge-qa.md`. These checks do not prove live point
credit or completion of the undisclosed account card.

## Fresh metadata and per-card recovery v14 (historical, 2026-10-03)

The user's v13 log confirmed activities 1/5 and 2/5, activated 3/5 without
confirmation, then aborted on `QUEST_CARD_NOT_READY` before 5/5. Code inspection
and new RED regression tests reproduced two defects: the initial API metadata
was reused after flyout reloads, and a single readiness miss escaped the loop.
The exact live mismatch for card 4 (absent, completed, locked, or changed URL/title/
points) is not established without the rendered DOM. Card 3's unconfirmed state
does not establish whether the offer requires interaction or has delayed credit.

v14 refreshes each original identity after the flyout load and before activation.
It uses current URL/title/points, skips clicking already-complete offers, and
requires two affirmative completion reads before counting. Missing/filtered or
conflicting identities stay unconfirmed; no substitute is chosen by position.
`NOT_READY`, `AMBIGUOUS`, and `CHANGED` definitively mean no click was dispatched:
they trigger read-only reconciliation and continue to later offers. Other errors,
including uncertain activation timeouts, remain terminal without replay.

Readiness scans share one active-time budget; a scan-only timeout becomes a card
readiness miss. Missing scans log bounded counts of visible/pending cards, URL/
title/point matches and completed/in-progress/locked exclusions. No titles, URLs,
query values or account data are logged. Default waits remain 10 seconds, editable
up to 300 seconds. Existing Stop/Pause permits and MV3 recovery are unchanged.

New regressions reproduce the user's five-offer sequence, metadata drift,
completion during readiness, missing/replacement identities, conflicting metadata,
scan timeout and terminal-error preservation. Live authenticated v14 behavior
still needs the user's reload/test; unit and Edge fixture results do not award points.

Verification: `npm test` passes 89/89; `npm run check`, `git diff --check` and
`node --check scripts/edge-smoke.cjs` pass. The Edge smoke script loads the real
unpacked worker/popup in an isolated profile. Its mixed five-offer fixture confirms
1/2/5, keeps 3 pending, omits 4 from the DOM, and finishes `ACTION NEEDED 3/5`
without `Run failed`. Only 1/2/3/5 handlers run, once each. Offer 5 changes title
and URL after the first activity while retaining its stable ID; only its new card
is rendered and activated. Previous complete, Pause/Resume, Stop, popup hydration,
pending timeout and extension reload/no-replay scenarios also pass. Popup errors
are zero; nine fixture web-page errors were recorded separately. Authenticated
v14 credit and natural idle-worker suspension remain manual verification items.

## Official card activation v13 (historical, superseded by v14)

The user's v12 log found 42 promotions, selected five offers, and confirmed zero.
The public Microsoft flyout bundle `main.925d4a77.chunk.js`, loaded by
`https://www.bing.com/rewards/panelflyout`, explains the omitted step:
`PromotionLink.ClickEvent` invokes the site's activity handler before clicking
the destination link. Direct `tabs.create(destination)` does not invoke it.
The user's dashboard HTML also contains completed and pending cards sharing a
destination; a URL alone is not sufficient card identity.

v13 opens that official UI on the already permitted Bing origin. `quest-ui.js`
matches a unique visible `.promo_cont a.block` with a pending positive-point
control, URL, title and points. It skips completed/locked/in-progress cards and
rejects ambiguous matches. The flyout replaces `FORM`; only that parameter is
ignored. The exact rendered link is clicked without modifying it. The extension
does not call reporting endpoints, synthesize trusted events or bypass browser
origin restrictions. The page retains ownership of its normal handler.

DOM readiness is probed until the configurable deadline, not assumed after a
fixed sleep. Activation is pinned to the scanned document and requires a one-use
nonce authorization bound to sender extension/tab/document. Stop or Pause denies
queued requests; abandoned permits are removed on timeout. An action already
authorized can finish within its 250ms lease. No readiness observer clicks later.
There is no automatic retry of an indeterminate activation.

Completion still requires two affirmative read-API observations for the offer.
The source UI and result tabs stay open. Stop, early tab close, offline responses,
rate limits and worker restart preserve an honest stopped/unconfirmed state.
The subsequent user log confirmed two activities in v13 and exposed the mid-run
failure addressed above. Native Edge capture failed in this session; independent
inspection of the authenticated UI is unavailable. DOM/API fixtures cannot
establish a real point award.

v13 verification: `npm test` passes 79 tests; `npm run check` and
`git diff --check` pass. `scripts/edge-smoke.cjs` passes in isolated Edge with
the actual unpacked worker/popup and synthetic web pages. Its delayed DOM has a
completed and a pending card sharing a URL/title; completion requires the pending
card's normal handler. It exercises Pause/Resume, Stop, pending timeout, popup
reload and extension reload without replay. Browser QA also reproduced a temporary
`Frame with ID 0 is showing error page` before document readiness. Read-only
scans retry that transition within the deadline; activation failures never retry.
Five fixture web-page errors were observed separately; popup errors were zero.
Build, lint and type-check tasks are not configured in this plain-JS repository.

## Historical v12 destination navigation (superseded)

The user's signed-in Edge run confirmed that visiting the generated search
destinations did not cause Rewards to mark the offers complete. The prior
worker opened each destination for about one second and reported the local
navigation loop as complete. That was not evidence of Rewards credit.

The worker now keeps the stable part of the historical design: it opens the
exact destination URL supplied for each eligible offer. It no longer discovers
or clicks dashboard DOM. After each destination finishes loading, it re-reads
the flyout and requires two consecutive observations where the same offer is
explicitly complete or has reached maximum progress. Only then does it increase
progress and close that owned tab.

An activity that remains pending or cannot be verified stays open and the popup
shows `ACTION NEEDED`; Auto All does not proceed to Search while offers need
action. The extension does not call completion or claim APIs, and a page load
alone is never counted as credit.

The actual offer conditions and point award remain controlled by Microsoft;
this implementation cannot force or certify credit.

### Feasibility of automatic card clicks

The local `tests/fixtures/trusted-click.html` fixture is available for comparing
JavaScript-generated and browser input events. It is not evidence of how
Microsoft Rewards evaluates an offer, and no authenticated Rewards click test
has been established. The extension cannot inject a DOM click into the
Rewards dashboard because Edge blocks extension
scripts on that origin. Earlier Edge 154 checks also found that
`chrome.debugger` is blocked there. The available MV3 extension APIs therefore
do not provide a reliable dashboard DOM click path in the user's Edge session.
Exact offer navigation plus server-state verification is used instead.

## Earlier flyout replacement (2026-10-02)

The authenticated Rewards page was confirmed fully loaded, but Edge rejected
`chrome.scripting.executeScript` with `The extensions gallery cannot be
scripted`. A controlled Edge 154 test then loaded the same declarative content
script on `www.bing.com` but withheld it on `rewards.bing.com`; messaging the
Rewards tab returned `Receiving end does not exist`. This isolates the failure
to Edge's protected-origin behavior, before DOM selectors or timeout logic run.

The first API replacement also became invalid after the 2026 Rewards SPA
migration: the legacy dashboard endpoint can return 401 or a schema without the
activity collections even while the visible session is signed in. Auto Quest
now requests the credentialed, read-only Bing flyout endpoint
`www.bing.com/rewards/panelflyout/getuserinfo`, validates both flyout and legacy
schemas in `quest-api.js`. The active implementation opens pending,
positive-point Bing/Rewards destinations and verifies the offer state afterward. It
never calls `reportactivity`, DAPI claim/activity endpoints, or OAuth; it never
injects into Rewards. The Rewards host permissions, previous DOM implementation
and content bridge were removed. `activeTab`, `alarms`, and the global
web-accessible resource were also removed because they were unused.

Edge 154 QA proved that `chrome.debugger` is blocked on both the Rewards dashboard
and Edge Rewards Hub with the same `The extensions gallery cannot be scripted`
error, so no debugger permission was added. The Bing flyout endpoint returned
HTTP 200 and exposed `userInfo.activities` and `userInfo.promotions` without new
permissions. The unpacked product extension then called this endpoint in a clean
profile and produced `QUEST_SIGN_IN_REQUIRED`, proving the fetch/parser/error path
inside the real service worker. A historical flyout fixture opened two allowed
activities in one owned tab, reached 2/2, and closed that tab; this represented
navigation only. The user's signed-in run later showed no Rewards credit.

The sections below document the original defect and earlier DOM repair work;
they are retained as historical evidence and no longer describe the active
Quest execution path.

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

## Historical DOM implementation

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

## Historical verification (2026-10-03)

- `npm test`: 55/55 pass. The active suite covers flyout/legacy parsing, affirmative completion
  twice, dated/fallback identities, archived and contradictory server records,
  positive completion without a destination, and distinct offers sharing one URL.
  Lifecycle cases cover Stop, Pause/Resume with active-time deadlines, tab closure
  during load/verification/pause, persisted restart recovery and Auto All cancellation.
  Popup cases cover the persistent monitor and configured wait limit.
- `npm run check`: background/parser/popup syntax and MV3 packaged-file checks pass.
- `git diff --check`: passes.
- `node scripts/edge-smoke.cjs` with bundled Playwright: passed in an isolated
  Edge profile with the actual unpacked extension, real MV3 worker and synthetic
  API responses/intercepted destination pages. Confirmed startup, dark/light
  popup, Vietnamese labels, the 10s default, completion/owned-tab cleanup,
  Pause/Resume, Stop, popup reopen and actual extension reload/worker restart
  without replay.
  The latest smoke fixture uses the primary flyout schema (`activities: null`,
  `promotions` with string attributes). An unchanged pending record reaches
  `ACTION NEEDED` after the configured deadline, retains its tab and stays 0/1;
  it never reports credit. This is also verified in the real installed worker.
  Screenshots are under ignored `.qa/`. The first visual pass
  exposed a white-on-white monitor button, now corrected for both themes.
  Popup JavaScript errors: zero. Edge's scripts on synthetic Bing pages raised
  `_G is not defined`; these fixture-page errors are recorded separately.
  There is no visual baseline or full accessibility audit.
- `npm run test:coverage`: tests pass, but Node's report for these VM-executed
  scripts is empty. The displayed aggregate 100% is not application coverage;
  the ECC 80% coverage target has not been established.
- Build, TypeScript and ESLint: not configured; the extension loads source files.
- Security/diff review: Rewards host access was removed; no debugger, webRequest,
  cookie, identity, trusted-input simulation, secrets, CAPTCHA handling or
  anti-detection features were added.
  Existing unrelated search behavior was not expanded or redesigned.

## Remaining browser validation

See [Edge QA](edge-qa.md). Computer Use on 2026-10-03 found the user's Personal
Edge window and the enabled unpacked Bing Search Automator card. Input then
failed with `coordinate input geometry is unavailable`; screenshot capture and
the recovery attempt timed out. The separate browser inventory exposed only
the Codex in-app browser and MCP Apps, not Edge. This establishes presence of
the previously installed extension, not loading or authenticated verification
of this patch in the user's profile. The separate headless smoke test proves
loading and popup delivery in a clean profile, not signed-in Rewards credit.
Current live completion and natural idle worker suspension remain unverified.
Manifest checks and synthetic API tests do not prove credit.

Restart can leave activity tabs open because ownership is not persisted across
browser lifetimes; recovery avoids replaying or closing a potentially reused tab.
Unrecognized schemas, removed fallback identities and interactive offer conditions
remain inconclusive; the extension keeps unconfirmed tabs available for normal
manual completion. Official card activation may still fail to earn credit for an
offer whose conditions require other interactions. v13 preserves that outcome
as unconfirmed instead of claiming completion.
