# Hostel Hunter — Setup & Quick Start Guide (for the developer)

How to install the app on the marketing team's laptop, starting from a
completely fresh Windows machine (no VS Code, no Node, nothing needed).
Total time: ~10 minutes, most of it downloads.

---

## What you are installing

A small local web app. It runs entirely on the laptop:

- **Node.js** — the only thing you install system-wide
- **This folder** — the app itself (`hostel-hunter/` + the two `.bat` files)
- No accounts, no API keys, no Google login, nothing paid

---

## Step 1 — Install Node.js (one time)

Either way works:

**Option A (fastest, no browsing):** open **PowerShell** and run

```powershell
winget install OpenJS.NodeJS.LTS
```

**Option B:** go to https://nodejs.org → download the **LTS** installer
(`.msi`) → run it → Next, Next, Finish (all defaults are fine).

Then **close and reopen** PowerShell and check:

```powershell
node --version
```

You should see something like `v24.x`. If you get
"not recognized", reboot once — the installer updates PATH.

> The app needs Node **24 or newer** (it uses Node's built-in SQLite,
> which older versions hide behind an experimental flag). The current
> LTS installer from nodejs.org is already v24+.

---

## Step 2 — Copy this folder to the laptop

Copy the whole **`marketing`** folder (this folder) to the laptop, e.g. to
the Desktop. USB stick, network share, zip — anything.

What must be inside:

```
marketing\
├── Start Hostel Finder.bat     ← daily launcher
├── SETUP.md                    ← this file
└── hostel-hunter\
    ├── setup.bat               ← one-time installer
    ├── .env                    ← all settings (speed, port, rests…)
    ├── server.js, scraper.js, db.js, exporter.js, config.js
    ├── package.json
    └── public\  (the web page)
```

You do **not** need to copy `node_modules`, `data`, or `exports` if they
exist — setup recreates what's needed. (Copying `data\` DOES carry over all
previously collected places — copy it if you want to keep them.)

---

## Step 3 — Run the one-time setup

Double-click **`marketing\hostel-hunter\setup.bat`**.

It does two things (needs internet, takes a few minutes):

1. `npm install` — downloads the app's two libraries
2. Downloads the browser engine (~190 MB) the app uses invisibly

When it prints "Setup complete", you're done installing.

---

## Step 4 — First start & smoke test

1. Double-click **`marketing\Start Hostel Finder.bat`**.
   A black window opens (this is the app running — leave it open),
   and the browser opens `http://localhost:7777` by itself.
2. If Windows Firewall asks, click **Allow** (it's a local-only server).
3. Test it: keyword `hostels`, City `Lahore`, Area `Model Town` →
   **Find places**. Within ~10 seconds the log should narrate what it's
   doing and a count should appear; a minute later it says finished.
4. Click **⬇ Download Excel** — an `.xlsx` should land in Downloads.

If all four happen, the install is good.

## Step 5 — Make it easy for the team

- Right-click `Start Hostel Finder.bat` → **Send to → Desktop (create
  shortcut)**. Rename the shortcut to "Hostel Finder". That's the only
  thing the team ever touches.
- Tell them the 3 steps written on the page itself:
  **type the area → Find places → Download Excel.**
- Closing the black window stops the app (nothing is lost — data is saved
  live). Starting it again = double-click the shortcut.

---

## Where things live (all inside `hostel-hunter\`)

| What | Where |
|---|---|
| All collected places (the database) | `data\hunter.db` |
| Generated Excel/CSV files | `exports\` |
| The app's own browser profile | `data\chrome-profile\` |
| All tunable settings (port, speed, rests, deep search…) | `.env` — plain text, commented; edit + restart the app |

The database is the single source of truth (collected places, known master
numbers, search history). Deleting `data\hunter.db` gives a clean, empty app
on the next start — it recreates itself automatically.

**Backup** = copy `data\hunter.db`. **Full reset** = delete the `data`
folder (the team's downloaded Excel files are unaffected).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node` not recognized after install | Reboot, or reopen PowerShell. |
| Black window says "ALREADY running" | The app is already open — just go to `http://localhost:7777`. |
| Page won't load at localhost:7777 | Is the black window open? If not, double-click the launcher. |
| Antivirus flags the browser download | It's Playwright's Chromium from Microsoft/Google CDNs — allow it. |
| "Google wants a quick human check" banner | Normal occasionally. Click **Fix it now**, tick the box in the window that opens, everything resumes alone. |
| Searches suddenly find 0 places | Google may have changed their page layout — call the developer (selectors live in `scraper.js`). |
| Laptop has no internet during setup | Steps 1 and 3 need internet once. Daily use needs internet only to reach Google Maps. |

## Updating the app later

Replace the files inside `hostel-hunter\` (everything **except** the
`data\` and `exports\` folders) with the new version, then start as usual.
No reinstall needed unless `package.json` changed — in that case run
`setup.bat` once more.
