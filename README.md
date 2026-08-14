# Client Hunt: Automated Lead Generation & Business Discovery

Finds businesses and sales prospects on Google Maps in bulk and exports them to Excel: name, phone,
address, website, rating, reviews, and category, replacing hours of manual copy-and-paste for marketing and sales teams.

Works for any industry, niche, or business type in any city worldwide.

**No Google login. No API key. No paid service. Runs entirely on your computer.**

![status](https://img.shields.io/badge/platform-Windows-blue) ![status](https://img.shields.io/badge/cost-free-brightgreen)

---

## What it does

1. You type what to look for and where (e.g. *digital agencies · London · Soho* or *clinics · New York · Brooklyn*).
2. It scrolls Google's result list, then deep-searches the target area from
   different angles (wording variants and expanding rings of map coordinates)
   as long as new places keep appearing. A single deep search often triples
   what a single manual query shows.
3. It opens every place and saves full contact details to a local SQLite database live:
   a crash, a stop, or a power cut loses nothing.
4. You click **Download Excel** and get clean, formatted sheets ready to work from.

Real numbers from testing: a standard search returned **33 places** while deep search extracted **164 to 190+ qualified leads** in minutes.

## What you get

📄 **[samples/sample-export.xlsx](samples/sample-export.xlsx)**: sample export with bold filterable headers, frozen top row, clickable map links, and duplicate flags.

Full column list: City · Area · Sub Area · Name · Phone · Email · Address ·
Website · Rating · Reviews · Category · Duplicate? · Duplicate Reason ·
Google Maps Link · Fetched At.

Files are named like `digital-agencies_manhattan_2026-08-07_6-30-15PM.xlsx` and land in
`client-hunt/exports/` as well as your browser's Downloads folder. CSV export is also available.

## The app

A single responsive page: search form on the left, live progress in the
middle, a color-coded activity log on the right, and your searches with
one-click export along the bottom.

## Features

- **One click**: discovery and detail collection run start to finish autonomously
- **Queue**: launch several areas; they run one at a time safely
- **Never loses data**: everything saves live as it is collected; pause, close the
  window or lose power anytime, and Resume continues from the exact point
- **Instant re-runs**: places already collected are recognised and copied from the
  database instantly instead of being re-scraped
- **Duplicate marking**: repeats are flagged with explicit reasons (same phone, same name), never deleted, and you choose filter options at export
- **Export filters**: area, sub-area, rating, reviews, phone-only, category filter, dates
- **Plain-language interface**: built for non-technical users, with live progress,
  a color-coded activity log, and hover explanations on every option and status
- **Handles Google verification**: pauses, alerts, one click to clear, then carries on automatically

## Install (Windows)

1. Install [Node.js](https://nodejs.org) **24 or newer** (LTS installer, all defaults).
2. Download or clone this repository.
3. Run `client-hunt/setup.bat` once: it installs the dependencies and browser engine.
4. Double-click **`Start Client Hunt.bat`**. The app opens in your browser.

Full step-by-step instructions, including a fresh-laptop checklist and
troubleshooting, are in **[SETUP.md](SETUP.md)**.
The user guide is in **[client-hunt/README.md](client-hunt/README.md)**.

To stop it: just close the black window. The app shuts down cleanly: data,
browser and port are all released, and a half-finished search resumes from the
exact same point next time.

## Configuration

All settings live in `client-hunt/.env`: copy `.env.example` to `.env` and edit.
Times are in seconds. The app runs fine without the file, using built-in defaults.

## How it is built

| Part | Choice |
|---|---|
| Engine | Node.js + Playwright (headless Chromium) |
| Storage | SQLite via Node's built-in `node:sqlite`: single source of truth |
| Excel/CSV | ExcelJS |
| Interface | Plain `node:http` server + vanilla JS, no framework |

Zero complex build steps, lightweight local desktop architecture.

## Notes

- **This is a local desktop-style app, not a cloud app.** It runs on a persistent disk
  and an ordinary internet connection.
- It reads Google Maps paced with human-like delays and rest periods.
- Google Maps does not publish private direct emails on map pins, so email is populated when publicly exposed.

## Licence

MIT License. Open for customization for any sales & marketing department.

