# Client Hunt: Setup & Quick Start Guide

How to install the app on any laptop, starting from a
completely fresh Windows machine (no VS Code, no Node, nothing needed).
Total time: ~10 minutes, most of it downloads.

---

## What you are installing

A lightweight local web app. It runs entirely on the laptop:

- **Node.js**: the only thing you install system-wide
- **This folder**: the app itself (`client-hunt/` + `Start Client Hunt.bat`)
- No accounts, no API keys, no Google login, nothing paid

---

## Step 1: Install Node.js (one time)

Either way works:

**Option A (fastest, no browsing):** open **PowerShell** and run

```powershell
winget install OpenJS.NodeJS.LTS
```

**Option B:** go to https://nodejs.org -> download the **LTS** installer
(`.msi`) -> run it -> Next, Next, Finish (all defaults are fine).

Then **close and reopen** PowerShell and check:

```powershell
node --version
```

You should see something like `v24.x`. If you get
"not recognized", reboot once: the installer updates PATH.

> The app needs Node **24 or newer** (it uses Node's built-in SQLite,
> which older versions hide behind an experimental flag). The current
> LTS installer from nodejs.org is already v24+.

---

## Step 2: Get this folder onto the laptop

Either way works:

- **From GitHub (no git needed):** open the repository page -> green
  **Code** button -> **Download ZIP** -> extract it on the laptop (the
  folder will be named `client-hunt-main`: rename it if you like).
- **Direct copy:** copy the whole folder via USB stick, network share, zip, or anything.

What must be inside:

```
client-hunt\
├── Start Client Hunt.bat       <- daily launcher
├── SETUP.md                    <- this file
├── README.md
└── client-hunt\
    ├── setup.bat               <- one-time installer
    ├── .env.example            <- all settings, documented
    ├── server.js, scraper.js, db.js, exporter.js, config.js
    ├── package.json
    └── public\  (the web page)
```

The app runs perfectly without a `.env` file: the built-in defaults are
the recommended settings. To tune something later (port, speed, rests...),
copy `.env.example` to `.env`, edit, and restart the app.

You do **not** need to copy `node_modules`, `data`, or `exports` (a GitHub
ZIP doesn't include them anyway): setup and first start recreate what is
needed. **Exception:** `data\hunter.db` holds everything collected so far
and the master phone list used for duplicate marking. To carry those to
the new laptop, copy `data\hunter.db` from the old machine into
`client-hunt\data\` after extracting.

---

## Step 3: Run the one-time setup

Double-click **`client-hunt\setup.bat`**.

It does two things (needs internet, takes a few minutes):

1. `npm install`: downloads the app libraries
2. Downloads the browser engine (~190 MB) the app uses in the background

When it prints "Setup complete", you are done installing.

---

## Step 4: First start & smoke test

1. Double-click **`Start Client Hunt.bat`**.
   A black window opens (this is the app running: leave it open),
   and the browser opens `http://localhost:3000` (or configured port) by itself.
2. If Windows Firewall asks, click **Allow** (it is a local-only server).
3. Test it: keyword `digital agencies`, City `London`, Area `Soho` ->
   **Find places**. Within ~10 seconds the log should narrate what it is
   doing and a count should appear.
4. Click **Download Excel**: an `.xlsx` should land in Downloads.

If all four happen, the install is good.

## Step 5: Make it easy for the team

- Right-click `Start Client Hunt.bat` -> **Send to -> Desktop (create
  shortcut)**. Rename the shortcut to "Client Hunt". That is the only
  thing the team ever touches.
- The 3 steps written on the page:
  **type the target niche and area -> Find places -> Download Excel.**
- Closing the black window is how you stop the app: it shuts down cleanly
  (nothing is lost, data is saved live, the port is freed). A search that was
  half-way shows as **paused** on the next start; pressing **Resume** continues
  it from the exact point it stopped, deep search included.

---

## Where things live (all inside `client-hunt\`)

| What | Where |
|---|---|
| All collected places (the database) | `data\hunter.db` |
| Generated Excel/CSV files | `exports\` |
| The app's own browser profile | `data\chrome-profile\` |
| All tunable settings (port, speed, rests, deep search...) | `.env`: create it by copying `.env.example`; edit + restart the app. |

The database is the single source of truth. Deleting `data\hunter.db` gives a clean, empty app
on the next start: it recreates itself automatically.

**Backup** = copy `data\hunter.db`. **Full reset** = delete the `data` folder.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node` not recognized after install | Reboot, or reopen PowerShell. |
| Black window says "ALREADY running" | The app is already open: just go to `http://localhost:3000`. |
| Page won't load at localhost | Is the black window open? If not, double-click the launcher. |
| Antivirus flags the browser download | It's Playwright's Chromium from Microsoft/Google CDNs: allow it. |
| "Google wants a quick human check" banner | Normal occasionally. Click **Fix it now**, tick the box in the window that opens, everything resumes alone. |
| Searches suddenly find 0 places | Google may have changed their page layout: selectors live in `scraper.js`. |
| Laptop has no internet during setup | Steps 1 and 3 need internet once. Daily use needs internet only to reach Google Maps. |

## Updating the app later

Replace the files inside `client-hunt\` (everything **except** the
`data\` and `exports\` folders) with the new version, then start as usual.
No reinstall needed unless `package.json` changed: in that case run `setup.bat` once more.

