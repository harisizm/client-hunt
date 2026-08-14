// Builds filtered xlsx / csv exports from the SQLite data.
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const store = require('./db');

const EXPORT_DIR = path.join(__dirname, 'exports');
fs.mkdirSync(EXPORT_DIR, { recursive: true });

const slug = s => (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function applyFilters(rows, f) {
  return rows.filter(r => {
    if (f.area && (r.area || '').trim().toLowerCase() !== f.area.trim().toLowerCase()) return false;
    if (f.subarea && (r.subarea || '').trim().toLowerCase() !== f.subarea.trim().toLowerCase()) return false;
    if (f.hasPhone && !r.phone) return false;
    if (f.minRating && !(r.rating >= f.minRating)) return false;
    if (f.minReviews && !(r.reviews >= f.minReviews)) return false;
    if (f.gender === 'girls' && !/girls?|female|ladies/i.test(r.name)) return false;
    if (f.gender === 'boys' && !/boys?|male/i.test(r.name)) return false;
    if (f.categoryInclude) {
      const terms = f.categoryInclude.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      if (terms.length && !terms.some(t => (r.category || '').toLowerCase().includes(t) || (r.name || '').toLowerCase().includes(t))) return false;
    }
    if (f.categoryExclude) {
      const terms = f.categoryExclude.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      if (terms.some(t => t && (r.category || '').toLowerCase().includes(t))) return false;
    }
    if (f.excludeDuplicates && r.dup_flag) return false;
    if (f.dateFrom && r.fetched_at && r.fetched_at.slice(0, 10) < f.dateFrom) return false;
    if (f.dateTo && r.fetched_at && r.fetched_at.slice(0, 10) > f.dateTo) return false;
    return true;
  });
}

const COLUMNS = [
  { header: 'City', key: 'city', width: 14 },
  { header: 'Area', key: 'area', width: 16 },
  { header: 'Sub Area', key: 'subarea', width: 16 },
  { header: 'Name', key: 'name', width: 34 },
  { header: 'Phone', key: 'phone', width: 15 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Address', key: 'address', width: 52 },
  { header: 'Website', key: 'website', width: 28 },
  { header: 'Rating', key: 'rating', width: 8 },
  { header: 'Reviews', key: 'reviews', width: 9 },
  { header: 'Category', key: 'category', width: 18 },
  { header: 'Duplicate?', key: 'dup', width: 11 },
  { header: 'Duplicate Reason', key: 'dup_reason', width: 32 },
  { header: 'Google Maps Link', key: 'maps_url', width: 40 },
  { header: 'Fetched At', key: 'fetched_at', width: 18 },
];

async function buildExport({ huntIds, format = 'xlsx', filters = {} }) {
  const raw = store.placesForHunts(huntIds).filter(r => !r.fetch_error);
  const rows = applyFilters(raw, filters);

  const hunts = huntIds.map(id => store.getHunt(id)).filter(Boolean);
  const keyword = slug(hunts[0]?.keyword) || 'places';
  const areaPart = (filters.subarea || filters.area)
    ? slug([filters.subarea, filters.area].filter(Boolean).join(' '))
    : hunts.length === 1
      ? slug([hunts[0].subarea, hunts[0].area, hunts[0].city].filter(Boolean).join(' ')) || 'all'
      : `${hunts.length}-areas`;
  const now = new Date();
  // 12-hour clock in the name, the way the team reads time: …_6-30-45PM
  const h12 = now.getHours() % 12 || 12;
  const ap = now.getHours() >= 12 ? 'PM' : 'AM';
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${h12}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}${ap}`;
  const base = `${keyword}_${areaPart}_${stamp}`;

  if (format === 'csv') {
    const esc = v => { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [COLUMNS.map(c => c.header).join(',')];
    for (const r of rows) {
      lines.push(COLUMNS.map(c => esc(c.key === 'dup' ? (r.dup_flag ? 'YES' : '') : r[c.key])).join(','));
    }
    const file = path.join(EXPORT_DIR, base + '.csv');
    fs.writeFileSync(file, '﻿' + lines.join('\r\n'), 'utf8'); // BOM so Excel opens UTF-8 right
    store.recordExport(path.basename(file), huntIds);
    return { file, name: path.basename(file), count: rows.length };
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Client Hunt - Lead Generation Engine';

  // one sheet per hunt (i.e. per area searched)
  const usedNames = new Set();
  for (const hunt of hunts) {
    const hRows = rows.filter(r => r.hunt_id === hunt.id);
    let sheetName = ([hunt.subarea, hunt.area, hunt.city].filter(Boolean).join(' ') || hunt.query).slice(0, 28) || `hunt ${hunt.id}`;
    let n = 2; const orig = sheetName;
    while (usedNames.has(sheetName.toLowerCase())) sheetName = `${orig} (${n++})`;
    usedNames.add(sheetName.toLowerCase());

    const ws = wb.addWorksheet(sheetName.replace(/[\\/*?:\[\]]/g, ' '));
    ws.columns = COLUMNS;
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FF1F2937' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF9' } };
    head.border = { bottom: { style: 'thin', color: { argb: 'FFB6C2D9' } } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: 'A1', to: { row: 1, column: COLUMNS.length } };

    for (const r of hRows) {
      const row = ws.addRow({ ...r, dup: r.dup_flag ? 'YES' : '' });
      if (r.dup_flag) row.font = { color: { argb: 'FF9A6700' } };
      const link = row.getCell('maps_url');
      if (r.maps_url) link.value = { text: 'open in maps', hyperlink: r.maps_url };
    }
    ws.addRow([]);
    const info = ws.addRow([`${hRows.length} places · query: "${hunt.query}" · exported ${now.toLocaleString()}`]);
    info.font = { italic: true, color: { argb: 'FF6B7280' } };
  }

  const file = path.join(EXPORT_DIR, base + '.xlsx');
  await wb.xlsx.writeFile(file);
  store.recordExport(path.basename(file), huntIds);
  return { file, name: path.basename(file), count: rows.length };
}

module.exports = { buildExport, EXPORT_DIR };
