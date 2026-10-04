# Auto Quest: Edge / Chrome manual verification

## Browser evidence from this session

Release 2.0.1 verification on 2026-10-04: `npm test` **126/126 passed**, `npm run check`,
script syntax and `git diff --check` passed. `node scripts/edge-smoke.cjs`
passed with installed Edge, a clean profile and the real unpacked MV3 extension.
Its fixtures prove a daily URL offer present only in transformed Daily Set is
discovered, activated once and verified. A dashboard-only quiz and undated Earn
card are each activated once through the official card handler and verified;
a zero-point card is not activated. The mixed seven-offer fixture finishes
5/7 confirmed plus two unconfirmed tasks. Stop
followed immediately by Start stays correct even when the old fetch ignores
abort and resolves later. Pause/Resume, reopen and extension/worker reload with
interruption/no replay pass. Popup JavaScript errors: zero. Twelve errors from
intercepted fixture web pages were recorded separately. A diagnostic rerun
passed and identified their unique message as `_G is not defined`; no extension
source references `_G`, but the exact injected-script origin was not established.
This is not a clean live-webpage console claim. Live account point credit and natural idle suspension
are not established by the fixtures.

The final review added regressions for string/numeric completion flags and
stale dates in fallback Earn data. The Edge fixture starts Quest again after
completion and verifies that the handler remains called once and no additional
task tab opens. The scanner remains `official-cards-v17`.

The native toolbar popup test `node scripts/popup-layout.cjs` reproduced the
old 173px width that a fixed-viewport tab test missed. It now measures 420px
content width (up to 435px viewport with native scrollbar gutter), a single-line
title/count and ~117px search inputs. English/light and Vietnamese/light/dark
have no horizontal overflow. The one-task handoff footer fits within the actual
514px test viewport. Expanded settings and long errors remain reachable by
scrolling. Tested enabled text pairs have at least 5.74:1 contrast in both themes.
The graphite header and amber quest control add emphasis to the layered surfaces.
Current screenshots are in ignored `.qa/`; `screenshot.png`
shows the real Vietnamese light toolbar popup in ready state, using an isolated profile.

Current build: **official-cards-v17**. v15/v14/v13 results are historical.
Current scope is one official activation per enabled pending point-bearing
Daily Set or Earn card, including quiz-labelled cards. Unavailable/custom
controls and unverified offers stay open with a remaining-count notice.
The notice is a snapshot; completion is checked on
Rewards itself. The normal popup replaces the monitoring window.

v14 fixes a reproduced mid-run failure after the user's v13 log confirmed two
offers then stopped at a missing fourth card. Every offer now refreshes current
metadata using its original identity. A definitive pre-click missing/ambiguous/
changed card remains unconfirmed while later offers continue. The isolated Edge
five-offer fixture finishes `ACTION NEEDED 3/5`, activates only 1/2/3/5, and uses
the changed URL/title of offer 5 without a duplicate click. The full 89-test suite
and all prior smoke lifecycle scenarios pass. This does not establish live v14
credit for the user's pending offers.

On 2026-10-03 the user's v12 run discovered five offers and confirmed zero.
Direct destination navigation omitted the official card handler. v13 opens
`https://www.bing.com/rewards/panelflyout?channel=bingflyout&partnerId=BingRewards`,
waits for the actual pending card and activates it. The public flyout bundle's
`PromotionLink.ClickEvent` processes activities before navigating. Confirmed
offers advance only after two affirmative read-API observations. The flyout and
result tabs remain open. Unconfirmed offers show `ACTION NEEDED`.

On 2026-10-02 Edge 154 loaded the unpacked extension and its MV3 service worker.
A control extension proved that Edge injected a declarative content script on
`www.bing.com` but withheld the same script on `rewards.bing.com`. The active
implementation therefore uses the read-only Bing flyout API and has no Rewards
content script or Rewards host permission. Edge also rejected `chrome.debugger`
on both the dashboard and Rewards Hub, so that permission is not used. A clean
profile received HTTP 200 from the flyout, and the product worker correctly
classified it as `QUEST_SIGN_IN_REQUIRED`. A historical service-worker flyout
fixture completed 2/2 activity navigation; that did not prove Rewards credit.

Authenticated Rewards completion and actual worker suspension in the user's
profile remain manual checks below.
Do not interpret a passing mock test as proof that Microsoft awarded points.

On 2026-10-03 Computer Use connected to the Personal Edge window and read its
enabled unpacked extension card. The next input failed with `coordinate input
geometry is unavailable`, and capture/recovery timed out. This patch has not
been reloaded or tested in that profile. The browser connector did not expose
Edge in its inventory.

The v13 patch passed `scripts/edge-smoke.cjs` in a clean Edge
headless profile: unpacked load, real service worker, popup theme/language/defaults,
async DOM readiness, matching pending-card activation, Pause/Resume, Stop, popup reload and actual
extension reload with worker interruption recovery and no replay. API responses
and pages were synthetic. In this fixture completion requires the card handler;
direct navigation cannot earn fixture credit. A completed card shares the same
URL and title with the pending card to check selection. No personal login was used. Screenshots
are in `.qa/edge-popup-dark.png` and `.qa/edge-popup-light-vi.png`. No popup
JavaScript error occurred. Bing scripts on fixture pages emitted `_G is not
defined`, which is separate from popup errors. Live account credit and natural
idle suspension still require the checks below.

