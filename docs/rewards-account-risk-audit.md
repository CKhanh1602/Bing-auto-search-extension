# Microsoft Rewards account-risk audit

Audit date: 2026-10-02

Historical audit: the Quest implementation reviewed below was the dashboard
handoff version. On 2026-10-03 it changed to exact offer navigation followed by
affirmative server-state verification. See `auto-quest-fix.md` for that patch;
this audit does not establish account safety for either workflow.

Current behavior (release 2.0.1, 2026-10-04): the historical table below does not
describe this release. Search uses the saved count and delay range without
scripted reading, scrolling or result clicking. Quest activates an eligible
official card once and verifies server completion; it does not call claim/report
endpoints or answer quizzes. The monitoring window was removed, and Run all
continues searches after handing off unconfirmed tasks. These changes do not
establish account safety. See [current repair evidence](auto-quest-fix.md).

## Decision

**Blocked for any claim that the extension is safe from account restriction.**

Microsoft defines a qualifying Rewards search as text manually entered by an
individual for genuine personal research. Its current guidance also warns that
using bots, macros, or other automated methods to earn points can lead to
earning limits, suspension, and invalidated points.

Official references:

- [Microsoft Services Agreement — Microsoft Rewards](https://www.microsoft.com/en-US/servicesagreement)
- [Getting the most out of Microsoft Rewards](https://support.microsoft.com/en-us/accounts-billing/rewards/getting-the-most-out-of-microsoft-rewards)
- [Limiting your searches in Microsoft Rewards](https://support.microsoft.com/en-us/accounts-billing/rewards/limiting-your-searches-in-microsoft-rewards)

## Evidence in this repository

| Surface | Behavior reviewed on audit date | Risk |
| --- | --- | --- |
| Auto Search | Generates queries, varies count and timing, scrolls results, and sometimes opens a result automatically | Critical: automated earning is explicitly disallowed; variation does not make it compliant |
| Quest | Reads an authenticated Rewards flyout, opens the official dashboard once, and waits for user action | Lower than the former bulk-opening loop; Microsoft still controls offer eligibility and credit |
| Auto All | Stops after the Quest handoff when offers need user action; Auto Search remains available separately | Auto Search remains a critical risk surface |
| Rewards API errors | Stops immediately on HTTP 429 and does not bypass CAPTCHA or report completion | Positive guardrail, but it does not make automated earning compliant |
| Permissions | Uses `scripting`, `storage`, `tabs`, and Bing host access; no cookies, debugger, webRequest, or identity permission | Narrower technical access, but policy risk remains |

The search code also contains behavior described as mimicking human activity or
avoiding fixed patterns. Those mechanisms must not be used as a safety measure;
they should be removed rather than tuned.

## Safe product direction

The only defensible design for minimizing Rewards enforcement risk is a manual
assistant:

1. Open the official Rewards page without automatically visiting offers.
2. Let the user inspect and complete each offer manually.
3. Remove automated searches, generated search queries, simulated scrolling,
   automatic result opening, timing jitter, and Auto All.
4. Keep local status, the persistent monitoring window, timeout handling, and
   non-sensitive diagnostics if they remain useful.
5. Do not claim that a remaining helper guarantees account safety; Microsoft
   makes the enforcement decision and may change offer-specific terms.

A weaker compromise—requiring one explicit click for each discovered activity—
reduces bulk automation but still cannot be certified as compliant. Opening the
official dashboard and leaving all earning actions to the user is the lowest
risk implementation.
