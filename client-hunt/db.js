// SQLite persistence via Node's built-in driver: no native deps to compile.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'hunter.db'));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS hunts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword       TEXT NOT NULL,
    city          TEXT DEFAULT '',
    area          TEXT DEFAULT '',
    subarea       TEXT DEFAULT '',
    query         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'discovering',
    total_found   INTEGER DEFAULT 0,
    fetched_count INTEGER DEFAULT 0,
    max_results   INTEGER DEFAULT 0,
    batch_size    INTEGER DEFAULT 10,
    error         TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    updated_at    TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS places (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    hunt_id       INTEGER NOT NULL REFERENCES hunts(id),
    name          TEXT DEFAULT '',
    phone         TEXT DEFAULT '',
    email         TEXT DEFAULT '',
    address       TEXT DEFAULT '',
    website       TEXT DEFAULT '',
    rating        REAL,
    reviews       INTEGER,
    category      TEXT DEFAULT '',
    plus_code     TEXT DEFAULT '',
    lat           TEXT DEFAULT '',
    lng           TEXT DEFAULT '',
    maps_url      TEXT DEFAULT '',
    discovered_at TEXT DEFAULT (datetime('now','localtime')),
    fetched_at    TEXT,
    fetch_error   TEXT DEFAULT '',
    dup_flag      INTEGER DEFAULT 0,
    dup_reason    TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_places_hunt ON places(hunt_id);

  CREATE TABLE IF NOT EXISTS logs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    hunt_id INTEGER,
    ts      TEXT DEFAULT (datetime('now','localtime')),
    level   TEXT DEFAULT 'info',
    message TEXT
  );
