# Teardown Scanner PoC
Standalone proof of concept. Never connect to or write into company systems or databases.
Guide: https://claude.ai/artifact/K7J7Ros22QFpFVt6xMABrA

## How to work
- Build one feature at a time from docs/progress.md, in order.
- For each feature: write tests first, implement, run `npm test` and `npm run e2e`,
  then check it in Chrome (Claude in Chrome): walk the flow, read the console,
  screenshot desktop and 400px widths, record a GIF.
- Stop after each feature with a checkpoint summary and wait for the go.
- Never weaken or delete a test to make it pass. Report skipped checks as skipped.
- If a browser check fails twice or the extension stops responding, stop and ask.

## Rules
- Vision API is mocked (VISION_MODE=mock) in all automated tests.
- Test feed mode (?feed=) exists only in development builds.
- Don't commit or push unless asked.
- Descriptive names, no single-letter variables. One-line comments only.

## Layout
- shared/  pure functions (rules, dedup, catalog match, CSV), heavily unit tested
- server/  Node API, WebSocket rooms, local store, vision proxy
- web/     React + Vite app: /scan and /bench
- e2e/     Playwright tests, one file per feature
- fixtures/ label photos, bench clips, expected results, starter catalog CSV

## Commands
- npm run dev        HTTPS dev server (web + server, one process, https://localhost:5443)
- npm test           unit + API tests
- npm run e2e        Playwright (uses installed Chrome) with fake camera
- npm run typecheck  TypeScript check
- npm run vision:eval  real-API run over the photo set (manual, needs approval; added in F9)

## HTTPS
- Uses `.certs/cert.pem` + `.certs/key.pem` if present (e.g. from mkcert), otherwise generates a self-signed cert there.
- Phones need a trusted cert: `mkcert -install` then `mkcert -cert-file .certs/cert.pem -key-file .certs/key.pem localhost <laptop-LAN-IP>`.
