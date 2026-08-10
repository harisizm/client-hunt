# Hostel Hunter — Web 7 Labs Marketing Team

Finds hostels (or anything) on Google Maps and exports name, phone, address,
website, rating and more to Excel/CSV — automatically, in bulk, for free.

## Daily use

1. Double-click **`Start Hostel Finder.bat`** (in the `marketing` folder).
   A black window opens (leave it open) and the app appears in your browser.
2. Type what to search (**hostels**) and the **City / Area / Sub-area**
   (e.g. Lahore / Gulberg / C Block). Click **Find places**.
3. The app scrolls Google's full result list, shows **how many it found**,
   and starts fetching phone numbers and addresses automatically.
4. Watch the live progress bar and log. Pause or cancel anytime —
   **everything fetched is already saved**, nothing is ever lost.
5. When done, click **Export this hunt** (or tick hunts in the table), set any filters
   (min rating, only-with-phone, girls/boys, exclude duplicates, dates…)
   and click **Export** → download the Excel file. One sheet per area,
   named like `hostels_gulberg-c-block_2026-08-07_3-30-15PM.xlsx`.
6. Finished for the day? Just **close the black window** — the app stops
   cleanly and everything stays saved.

## If a red banner appears ("verification")

Google occasionally asks to confirm you're human. Click **Fix now**,
a browser window opens on the checkbox — click it, the window closes itself
and the hunt continues. If nobody clicks, the app retries by itself after
a few minutes.

## Good to know

- Runs 100% on this computer. **No Google login, no API key, no cost.**
- Your mouse and screen stay free — the browser it drives is invisible.
- Duplicates are **flagged, never deleted** — the note tells you exactly which
  place it matches (name and area). Use the export filter to hide them.
- The deep search has no fixed limit: it keeps trying new searches for as long
  as new places appear, and stops only after several in a row find nothing new.
- Small batches + human-like pauses keep Google happy. If a hunt is
  interrupted (window closed, crash, power cut), just press **Resume** — it
  continues exactly where it stopped, even in the middle of a deep search.
- All data lives in `hostel-hunter/data/hunter.db`; exports in
  `hostel-hunter/exports/`.

## First-time setup on a new PC

Install Node.js (nodejs.org, LTS), then run `hostel-hunter/setup.bat` once.
