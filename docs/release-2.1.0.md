# Release 2.1.0 — 2026-10-06

Version 2.1.0 includes the Quest-first ordering, Daily Set/Keep earning scope,
completed-card replay protection and automatic-only pass described in
[CHANGELOG](../CHANGELOG.md). Scanner: `auto-only-v19`. Default wait budget:
10 seconds per phase, configurable from 10 to 300 seconds.

## Final release checks

- `npm test`: 143/143 pass, no failures, skips or cancellations.
- `npm run check`: syntax, manifest/package version, runtime file allowlist
  and bundled search data pass. No TypeScript or separate lint tool is configured.
- `npm run package:extension`: 12 allowed runtime files, 152058 bytes.
- Independent ZIP CRC, exact allowlist and source byte equality checks pass.
- Extracted 2.1.0 ZIP loads unpacked in installed Edge: MV3 worker, both Quest
  imports, bundled words, popup CSS/JS and 420px body pass; no popup errors.
- Prior verification of the identical runtime logic in preparation build 2.0.4:
  Edge fixtures cover stale completed cards, skipped credit, Quest then Search,
  scope exclusions, Pause/Resume, Stop and extension reload. Six native popup
  scenarios pass. Synthetic fixtures do not verify live account credit or
  natural idle-worker suspension.
- Secret-pattern and diff reviews found no credentials, new extension permissions
  or reward-reporting requests. Existing sender and one-use click-permit checks remain.

Artifact: `dist/bing-search-automator-2.1.0.zip` (ignored by Git).
SHA-256: `e4dfc35de6ae6072cd0d2d7854c6dfeec857b5f5c60ef04becbe218304043137`.
Do not include local `.qa` profiles or generated ZIPs in the source commit.

After updating the unpacked installation, reload the extension and check version
2.1.0 and scanner `auto-only-v19`. The current
[Edge steps](manual-dom-qa.vi.md) describe account verification.
