# Web 7 Labs — Client Hunt (Hostel Hunter)

Finds businesses on Google Maps in bulk and exports them to Excel — name, phone,
address, website, rating, reviews, category — replacing hours of manual
copy-and-paste for the marketing team.

Built for hostels in Lahore, but the keyword is free text, so it works for any
business type in any city.

**No Google login. No API key. No paid service. Runs entirely on one laptop.**

![status](https://img.shields.io/badge/platform-Windows-blue) ![status](https://img.shields.io/badge/cost-free-brightgreen)

---

## What it does

1. You type what to look for and where — *hostels · Lahore · Gulberg · C Block*.
2. It scrolls Google's whole result list, then keeps re-searching the area from
   different angles (wording variants and rings of nearby map positions) until
   nothing new turns up. A single search often triples what one Google query shows.
3. It opens every place and saves the details to a local database, live — a crash,
   a stop, or a power cut loses nothing.
4. You click **Download Excel** and get one sheet per area, ready to work from.

Real numbers from testing: Johar Town returned **33 places** from a plain Google
search and **164** with deep search on; Township returned **193**.

## What you get

📄 **[samples/sample-export.xlsx](samples/sample-export.xlsx)** — a real export,
trimmed to a few rows per sheet with phone digits masked.

One sheet per area, bold filterable headers, frozen top row, clickable map links,
and repeats tinted amber:

| City | Area | Name | Phone | Address | Rating | Reviews | Category |
|---|---|---|---|---|---|---|---|
| Lahore | Johar Town | THH - Hostel & Hotel Johar Town | 0300XXXXXXX | 120 R2 Johar, Block R2… | 4.5 | 327 | Hostel |
| Lahore | Johar Town | Lahore Hostel Johar Town | 0313XXXXXXX | House 158, Block D… | 4.1 | 96 | Hostel |
| Lahore | Township | Firdous Girls Hostel | 0335XXXXXXX | Block 2 Township… | 3.3 | 41 | Hostel |

Full column list: City · Area · Sub Area · Name · Phone · Email · Address ·
Website · Rating · Reviews · Category · Duplicate? · Duplicate Reason ·
Google Maps Link · Fetched At.

Files are named `hostels_johar-town_2026-08-07_1830.xlsx` and land in
`hostel-hunter/exports/` as well as your browser's Downloads folder. CSV is a
dropdown away.

## The app

A single white-on-black page: search form on the left, live progress in the
middle, a colour-coded activity log on the right, and your searches with
one-click export along the bottom.

```
┌──────────────────┬─────────────────────────┬──────────────────────────────┐
│  New search      │  Progress               │  What is happening           │
│  hostels         │  ● getting details…     │  Results list found…         │
│  Lahore          │                         │  +12 new places (164 total)  │
│  Johar Town      │      164 of 164         │  ✓ Lahore Hostel | 0313…     │
│  ☑ look deep     │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100%   │  ✓ Boys Hostel   | 0317…     │
│  [ Find places ] │  Started 5:41 PM ·      │  short 5s rest…              │
│                  │  Working time 2 min     │  Hunt complete: 164 saved    │
├──────────────────┴─────────────────────────┴──────────────────────────────┤
│  Your searches            ⬇ Download selected (2)     ⬇ Download everything│
│  #16  hostels — Township   finished   193 found   193 saved   3 min   ⬇ 🗑 │
│  #13  hostels — Johar Town finished   164 found   164 saved   4 min   ⬇ 🗑 │
└───────────────────────────────────────────────────────────────────────────┘
```

## Features

- **One click** — discovery and detail collection run start to finish on their own
- **Queue** — start several areas; they run one at a time, safely
- **Never loses data** — everything saves as it is collected; pause and continue anytime
- **Instant re-runs** — places already collected are recognised and copied from the
  database instead of being fetched again
- **Duplicate marking** — repeats are flagged, never deleted, and you choose at export
- **Export filters** — area, sub-area, rating, reviews, phone-only, boys/girls, dates
- **Plain-language interface** — built for non-technical users, with live progress and colour-coded activity log
- **Handles Google's human check** — pauses, alerts, one click to clear, then carries on

## Install (Windows)

1. Install [Node.js](https://nodejs.org) **24 or newer** (LTS installer, all defaults).
2. Download or clone this repository.
3. Run `hostel-hunter/setup.bat` once — it installs the packages and the browser engine.
4. Double-click **`Start Hostel Finder.bat`**. The app opens in your browser.

Full step-by-step instructions, including a fresh-laptop checklist and
troubleshooting, are in **[SETUP.md](SETUP.md)**.
The day-to-day user guide is in **[hostel-hunter/README.md](hostel-hunter/README.md)**.

To stop it: close the black window, or double-click `Stop Hostel Finder.bat`.

## Configuration

All settings live in `hostel-hunter/.env` — copy `.env.example` to `.env` and edit.
Times are in seconds. The app runs fine without the file, using built-in defaults.

## How it is built

| Part | Choice |
|---|---|
| Engine | Node.js + Playwright (headless Chromium) |
| Storage | SQLite via Node's built-in `node:sqlite` — single source of truth |
| Excel/CSV | ExcelJS |
| Interface | Plain `node:http` server + vanilla JS, no framework |

Four dependencies total, no build step, no bundler.

## Notes

- **This is a local desktop-style app, not a cloud app.** It needs a long-running
  process, a persistent disk, and an ordinary internet connection — serverless
  hosts provide none of those, and Google treats datacenter addresses far more
  harshly than a normal office connection.
- It reads Google's public pages the way a person does, paced with delays and
  rest periods. Keep the pacing sensible; the defaults have been measured against
  real usage.
- Google Maps does not publish email addresses, so that column is usually empty —
  the same limitation the manual process has.

## Licence

Internal tool — © Web 7 Labs.