`);
try { db.exec('ALTER TABLE hunts ADD COLUMN deep INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE hunts ADD COLUMN finished_at TEXT'); } catch {}
try { db.exec('ALTER TABLE hunts ADD COLUMN work_seconds INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE hunts ADD COLUMN target INTEGER DEFAULT 0'); } catch {}
try {
  // marks that the "find places" stage ran to completion; an interrupted
  // discovery must restart from discovery, not skip ahead to collecting details
  db.exec('ALTER TABLE hunts ADD COLUMN discovery_done INTEGER DEFAULT 0');
  db.exec("UPDATE hunts SET discovery_done = 1 WHERE status = 'done'");
} catch {}
try { db.exec('ALTER TABLE hunts ADD COLUMN run_started_at TEXT'); } catch {}
// deep-search progress: which extra search is next, how many in a row found
// nothing, and the map centre: so a shutdown mid-deep-search resumes exactly
// where it stopped instead of starting the passes over
try { db.exec('ALTER TABLE hunts ADD COLUMN deep_pass INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE hunts ADD COLUMN deep_dry INTEGER DEFAULT 0'); } catch {}
try { db.exec("ALTER TABLE hunts ADD COLUMN deep_lat TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE hunts ADD COLUMN deep_lng TEXT DEFAULT ''"); } catch {}
db.exec(`
  CREATE TABLE IF NOT EXISTS exports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    hunt_ids   TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS master_numbers (
    phone    TEXT PRIMARY KEY,
    added_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// ---- hunts ----
const insertHunt = db.prepare(`
  INSERT INTO hunts (keyword, city, area, subarea, query, max_results, batch_size, deep, target)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const touchHunt = db.prepare(`UPDATE hunts SET updated_at = datetime('now','localtime') WHERE id = ?`);

function createHunt({ keyword, city, area, subarea, query, maxResults, batchSize, deep, target }) {
  const r = insertHunt.run(keyword, city, area, subarea, query, maxResults | 0, batchSize | 0, deep ? 1 : 0, target | 0);
  return getHunt(Number(r.lastInsertRowid));
}
function getHunt(id) {
  return db.prepare('SELECT * FROM hunts WHERE id = ?').get(id);
}
function listHunts() {
  return db.prepare('SELECT * FROM hunts ORDER BY id DESC').all();
}
const ACTIVE_STATUSES = ['discovering', 'fetching'];
function setHuntStatus(id, status, error = '') {
  const before = getHunt(id);
  db.prepare('UPDATE hunts SET status = ?, error = ? WHERE id = ?').run(status, error, id);
  if (ACTIVE_STATUSES.includes(status)) {
    // a work segment begins (or continues); a resume also clears the end stamp
    if (!before?.run_started_at) {
      db.prepare(`UPDATE hunts SET run_started_at = datetime('now','localtime') WHERE id = ?`).run(id);
    }
    db.prepare('UPDATE hunts SET finished_at = NULL WHERE id = ?').run(id);
  } else {
    // work segment ends: bank its seconds so paused time never counts
    if (before?.run_started_at) {
      // ROUND, not CAST: truncating would shave a second off every segment
      db.prepare(`UPDATE hunts SET
        work_seconds = work_seconds + CAST(ROUND((julianday(datetime('now','localtime')) - julianday(run_started_at)) * 86400) AS INTEGER),
        run_started_at = NULL WHERE id = ?`).run(id);
    }
    if (['done', 'cancelled', 'error'].includes(status)) {
      db.prepare(`UPDATE hunts SET finished_at = datetime('now','localtime') WHERE id = ?`).run(id);
    }
  }
  touchHunt.run(id);
}
function setDiscoveryDone(id, done) {
  db.prepare('UPDATE hunts SET discovery_done = ? WHERE id = ?').run(done ? 1 : 0, id);
}
function setDeepProgress(id, { pass, dry, lat, lng }) {
  if (pass !== undefined) db.prepare('UPDATE hunts SET deep_pass = ? WHERE id = ?').run(pass | 0, id);
  if (dry !== undefined) db.prepare('UPDATE hunts SET deep_dry = ? WHERE id = ?').run(dry | 0, id);
  if (lat !== undefined) db.prepare('UPDATE hunts SET deep_lat = ?, deep_lng = ? WHERE id = ?').run(String(lat), String(lng), id);
}
function clearHuntLimit(id) {
  db.prepare('UPDATE hunts SET max_results = 0 WHERE id = ?').run(id);
}
function clearRunStart(id) {
  // crash recovery: the elapsed time is unknowable, so drop the open segment
  db.prepare('UPDATE hunts SET run_started_at = NULL WHERE id = ?').run(id);
}
function setHuntTotals(id, { totalFound, fetchedCount }) {
  if (totalFound !== undefined) db.prepare('UPDATE hunts SET total_found = ? WHERE id = ?').run(totalFound, id);
  if (fetchedCount !== undefined) db.prepare('UPDATE hunts SET fetched_count = ? WHERE id = ?').run(fetchedCount, id);
  touchHunt.run(id);
}

// ---- places ----
const insertPlace = db.prepare(`
  INSERT INTO places (hunt_id, name, maps_url, category) VALUES (?, ?, ?, ?)`);
const updatePlaceDetail = db.prepare(`
  UPDATE places SET name=?, phone=?, email=?, address=?, website=?, rating=?, reviews=?,
    category=?, plus_code=?, lat=?, lng=?, fetched_at=datetime('now','localtime'),
    fetch_error='', dup_flag=?, dup_reason=? WHERE id=?`);

function addDiscoveredPlace(huntId, name, mapsUrl, category = '') {
  // dedupe within the hunt by Google's stable place id (deep-search tiles and
  // resumes rediscover the same places with slightly different URLs)
  const key = (mapsUrl.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || [])[1];
  const dup = key
    ? db.prepare('SELECT id FROM places WHERE hunt_id = ? AND instr(maps_url, ?) > 0').get(huntId, key)
    : db.prepare('SELECT id FROM places WHERE hunt_id = ? AND maps_url = ?').get(huntId, mapsUrl);
  if (dup) return null;
  const r = insertPlace.run(huntId, name, mapsUrl, category);
  return Number(r.lastInsertRowid);
}
function countPlaces(huntId) {
  return db.prepare('SELECT COUNT(*) c FROM places WHERE hunt_id = ?').get(huntId).c;
}
function pendingPlaces(huntId, limit) {
  return db.prepare(
    `SELECT * FROM places WHERE hunt_id = ? AND fetched_at IS NULL ORDER BY id LIMIT ?`
  ).all(huntId, limit | 0 || 100000);
}
function savePlaceDetail(placeId, d) {
  updatePlaceDetail.run(
    d.name || '', d.phone || '', d.email || '', d.address || '', d.website || '',
    d.rating ?? null, d.reviews ?? null, d.category || '', d.plusCode || '',
    d.lat || '', d.lng || '', d.dupFlag ? 1 : 0, d.dupReason || '', placeId);
}
function setPlaceError(placeId, msg) {
  // marks the row as attempted (fetched_at set) so the loop advances, but keeps the error
  db.prepare(`UPDATE places SET fetch_error = ?, fetched_at = datetime('now','localtime') WHERE id = ?`)
    .run(String(msg).slice(0, 300), placeId);
}
function fetchedCount(huntId) {
  return db.prepare('SELECT COUNT(*) c FROM places WHERE hunt_id = ? AND fetched_at IS NOT NULL').get(huntId).c;
}
function placesForHunts(huntIds) {
  const marks = huntIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT p.*, h.keyword, h.city, h.area, h.subarea, h.query
     FROM places p JOIN hunts h ON h.id = p.hunt_id
     WHERE p.hunt_id IN (${marks}) AND p.fetched_at IS NOT NULL ORDER BY p.hunt_id, p.id`
  ).all(...huntIds);
}
function findPhoneOwner(normPhone, excludePlaceId) {
  // matches on the normalized (last-10-digit) phone stored rows
  return db.prepare(
    `SELECT p.id, p.name, h.area, h.subarea FROM places p JOIN hunts h ON h.id=p.hunt_id
     WHERE p.id != ? AND p.phone != '' AND ? = substr(replace(replace(replace(p.phone,' ',''),'-',''),'+',''), -10)
     LIMIT 1`
  ).get(excludePlaceId, normPhone);
}
function findFetchedByKey(key, excludeHuntId) {
  // key is the stable Google place id (0x…:0x…) embedded in every maps URL;
  // the hunt columns ride along so the duplicate note can say which search
  return db.prepare(
    `SELECT p.*, h.subarea AS src_subarea, h.area AS src_area, h.city AS src_city
     FROM places p JOIN hunts h ON h.id = p.hunt_id
     WHERE p.hunt_id != ? AND p.fetched_at IS NOT NULL AND p.fetch_error = ''
     AND instr(p.maps_url, ?) > 0 ORDER BY p.id DESC LIMIT 1`
  ).get(excludeHuntId, key);
}
function findSimilarName(normName, huntId, excludePlaceId) {
  return db.prepare(
    `SELECT p.id, p.name FROM places p
     WHERE p.id != ? AND p.hunt_id = ? AND p.fetched_at IS NOT NULL
       AND lower(replace(replace(p.name,' ',''),'-','')) = ? LIMIT 1`
  ).get(excludePlaceId, huntId, normName);
}

