// Loads .env (same folder) over the built-in defaults. No dependencies.
// Times in .env are in SECONDS; the exported *_MS values are what code uses.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  PORT: 7777,
  AUTO_OPEN_BROWSER: true,

  PLACE_DELAY_MIN_SEC: 0.35,
  PLACE_DELAY_MAX_SEC: 0.9,
  REST_MIN_SEC: 4,
  REST_MAX_SEC: 6,
  CAPTCHA_RETRY_MINUTES: 3,

  SCROLL_STEP_MIN_SEC: 0.45,
  SCROLL_STEP_MAX_SEC: 0.7,
  FEED_STALL_TIMEOUT_SEC: 15,

  DEEP_TILE_OFFSET: 0.012,
  DEEP_TILE_ZOOM: 15,
  DEEP_STOP_AFTER_EMPTY: 4,

  HEADLESS: true,
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const raw = parseEnvFile(path.join(__dirname, '.env'));
const cfg = {};
for (const [key, def] of Object.entries(DEFAULTS)) {
  const v = raw[key];
  if (v === undefined || v === '') { cfg[key] = def; continue; }
  if (typeof def === 'boolean') cfg[key] = /^(true|yes|1)$/i.test(v);
  else if (typeof def === 'number') cfg[key] = Number.isFinite(Number(v)) ? Number(v) : def;
  else cfg[key] = v;
}

// millisecond values for the code
const sec = s => Math.round(s * 1000);
cfg.PLACE_DELAY_MIN_MS = sec(cfg.PLACE_DELAY_MIN_SEC);
cfg.PLACE_DELAY_MAX_MS = sec(cfg.PLACE_DELAY_MAX_SEC);
cfg.REST_MIN_MS = sec(cfg.REST_MIN_SEC);
cfg.REST_MAX_MS = sec(cfg.REST_MAX_SEC);
cfg.SCROLL_STEP_MIN_MS = sec(cfg.SCROLL_STEP_MIN_SEC);
cfg.SCROLL_STEP_MAX_MS = sec(cfg.SCROLL_STEP_MAX_SEC);
cfg.FEED_STALL_TIMEOUT_MS = sec(cfg.FEED_STALL_TIMEOUT_SEC);

module.exports = cfg;
