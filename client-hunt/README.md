# Client Hunt - Lead Generation & Discovery Engine

Finds businesses and leads on Google Maps and exports names, phones, addresses,
websites, ratings, and categories to Excel/CSV automatically, in bulk, and for free.

## Daily use

1. Double-click **`Start Client Hunt.bat`**.
   A black window opens (leave it open) and the app appears in your browser.
2. Type what to search (e.g. digital agencies, real estate, clinics) and the **City / Area / Sub-area**
   (e.g. New York / Brooklyn / Downtown). Click **Find places**.
3. The app scrolls Google's full result list, shows **how many it found**,
   and starts fetching phone numbers and addresses automatically.
4. Watch the live progress bar and log. Pause or cancel anytime:
   **everything fetched is already saved**, nothing is ever lost.
5. When done, click **Download Excel** (or tick searches in the table), set any filters
   (min rating, only-with-phone, category match, exclude duplicates, dates...)
   and click **Download Excel** -> download your formatted Excel file. One sheet per area.
6. Finished for the day? Just **close the black window**: the app stops
   cleanly and everything stays saved.

## If a red banner appears ("verification")

Google occasionally asks to confirm you are human. Click **Fix now**,
a browser window opens on the checkbox: click it, the window closes itself
and the search continues. If nobody clicks, the app retries by itself after
a few minutes.

## Good to know

- Runs 100% on your computer. **No Google login, no API key, no paid subscription.**
- Your mouse and screen stay free: the browser engine runs quietly in the background.
- Duplicates are **flagged, never deleted**: the duplicate reason note tells you exactly which
  place or phone number it matched. Use the export filter to hide them if desired.
- The deep search has no fixed limit: it keeps trying new searches for as long
  as new places appear, and stops only after several in a row find nothing new.
- Small batches + human-like pacing keep Google relaxed. If a search is
  interrupted (window closed, crash, power cut), just press **Resume**: it
  continues exactly where it stopped, even in the middle of a deep search.
- All data lives in `client-hunt/data/hunter.db`; exports in `client-hunt/exports/`.

## First-time setup on a new PC

Install Node.js (nodejs.org, LTS), then run `client-hunt/setup.bat` once.

