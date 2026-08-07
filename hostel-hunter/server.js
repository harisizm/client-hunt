// Hostel Hunter — local web server (no framework, plain node:http).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const store = require('./db');
const engine = require('./scraper');
const cfg = require('./config');
const { buildExport } = require('./exporter');

const PORT = cfg.PORT;
const PUBLIC = path.join(__dirname, 'public');

// ---- known phone numbers for duplicate marking (stored in the database) ----
let masterCount = 0;
function loadMasterPhones() {
  const set = store.allMasterNumbers();
  masterCount = set.size;
  engine.setMasterPhones(set);
  console.log(`${masterCount} known phone numbers loaded for duplicate marking.`);
}

// ---- SSE ----
const sseClients = new Set();
engine.emit = (event, data) => {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(msg);
};

// ---- helpers ----
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const readBody = req => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
});
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

// on startup, any hunt left "fetching"/"discovering" by a crash becomes resumable
for (const h of store.listHunts()) {
  if (['fetching', 'discovering', 'captcha', 'queued'].includes(h.status)) {
    store.clearRunStart(h.id); // time since the crash was not work
    store.setHuntStatus(h.id, 'paused');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  try {
    // ---- API ----
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    if (p === '/api/state' && req.method === 'GET') {
      return json(res, 200, {
        hunts: store.listHunts(),
        logs: store.recentLogs(150),
        busy: engine.busy,
        activeHuntId: engine.activeHuntId,
        queue: engine.queue,
        masterCount,
      });
    }
    if (p === '/api/hunts' && req.method === 'POST') {
      const b = await readBody(req);
      const keyword = (b.keyword || 'hostels').trim();
      const city = (b.city || '').trim(), area = (b.area || '').trim(), subarea = (b.subarea || '').trim();
      const locality = [subarea, area, city].filter(Boolean).join(' ');
      if (!locality) return json(res, 400, { error: 'Enter at least one of city / area / sub-area.' });
      const query = `${keyword} in ${locality}`;
      const hunt = store.createHunt({
        keyword, city, area, subarea, query,
        maxResults: b.maxResults, batchSize: b.batchSize, deep: b.deep, target: b.target,
      });
      engine.enqueue(hunt.id); // starts now, or waits its turn; monitor via SSE
      return json(res, 200, { hunt: store.getHunt(hunt.id), queued: engine.queue.length });
    }
    const huntMatch = p.match(/^\/api\/hunts\/(\d+)\/(fetch|pause|resume|cancel|solve|delete)$/);
    if (huntMatch && req.method === 'POST') {
      const id = Number(huntMatch[1]), action = huntMatch[2];
      const hunt = store.getHunt(id);
      if (!hunt) return json(res, 404, { error: 'Hunt not found' });
      if (action === 'fetch' || action === 'resume') {
        if (!['ready', 'paused', 'cancelled', 'done', 'error', 'queued'].includes(hunt.status)) {
          return json(res, 409, { error: `Cannot start from status "${hunt.status}".` });
        }
        if (url.searchParams.get('all') === '1') store.clearHuntLimit(id);
        engine.enqueue(id); // runs now if free, otherwise waits its turn
        return json(res, 200, { ok: true, queued: engine.queue.length });
      }
      if (action === 'delete') {
        engine.dequeue(id); // drop it from the waiting list first
        if (engine.busy && engine.activeHuntId === id) {
          // a captcha-paused search only *holds* the engine — safe to release and delete
          if (hunt.status === 'captcha') engine.activeHuntId = null;
          else return json(res, 409, { error: 'This search is still running — press Stop first, then delete it.' });
        }
        // Excel/CSV files the app made from this search go with it
        for (const ex of store.exportsInvolvingHunt(id)) {
          try { fs.unlinkSync(path.join(__dirname, 'exports', path.basename(ex.name))); } catch {}
          store.deleteExportRecord(ex.id);
        }
        store.deleteHunt(id);
        return json(res, 200, { ok: true });
      }
      if (action === 'pause') {
        if (engine.activeHuntId === id) engine.pause();
        else { engine.dequeue(id); store.setHuntStatus(id, 'paused'); engine.pushHunt(id); }
        return json(res, 200, { ok: true });
      }
      if (action === 'cancel') {
        if (engine.activeHuntId === id) engine.cancel();
        else { engine.dequeue(id); store.setHuntStatus(id, 'cancelled'); engine.pushHunt(id); }
        return json(res, 200, { ok: true });
      }
      if (action === 'solve') {
        if (hunt.status !== 'captcha') return json(res, 409, { error: 'No captcha pending.' });
        engine.openSolverWindow(id); // async
        return json(res, 200, { ok: true });
      }
    }
    if (p === '/api/export' && req.method === 'POST') {
      const b = await readBody(req);
      let huntIds = (b.huntIds || []).map(Number).filter(Boolean);
      if (!huntIds.length) huntIds = store.listHunts().map(h => h.id); // nothing ticked = everything
      if (!huntIds.length) return json(res, 400, { error: 'Nothing saved yet — run a search first.' });
      const out = await buildExport({ huntIds, format: b.format || 'xlsx', filters: b.filters || {} });
      return json(res, 200, { name: out.name, count: out.count, url: '/exports/' + encodeURIComponent(out.name) });
    }
    if (p.startsWith('/exports/') && req.method === 'GET') {
      const file = path.join(__dirname, 'exports', path.basename(decodeURIComponent(p)));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
      });
      return fs.createReadStream(file).pipe(res);
    }

    // ---- static ----
    let file = p === '/' ? '/index.html' : p;
    file = path.join(PUBLIC, path.normalize(file).replace(/^([.][.][\\/])+/, ''));
    if (file.startsWith(PUBLIC) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`\n  Hostel Hunter is ALREADY running — just open http://localhost:${PORT} in your browser.\n`);
    process.exit(0);
  }
  throw e;
});

loadMasterPhones();
server.listen(PORT, () => {
  const addr = `http://localhost:${PORT}`;
  console.log(`\n  Web 7 Labs — Hostel Hunter running at ${addr}\n`);
  if (cfg.AUTO_OPEN_BROWSER && !process.env.NO_OPEN) execFile('cmd', ['/c', 'start', '', addr], () => {});
});