function deleteHunt(id) {
  db.prepare('DELETE FROM places WHERE hunt_id = ?').run(id);
  db.prepare('DELETE FROM logs WHERE hunt_id = ?').run(id);
  db.prepare('DELETE FROM hunts WHERE id = ?').run(id);
}

// ---- master numbers (the team's known phone list; DB is the source of truth) ----
function addMasterNumbers(phones) {
  const ins = db.prepare('INSERT OR IGNORE INTO master_numbers (phone) VALUES (?)');
  let added = 0;
  for (const p of phones) if (ins.run(p).changes) added++;
  return added;
}
function allMasterNumbers() {
  return new Set(db.prepare('SELECT phone FROM master_numbers').all().map(r => r.phone));
}

// ---- exports bookkeeping (so deleting a hunt can delete its files) ----
function recordExport(name, huntIds) {
  db.prepare('INSERT INTO exports (name, hunt_ids) VALUES (?, ?)').run(name, JSON.stringify(huntIds));
}
function exportsInvolvingHunt(huntId) {
  return db.prepare('SELECT * FROM exports').all()
    .filter(r => { try { return JSON.parse(r.hunt_ids).includes(huntId); } catch { return false; } });
}
function deleteExportRecord(id) {
  db.prepare('DELETE FROM exports WHERE id = ?').run(id);
}

// ---- logs ----
const insertLog = db.prepare('INSERT INTO logs (hunt_id, level, message) VALUES (?, ?, ?)');
function addLog(huntId, level, message) {
  insertLog.run(huntId, level, String(message).slice(0, 500));
}
function recentLogs(limit = 200) {
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit).reverse();
}

// ---- shutdown ----
function close() {
  // fold the WAL back into the main file so hunter.db alone is a full backup
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  try { db.close(); } catch {}
}

module.exports = {
  db, close, createHunt, getHunt, listHunts, setHuntStatus, clearRunStart, clearHuntLimit,
  setDiscoveryDone, setDeepProgress, setHuntTotals,
  addDiscoveredPlace, countPlaces, pendingPlaces, savePlaceDetail, setPlaceError, fetchedCount,
  placesForHunts, findPhoneOwner, findSimilarName, findFetchedByKey, deleteHunt,
  recordExport, exportsInvolvingHunt, deleteExportRecord,
  addMasterNumbers, allMasterNumbers, addLog, recentLogs,
};
