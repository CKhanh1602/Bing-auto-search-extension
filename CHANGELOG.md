# Changelog

## 2.1.0 — 2026-10-06

- Run all finishes the automatic Quest pass before starting Search.
- Retain Daily Set and Keep earning; exclude multi-step Earn Quests, ongoing
  goals and their nested steps.
- Remove manual handoff and manual destination tabs. Missing, unavailable and
  unconfirmed activities are skipped, removed from the task total, and reported
  separately without claiming reward credit or blocking Search.
- Suppress repeat activation when either current API source reports completion
  or an exact matching official UI card is completed despite stale API data.
- Keep two affirmative server observations for verified credit, and retain
  Pause, Stop, tab-close, timeout and MV3 restart protections.
- Retire persisted manual task counts and improve the skipped-activity notice
  in both languages, preserving the 420px popup layout.

Validation: 143 unit/integration tests, syntax/asset checks, installed Edge with
synthetic Rewards fixtures, and six native popup scenarios. The install ZIP
contains only the 12 allowed runtime files. Fixtures do not prove live account
credit or natural idle-worker suspension.

The local 2.0.2–2.0.4 builds were preparation versions; their detailed evidence
is retained in `docs/`. Version 2.1.0 includes those changes.
