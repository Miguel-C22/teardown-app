# Progress

Status: `todo` · `in progress` · `checkpoint` (built, waiting for go) · `done`

| # | Feature | Milestone | Status |
|---|---------|-----------|--------|
| F0 | Project setup: repo, TypeScript, Vitest, Playwright, HTTPS dev server, health route | P1 | checkpoint |
| F1 | Session and parent server (scan-to-start: camera reads the service tag, model filled by the first sweep) | P1 | checkpoint |
| F2 | Camera and barcodes, test feed mode, label grouping (part number + serial on one label) | P1 | checkpoint |
| F3 | Units and dedup (client cooldown, server-side dedup by serial) | P1 | checkpoint |
| F4 | Starter catalog (prefix catalog; catch-all prefixes removed; looked up by part number) | P2 | in progress |
| F5 | Recommendations and settings (rules built; settings screen not built) | P2 | in progress |
| F6 | Drive wipe gate | P2 | todo |
| F7 | Bench screen and pairing (grouped list, 4 s polling; no QR pairing or WebSocket yet) | P3 | in progress |
| F8 | Detail panel and overrides (photo, evidence and reasons shown; no overrides yet) | P3 | in progress |
| F9 | AI label reading: sweep + close-up with OpenAI, mock fixtures, vision:eval | P2 | checkpoint |
| F10 | CSV export (identification and value columns added) | P1 | checkpoint |
| F11 | PoC metrics (vision calls and cost per session; no session timer yet) | P3 | in progress |

## Checkpoint notes

### Scan-to-start — 2026-11-18
- `/scan` opens the camera straight away; the session starts when the server tag is read twice in a row. No typing.
- `pickServerTag` (`shared/src/barcodeClassify.ts`) skips part numbers, PPIDs, MACs, WWNs and UPCs, prefers a 7-character Dell service tag (also from a Dell QR link), else another serial.
- Model is optional on `POST /api/sessions`; the first sweep's chassis guess fills it once and never overwrites it.
- Fallbacks: "No tag? Start without one" (UNTAGGED-…) and a tucked-away "Type it". Scanning header has "Wrong server? Rescan tag".
- `npm test`: 87/87. `npm run e2e`: 58/58. Typecheck clean, build ok. f0/f1/f12 specs updated on purpose for the new start.
- Real phone check: **not done**.

### Prototype 1: server sweep — 2026-11-18
Built as one pass (approved plan), not one feature per checkpoint.
- Barcode classification (`shared/src/barcodeClassify.ts`): Dell PPID, Dell DP/N, HPE spare/option, Lenovo FRU, DIMM/HDD/SSD/NIC/GPU/RAID MPNs, MAC, WWN, UPC, serials.
- Label grouping (`shared/src/labelGroup.ts`): codes close together in a frame form one part; merged neighbouring labels split by serial.
- Vision (`server/src/vision.ts`): OpenAI Responses API, default `gpt-6.2-sol` (override with `OPENAI_VISION_MODEL`), structured output via zod, reasoning effort `low`, image detail `high`, `store: false`. Switched from Claude on 2026-11-18 at the user's request. Sweep lists parts with boxes and counts; close-up reads one label. A number counts only if the model marks it read and it appears in the printed text.
- "What's left" checklist from sweep counts vs recorded units, on the phone tray and the bench.
- Recommendation: verified (number read + price source match) is required for KEEP/RECYCLE; everything else is REVIEW. Unreadable parts get `needs-bench-test`.
- Storage moved from better-sqlite3 to built-in `node:sqlite` (better-sqlite3 had no prebuilt binary for Node 24 and no C++ toolset on this machine).
- `npm test`: 81/81 passed. `npm run e2e`: 50/50 passed (desktop + Pixel 7). `npm run typecheck`: clean. `npm run build`: ok.
- e2e specs changed on purpose: `/scan` now opens the start screen, and CSV header assertions check the new leading columns.
- Claude in Chrome check: **skipped** (asked for code changes only).
- Live vision: **not run**. Needs `OPENAI_API_KEY` in `.env` and a photo set in `fixtures/photos/` for `npm run vision:eval`.
- Real phone check on an open server: **not done**.

### F0 — 2026-11-17
- `npm test`: 2/2 passed (health route, JSON 404 for unknown API routes).
- `npm run e2e`: 6/6 passed (home, /scan, /bench at desktop and Pixel 7 widths; HTTPS; no console errors).
- `npm run typecheck`: clean.
- Claude in Chrome check: **skipped**. Chrome shows a certificate warning for the self-signed cert; not clicked through. Needs a trusted cert (mkcert) first.
- Note: `npm audit` reports 8 dev-dependency vulnerabilities (pinned Vite 5 / Vitest 2); not addressed.
