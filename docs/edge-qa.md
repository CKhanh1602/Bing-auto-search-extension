# Auto Quest: Edge / Chrome manual verification

## Browser evidence from this session

On 2026-09-30 the browser connector exposed only the Codex in-app browser,
with no connected Edge/Chrome profile or native application control. Visiting
`https://rewards.bing.com/` redirected to `/about` and showed **Sign in**.
The public page exposes `/dashboard` and `/earn` and React Aria navigation.
The captured public-page console contained no warnings/errors. This does not
verify the authenticated activity-card DOM or an extension service worker.

Loading an unpacked extension, authenticated Rewards completion, actual worker
suspension, and browser-specific message delivery remain manual checks below.
Do not interpret a passing mock test as proof that Microsoft awarded points.

## Load the working directory

1. Open `edge://extensions` (Chrome: `chrome://extensions`).
2. Enable **Developer mode**, choose **Load unpacked**, and select the directory
   containing `manifest.json`, `background.js`, and `popup.html`.
3. Verify the extension card has no manifest/load error. Open its service worker
   inspector and check for import or startup exceptions.
4. Sign in to Rewards yourself in that browser and verify that Dashboard and
   Earn render your activity cards. Do not share cookies, tokens or account data.
5. Open the extension popup and select **Auto Quest**.

## Acceptance scenarios

| Scenario | Check |
| --- | --- |
| Start | One run starts; clicking Start again does not create a competing run. Status moves past page loading. |
| Normal activities | Recognized pending daily/Keep earning activities are processed; completed cards are skipped. Compare the actual dashboard result separately from extension progress. |
| Changing card list | When the first card becomes completed/disappears, the next remaining card must still be considered. |
| Pause / resume | Pause prevents the next activity action; reopening the popup retains paused status. Resume continues once without duplicating already processed work. |
| Stop during load/wait/pause | Stop exits promptly, closes only tabs owned by this quest run, and no later delayed action restarts it. |
| Unrelated tab | Open an unrelated tab while a run is active; it must remain open after completion and Stop. |
| Popup reopen | Close/reopen the popup during a run and after completion; status matches the worker. |
| Worker restart | Close worker DevTools so it cannot keep the worker alive. Use the browser's service-worker inspection page to stop the worker, then reopen the popup. Recovery must show the persisted state or an explicit interruption; it must not silently replay an action. |
| Extension reload | Reload the extension during a run, then reopen the popup. Verify explicit recovery/interruption and that no duplicate run starts. |
| Network failure | Set the Rewards tab's DevTools Network panel to Offline before navigation. Expect bounded failure/retry and an actionable status, never false completion. Restore Online afterward. |
| Close tab early | Close the extension-created Rewards/activity tab while loading; expect an explicit failure/interruption and no stuck running state. |
| Slow page / timeout | Use network throttling to exceed the load timeout; check bounded recovery and Stop responsiveness. |
| Missing selectors | In a disposable DOM fixture remove all supported activity sections. Expect a clear unsupported/empty-page result, not a broad click on navigation or unrelated links. |
| Signed out | Use a signed-out browser profile. The `/about`/sign-in redirect must not be reported as successful quest completion. |
| Existing search / Auto All | Run the existing search workflow with a small configured count; confirm controls and progress still work. Auto All must not start search after Stop. |

For evidence, capture only generic status text and error codes. Omit account
names, point balances, complete activity URLs/query strings, cookies and tokens.
Do not attempt CAPTCHAs, anti-detection measures or activity spoofing to make a
test pass. Interactive quizzes or other unsupported activities may require the
user to complete them normally.
