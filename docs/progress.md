# Progress

Status: `todo` · `in progress` · `checkpoint` (built, waiting for go) · `done`

| # | Feature | Milestone | Status |
|---|---------|-----------|--------|
| F0 | Project setup: repo, TypeScript, Vitest, Playwright, HTTPS dev server, health route | P1 | checkpoint |
| F1 | Session and parent server | P1 | todo |
| F2 | Camera and barcodes, test feed mode | P1 | todo |
| F3 | Units and dedup | P1 | todo |
| F4 | Starter catalog | P2 | todo |
| F5 | Recommendations and settings | P2 | todo |
| F6 | Drive wipe gate | P2 | todo |
| F7 | Bench screen and pairing | P3 | todo |
| F8 | Detail panel and overrides | P3 | todo |
| F9 | AI label reading | P2 | todo |
| F10 | CSV export | P1 | todo |
| F11 | PoC metrics | P3 | todo |

## Checkpoint notes

### F0 — 2026-11-17
- `npm test`: 2/2 passed (health route, JSON 404 for unknown API routes).
- `npm run e2e`: 6/6 passed (home, /scan, /bench at desktop and Pixel 7 widths; HTTPS; no console errors).
- `npm run typecheck`: clean.
- Claude in Chrome check: **skipped**. Chrome shows a certificate warning for the self-signed cert; not clicked through. Needs a trusted cert (mkcert) first.
- Note: `npm audit` reports 8 dev-dependency vulnerabilities (pinned Vite 5 / Vitest 2); not addressed.
