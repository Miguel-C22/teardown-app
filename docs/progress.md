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

### Read everything — 2026-11-19
- Background text reading runs every ~2 s while moving (blurred fast sweeps skipped), also when barcodes are in view; repeat reads of recorded labels are silent.
- `shared/src/textIdentity.ts`: brands, product families (PowerEdge, ProLiant, ThinkSystem, Catalyst, Nexus, PERC, Smart Array, MegaRAID, ConnectX, Xeon, EPYC, Tesla/Quadro, SITOP, SIMATIC, Smart-UPS, Seagate and WD drive families) and a search query (product name, else brand + part number). A product name alone records the item (REVIEW); all text and the search words are kept as evidence.
- More prefixes in `shared/src/labelText.ts`: Order No., Art. No., Cat. No., Mfr/Mfg P/N, Product No., and Type / Ref only when the value looks like a number.
- Plain barcodes with `1P` / `30P` / `1S` data identifiers are split (`parseLinearDataIdentifier`), and Siemens order numbers are recognised (6EP = PSU).
- AI thinking setting back to `low` by default (the 400 came after `minimal`); OpenAI's reason is now logged and shown.
- `npm test`: 180/180. `npm run e2e`: 98/98. Typecheck clean, build ok.

### Automatic scanning, AI only on request — 2026-11-19
- Scan screen buttons: **Find with AI**, **Done**, **⚙ Settings** (part type, torch, raw codes). Removed: Read sticker, Analyze view, Identify with AI, Walk mode, the part-type row. A guidance line under the camera says what to do.
- Sticker text is read automatically after ~1 s holding still on a view with no barcode; two empty reads highlight Find with AI.
- Accuracy: barcodes and sticker text must read the same way twice (`shared/src/readConfirm.ts`); OCR below 60 confidence is ignored; a single-read part number from around a serial is accepted only if it matches a known manufacturer format.
- Find with AI = sweep, merged across presses (`mergeWalkFrame`); fully read parts are recorded, the rest wait for Add / Add all.
- Fix: **Wrong? Remove** on each card (`DELETE /api/sessions/:id/units/:unitId`, `deleteUnit`). Done: summary with gaps and **Next server**.
- The close-up AI route stays on the server, unused by the UI. New fixture `sweep-cooler.json`. Vite warm-up added so a cold e2e run doesn't time out.
- `npm test`: 164/164. `npm run e2e`: 92/92 (also from a cleared Vite cache). Typecheck clean, build ok. Auto sticker reading on a real phone: **not checked** (camera-only).

### Sticker first, AI last; walk mode; hardware check; production basics — 2026-11-19
Identification order: 1) barcode + on-phone OCR, 2) part-number and marking decoders, 3) AI, 4) bench PC hardware report.
- **Storage**: `server/src/store.ts` is async. Postgres (Neon HTTP driver) when `DATABASE_URL` is set, else SQLite locally, memory on Vercel. `/api/health` reports `storage`. Contract test `server/test/storeContract.test.ts` (Postgres when `TEST_DATABASE_URL` is set). Tests and e2e force `DATABASE_URL=""`.
- **Barcodes**: decoded in a Web Worker (`web/src/scan/decodeWorker.ts`), limited formats, 1280px fast pass with a full-size pass after 4 empty frames; saves no longer pause the frame loop.
- **QR codes**: `shared/src/qrPayload.ts` splits MH10.8.2, GS1, `PID/VID/SN` text and plain multi-field payloads. A 1D barcode's serial always wins; a different serial inside a QR next to it is ignored (`shared/src/labelGroup.ts`).
- **Cisco**: PIDs (switches, optics, PSUs, UCS memory), VIDs and serials (`shared/src/barcodeClassify.ts`). New categories NETWORK and OPTIC.
- **Read sticker**: Tesseract.js on the phone (`web/src/scan/ocr.ts`), fields by prefix (`shared/src/labelText.ts`). Also runs automatically around a label whose barcodes gave only a serial. Show raw codes toggle lists what was decoded.
- **Decoders** (`shared/src/partDecoders.ts`): Samsung / SK Hynix (HMA8x) / Micron DDR4 module numbers, Seagate models, a starter Intel sSpec table. Names only, never prices.
- **AI**: buttons renamed "Analyze view (AI)", "Identify with AI", "Add by look (AI)". Sweep photo 1024px, reasoning effort `minimal` (falls back to `low` if refused), output caps 8000 / 3000. Pictures are inline SVGs per category (no Wikipedia fetch). Appearance-only cards say "Family only, not the exact SKU". Bench shows average AI wait.
- **Walk mode** (`shared/src/walkMerge.ts`): AI only when the phone pauses on a view with no barcode just read, at most one call per 2 s, pauses after 30 calls. Repeats are merged by serial, or by name against the previous frame.
- **Hardware check**: `scripts/bench-report.sh` (smartctl, dmidecode, lspci) posts to `POST /api/hardware-reports` with the session's 6-digit bench PC code. Drives and DIMMs are matched by serial and marked "via hardware check"; unmatched ones are added; CPUs and cards are returned as sightings only.
- **Production basics**: sign-in with name + `TEAM_PASSCODE` (signed cookie), `AI_DAILY_BUDGET_USD` (default $5, 429 when reached), JSON log lines per AI call and error, offline queue for saves ("N waiting to sync").
- **Not built**: Cisco SN2INFO and Dell TechDirect lookups (their docs could not be fetched; not guessed), HPE/Lenovo lookups, DRAM chip-code decoding, photo storage, drive wipe gate.
- `npm test`: 160/160. `npm run e2e`: 84/84 (first cold run after changes had 3 timeouts that passed on rerun). Typecheck clean, build ok. Neon, live AI, real phone and the bench script on real hardware: **not checked**.

### Every component, and results that stay on screen — 2026-11-18
- Analyze view now lists every removable component, valuable or not. New groups: COOLING (coolers, heatsinks, fans), BOARD (motherboard, risers, backplanes, mezzanine, BMC modules), CHASSIS (rails, bezels, caddies). OTHER covers the rest. Only empty slots and loose screws are skipped.
- A CPU under its cooler counts as a CPU and a COOLING part. Close-ups identify unlabelled parts from logo, shape, fins and heat pipes, connectors and socket.
- Result cards (picture, price, recommendation) all stay on screen, newest first, with a Clear button that only clears the screen.
- `npm test`: 110/110. `npm run e2e`: 68/68. Typecheck clean, build ok. Live AI and real phone: **not checked**.

### Parts with no sticker, and drive labels — 2026-11-18
- Vision now returns `searchQuery` (most specific product name) and `estimatedPriceUsd` per part. Parts with no readable part number are priced by eBay search on that name (`ebay-description`), else the AI's range (`ai-estimate`). Both are labelled on screen and can never verify a part (`server/src/identify.ts`).
- Units carry `imageUrl` (eBay listing photo or a generic part-type picture), shown when the tech's own photo isn't kept (always on Vercel).
- Barcodes: Seagate PN (`1CH164-302`) is a part number, short number-only codes (date `13395`) are ignored, and the model number is preferred over vendor-internal PNs within one label.
- A label read in two goes fills in the same unit: a part-number-only unit gets the serial within 60 s, a serial-only unit gets the part number (`addUnit` in `server/src/store.ts`).
- Found-parts list no longer clears when the camera moves; rows show the AI's description, price and source, with Read label / Add by look.
- `npm test`: 95/95. `npm run e2e`: 64/64. Typecheck clean, build ok. Live AI and real phone: **not checked**.

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