The smoke fixture uses the primary flyout format (`activities: null`
and string-valued promotion attributes). A server record that remains pending
reaches `ACTION NEEDED` at the 10s deadline, remains 0/1 and keeps its tab open.
The reattempt to capture Personal Edge still failed after recovery; live QA
remains pending.

## Load the working directory

1. Open `edge://extensions` (Chrome: `chrome://extensions`).
2. Enable **Developer mode**, choose **Load unpacked**, and select the directory
   your project directory containing `manifest.json`,
   `background.js`, `quest-api.js`, `quest-ui.js`, and `popup.html`. If that directory is
   already loaded, click **Reload** on its extension card instead.
   Close the old popup and reopen it from the toolbar to apply the new CSS.
3. Verify the extension card has no manifest/load error. Open its service worker
   inspector and check for import or startup exceptions.
4. Sign in to Rewards yourself in that browser and verify that Dashboard and
   Earn render your activity cards. Do not share cookies, tokens or account data.
5. Open the extension popup, select **Quests** (Nhiệm vụ).
   Reopen the popup to inspect status if it closes when focus leaves it.
   In settings, **Quest wait limit** defaults to 10 seconds and can be increased
   to 300 seconds for a slow connection. It is a deadline, not a fixed sleep.
6. The worker log must show `Quest scanner: official-cards-v17` and
   `Quest official card activated`. Compare
   the confirmed counter with the actual Completed markers on Rewards.

## Acceptance scenarios

| Scenario | Check |
| --- | --- |
| Start | One run starts; clicking Start again does not create a competing run. Status moves past page loading. |
| Normal activities | The official flyout renders and clicks the matching pending card. The counter advances only after two consecutive flyout responses explicitly report completion or maximum progress. Tabs remain visible. |
| Daily quiz / Earn | A quiz-labelled Daily Set card omitted from the raw list and an undated Earn card are discovered and each official handler is activated once. Only server-confirmed results count. No quiz answers are automated. |
| Unverified activity | An unconfirmed automatic activity is handed off in its existing result tab or a new destination tab. Manual tasks are not counted as credit. |
| API filtering | Completed, zero-point, hidden, stale and off-origin entries are skipped. Title words and quiz labels do not exclude an otherwise valid card. Custom controls without a matching official anchor stay unconfirmed. |
| Start after completion | Start again on the same day. Previously completed cards must not activate; when no eligible offers remain, no new task tab should open. |
| Pause / resume | Pause freezes deadlines and denies queued click permits. Reopening the popup retains paused status. Resume continues without duplicating a confirmed activity. |
| Stop during load/wait/pause | Controls/settings unlock on Stop acknowledgement. Start another run immediately; old callbacks must not change its state, navigate or close tabs. Already-dispatched site actions cannot be retracted. |
| Unrelated tab | Open an unrelated tab while a run is active; it must remain open after completion and Stop. |
| Popup reopen | Close/reopen the popup during a run and after completion; status matches the worker. |
| Native popup layout | Open from the toolbar, not as a tab. Title/count and all three input labels remain readable. Toggle language/theme; open settings and scroll to the bottom. A long error must wrap without horizontal scrolling. |
| Worker restart | Close worker DevTools so it cannot keep the worker alive. Use the browser's service-worker inspection page to stop the worker, then reopen the popup. Recovery must show the persisted state or an explicit interruption; it must not silently replay an action. |
| Extension reload | Reload the extension during a run, then reopen the popup. Verify explicit recovery/interruption and that no duplicate run starts. |
| Network failure | Set Edge DevTools Network to Offline before Start. Expect `NETWORK_OFFLINE` or `QUEST_API_NETWORK`, bounded retry and no false completion. Restore Online afterward. |
| Rate limit | A 429 response must stop once with `QUEST_RATE_LIMITED`; it must not retry automatically. |
| Close tab early | Close the current activity tab during loading, verification, or Pause after load; expect TAB_CLOSED, prompt request cancellation and no stuck running state. |
| Slow page / timeout | Use network throttling to exceed the load timeout; check bounded recovery and Stop responsiveness. |
| Missing selector/card | The log includes `Quest card scan` counts and per-card `QUEST_CARD_NOT_READY`. The next offer is attempted; the unavailable one stays unconfirmed. Increase the wait limit only if still loading. |
| Ambiguous card | Two indistinguishable pending cards must log `QUEST_CARD_AMBIGUOUS`, with no click, then continue other offers. |
| Metadata drift | A later offer retaining its stable ID but changing URL/title/points is matched using fresh API data. A different/replacement ID must not be clicked as the original. |
| Duplicate source card | Raw/rendered records with different fallback IDs and missing raw title cannot replay one physical card's handler in the same run. A distinct card is not merged by destination alone. |
| Mid-run partial progress | With five offers, first two confirmed, third pending and fourth absent, fifth is still attempted. Confirmed progress survives and the final state is `ACTION NEEDED`, not `Run failed`. |
| Changed API schema | With an incompatible flyout/dashboard fixture, expect `QUEST_API_SCHEMA` and no activity tab. |
| Signed out | Use a signed-out browser profile. Expect `QUEST_SIGN_IN_REQUIRED`, not successful completion. |
| Existing search / Run all | Search uses the exact configured count/delay range. Run all continues searches after manual handoff, but never after Stop. No scripted scroll or random result click. |

For evidence, capture only generic status text and error codes. Omit account
names, point balances, complete activity URLs/query strings, cookies and tokens.
Do not attempt CAPTCHAs, anti-detection measures or activity spoofing to make a
test pass. Interactive quizzes or other unsupported activities may require the
user to complete them normally.
