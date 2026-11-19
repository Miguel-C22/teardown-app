# How the Teardown Scanner works

A short, plain guide to what the app does today and what costs money.

## The flow

The free steps run by themselves. You just move the phone over the parts and follow the line under the camera ("Hold still…", "Reading sticker…").

| Step | What happens | Cost |
|---|---|---|
| 1. Start | Point the phone at the server's tag. The teardown starts on its own. | Free |
| 2. Barcodes and QR codes | Read automatically while you move. | Free |
| 3. Sticker text | Hold still about a second on a label with no barcode, and the phone reads the printed text (P/N, S/N) by itself. | Free |
| 4. Name it | The part number is turned into a plain name, e.g. "Samsung 32GB DDR4 RDIMM". | Free |
| 5. Price it | From the built-in price list (and eBay once a key is added, which is also free). | Free |
| 6. Still unknown? | Tap **Find with AI**. It turns blue when the free steps couldn't read something, or parts are still missing. | **Paid** |
| 7. Hardware check (optional) | A bench PC reads the part's real model and serial. See below. | Free |
| 8. Done | Shows what was recorded and what's still missing; **Next server** starts the next one. | Free |

Buttons on the scan screen: **Find with AI**, **Done**, and a small **⚙ Settings** (part type, torch, show raw codes). Each result card has **Wrong? Remove** to take out a bad read.

## Accuracy safeguards

- A barcode is recorded only after it reads the same way twice in a row.
- Sticker text is recorded only when two separate reads agree, and unsure (low-confidence) text is ignored.
- A barcode next to a QR code always wins over what's inside the QR code.
- Parts the AI can't read fully are never recorded until you tap **Add** (or **Add all**), and appearance-only parts are marked "Family only, not the exact SKU".
- Anything not matched to a real part number and price stays REVIEW, never KEEP or RECYCLE.

## What costs money

- Only **Find with AI**. Each tap sends one photo to OpenAI, about 1–2 cents. The button shows how much AI this server has used.
- AI stops for the day once $5 is spent (set with `AI_DAILY_BUDGET_USD`). Everything else keeps working.
- The database (Neon) is on the free plan.

## Hardware check (bench PC, not the phone)

1. Plug the drive or RAM into a PC, or boot the server itself, from a Linux USB stick.
2. Run `sudo ./scripts/bench-report.sh https://<your-site> <code>`, where the 6-digit code is the **Bench PC code** shown on the bench screen.
3. The PC reads each part's real model and serial from the hardware and sends them to the app.

Parts the camera already found are matched by serial and marked **"via hardware check"**; parts it missed are added. CPUs and cards are listed but not added, because they have no serial to match. Use it when the camera isn't sure, or for proof before selling.

The PC needs `smartmontools`, `dmidecode`, `pciutils` and `curl`.

## Bench screen (best on a PC)

- Open `/bench` on a computer at the workbench. It updates every few seconds while the phone scans.
- It shows the parts, totals, what was seen but not recorded yet, the AI cost and wait, and the Bench PC code.
- **Export CSV** downloads a spreadsheet of everything recorded.
- It works on a phone too, but it's made for a bigger screen.

## Where the data lives

- **Neon (Postgres)** stores sessions, parts, AI counts and AI cost, so the phone and the bench see the same data and nothing is lost.
- The tables are created automatically the first time the app uses the database. No command needed.
- Without `DATABASE_URL` set in Vercel, the live site keeps data in memory only, and it can disappear.
