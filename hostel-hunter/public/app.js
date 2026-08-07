// Hostel Hunter front-end: renders state, listens to SSE, sends commands.
const $ = s => document.querySelector(s);

let hunts = [];
let activeHuntId = null;
let masterCount = 0;

// ---------- rendering ----------
function statusChip(s) {
  const labels = {
    queued: 'waiting in queue', discovering: 'searching…', ready: 'ready', fetching: 'getting details…',
    paused: 'paused', done: 'finished', cancelled: 'stopped',
    captcha: 'needs a check', error: 'problem',
  };
  return `<span class="status-chip st-${s}">${labels[s] || s}</span>`;
}

function renderActive() {
  const h = hunts.find(x => x.id === activeHuntId) ||
            hunts.find(x => ['discovering', 'fetching', 'ready', 'captcha'].includes(x.status)) ||
            hunts.find(x => x.status === 'queued') || hunts[0];
  const panel = $('#activePanel');
  if (!h) { panel.innerHTML = '<p class="muted">Nothing running. Fill the form on the left and click <b>Find places</b>.</p>'; return; }

  document.querySelector('.area-active').dataset.state = h.status;
  const pct = h.total_found ? Math.round(100 * h.fetched_count / h.total_found) : 0;
  const working = ['discovering', 'fetching'].includes(h.status);
  const started = parseSql(h.created_at), finished = parseSql(h.finished_at);
  let times = `Started <b class="t-accent">${fmt12(started)}</b>`;
  if (finished) times += ` &nbsp;·&nbsp; Finished <b class="t-green">${fmt12(finished)}</b> &nbsp;·&nbsp; Working time <b class="t-gold">${fmtDur(workMs(h))}</b>`;
  else if (working) times += ` &nbsp;·&nbsp; working for <b class="t-accent">${fmtDur(workMs(h))}</b>`;
  else if (workMs(h) > 0) times += ` &nbsp;·&nbsp; worked <b class="t-gold">${fmtDur(workMs(h))}</b> so far`;
  let body = `
    <p style="font-size:15px"><b>${esc(h.query)}</b> &nbsp;${statusChip(h.status)}${working ? ' <span class="spinner"></span>' : ''}</p>
    <div class="big-count">${h.status === 'discovering'
        ? `${h.total_found || 0} <small>found so far…${h.target ? ` (you expect ${h.target})` : ''}</small>`
        : `${h.fetched_count} <small>of ${h.total_found} places collected</small>`}</div>
    <div class="progress-outer"><div class="progress-inner" style="width:${pct}%"></div></div>
    <p class="times">${times}</p>`;
  if (h.status === 'done') {
    const pending = h.total_found - h.fetched_count;
    body += `<p class="done-note">✔ ${h.fetched_count} places saved — nothing lost.${pending > 0 ? ` ${pending} more can still be collected — press Continue.` : ' Ready to download.'}</p>`;
  }

  const btns = [];
  if (h.status === 'ready') btns.push(`<button class="btn btn-primary" onclick="cmd(${h.id},'fetch')">▶ Get details of ${h.total_found} places</button>`);
  if (h.status === 'fetching') btns.push(`<button class="btn" onclick="cmd(${h.id},'pause')">⏸ Pause</button>`, `<button class="btn" onclick="cmd(${h.id},'cancel')">✖ Stop</button>`);
  if (h.status === 'discovering') btns.push(`<button class="btn" onclick="cmd(${h.id},'cancel')">✖ Stop</button>`);
  if (h.status === 'paused') btns.push(`<button class="btn btn-primary" onclick="cmd(${h.id},'resume')">▶ Continue</button>`);
  if (h.status === 'queued') btns.push(`<button class="btn" onclick="cmd(${h.id},'cancel')">✖ Take out of queue</button>`);
  if (h.status === 'captcha') btns.push(`<button class="btn btn-danger" onclick="cmd(${h.id},'solve')">Fix it now</button>`);
  if (h.status === 'done' && h.fetched_count > 0) {
    btns.push(`<button class="btn btn-primary" onclick="quickExport(${h.id})">⬇ Download Excel</button>`);
    if (h.total_found - h.fetched_count > 0) {
      btns.push(`<button class="btn" onclick="cmd(${h.id},'resume',true)">▶ Get all the rest (${h.total_found - h.fetched_count})</button>`);
    }
  }
  btns.push(`<button class="btn btn-del" onclick="discardHunt(${h.id})">🗑 Discard</button>`);
  body += `<div class="active-actions">${btns.join('')}</div>`;
  if (h.error) body += `<p class="muted" style="color:#f87171;margin-top:8px">${esc(h.error)}</p>`;
  panel.innerHTML = body;

  $('#captchaBanner').classList.toggle('hidden', !hunts.some(x => x.status === 'captcha'));
  // a new search is never blocked any more — it just joins the queue
  const waiting = hunts.filter(x => x.status === 'queued').length;
  const badge = $('#queueBadge');
  badge.classList.toggle('hidden', waiting === 0);
  badge.textContent = waiting ? `${waiting} waiting in queue` : '';
  $('#btnStart').textContent = hunts.some(x => ['discovering', 'fetching'].includes(x.status))
    ? '➕ Add to queue' : '🔍 Find places';
}

function renderTable() {
  const picked = new Set([...document.querySelectorAll('.huntPick:checked')].map(c => c.value));
  const tb = $('#huntsTable tbody');
  tb.innerHTML = hunts.map(h => {
    const pending = h.total_found - h.fetched_count;
    const canResume = (['paused', 'cancelled', 'error', 'done'].includes(h.status) && pending > 0) || h.status === 'ready';
    const label = [h.subarea, h.area, h.city].filter(Boolean).join(', ');
    const running = ['discovering', 'fetching'].includes(h.status);
    if (h.status === 'queued') return `<tr class="row-queued">
      <td><input type="checkbox" class="huntPick" value="${h.id}" ${picked.has(String(h.id)) ? 'checked' : ''}></td>
      <td>${h.id}</td>
      <td title="${esc(h.query)}"><b>${esc(h.keyword)}</b> — ${esc(label || h.query)}</td>
      <td>${statusChip(h.status)}</td>
      <td class="muted">—</td><td class="muted">—</td>
      <td><span class="t-amber">in queue</span></td>
      <td class="muted">${esc((h.created_at || '').slice(0, 16))}</td>
      <td class="row-actions"><button class="btn btn-sm" onclick="cmd(${h.id},'cancel')">✖</button><button class="btn btn-sm btn-del" onclick="delHunt(${h.id}, ${h.fetched_count})">🗑</button></td>
    </tr>`;
    const took = h.finished_at
      ? `<span class="t-green">${fmtDur(workMs(h))}</span>`
      : running ? `<span class="t-accent">running…</span>` : '<span class="muted">—</span>';
    const savedCell = h.fetched_count === 0 ? `<span class="muted">0</span>`
      : pending > 0 ? `<span class="t-amber">${h.fetched_count}</span> <span class="muted">(${pending} left)</span>`
      : `<span class="t-green">${h.fetched_count}</span>`;
    return `<tr>
      <td><input type="checkbox" class="huntPick" value="${h.id}" ${picked.has(String(h.id)) ? 'checked' : ''}></td>
      <td>${h.id}</td>
      <td title="${esc(h.query)}"><b>${esc(h.keyword)}</b> — ${esc(label || h.query)}</td>
      <td>${statusChip(h.status)}</td>
      <td class="t-accent">${h.total_found}</td>
      <td>${savedCell}</td>
      <td>${took}</td>
      <td class="muted">${esc((h.created_at || '').slice(0, 16))}</td>
      <td class="row-actions">${h.fetched_count > 0 ? `<button class="btn btn-sm" title="download this search" onclick="rowExport(${h.id})">⬇</button>` : ''}${canResume ? `<button class="btn btn-sm" onclick="cmd(${h.id},'resume',true)">▶ ${h.status === 'ready' ? 'Get details' : 'Continue'}</button>` : ''}<button class="btn btn-sm btn-del" title="delete this search" onclick="delHunt(${h.id}, ${h.fetched_count})">🗑</button></td>
    </tr>`;
  }).join('');
}

// the "with selected" actions only make sense once something is ticked
function updateBulkBar() {
  const n = document.querySelectorAll('.huntPick:checked').length;
  $('#btnDownloadSel').textContent = `⬇ Download selected (${n})`;
  $('#btnDeleteSel').textContent = `🗑 Delete selected (${n})`;
  const all = document.querySelectorAll('.huntPick').length;
  const pickAll = $('#pickAll');
  pickAll.checked = all > 0 && n === all;
  pickAll.indeterminate = n > 0 && n < all;
}

function renderAreaDropdowns() {
  const fill = (sel, values, allLabel) => {
    const current = sel.value;
    sel.innerHTML = `<option value="">${allLabel}</option>` +
      values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if (values.some(v => v === current)) sel.value = current;
  };
  const uniq = key => [...new Map(hunts.filter(h => (h[key] || '').trim())
    .map(h => [h[key].trim().toLowerCase(), h[key].trim()])).values()].sort();
  fill($('#fArea'), uniq('area'), 'all areas');
  fill($('#fSubarea'), uniq('subarea'), 'all sub-areas');
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// "2026-08-07 17:21:35" (local PKT clock) -> Date / "5:21 PM" / "4 min"
function parseSql(s) { return s ? new Date(s.replace(' ', 'T')) : null; }
function fmt12(d) {
  if (!d) return '';
  let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
// active working time only: banked seconds + the currently-open segment.
// Hunts finished before work-time tracking existed fall back to start→finish.
function workMs(h) {
  let ms = (h.work_seconds || 0) * 1000;
  if (h.run_started_at) ms += Date.now() - parseSql(h.run_started_at);
  if (!ms && h.finished_at) ms = parseSql(h.finished_at) - parseSql(h.created_at);
  return ms;
}
function fmtDur(ms) {
  if (ms < 0 || !Number.isFinite(ms)) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} sec`;
  const min = Math.floor(s / 60);
  if (min < 60) { const rs = s % 60; return rs ? `${min} min ${rs} sec` : `${min} min`; }
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

// colour by what the line MEANS, not just its level
function logClass(level, message) {
  if (level === 'error') return 'log-error';
  if (/verification|captcha/i.test(message)) return 'log-error';
  if (level === 'warn') return 'log-warn';
  if (/^✗/.test(message)) return 'log-error';
  if (/^✓/.test(message)) return /possible duplicate/i.test(message) ? 'log-dup' : 'log-place';
  if (/^\+\d+ new place/.test(message)) return 'log-new';
  if (/complete|finished:|Search finished|fully saved/i.test(message)) return 'log-success';
  if (/already saved|copied instantly/i.test(message)) return 'log-copy';
  if (/rest so Google/i.test(message)) return 'log-rest';
  if (/Looking deeper|deeper \(/i.test(message)) return 'log-deep';
  if (/queue/i.test(message)) return 'log-queue';
  if (/Starting hunt|Opening Google|Page loaded|Results list|Resuming/i.test(message)) return 'log-step';
  return 'log-info';
}

function addLog({ level, message, ts }) {
  const el = document.createElement('div');
  el.className = `log-line ${logClass(level, message)}`;
  el.innerHTML = `<span class="log-ts">${esc(ts || '')}</span>${esc(message)}`;
  const panel = $('#logPanel');
  panel.appendChild(el);
  while (panel.children.length > 400) panel.removeChild(panel.firstChild);
  panel.scrollTop = panel.scrollHeight;
}

// ---------- data ----------
async function refresh() {
  const r = await fetch('/api/state').then(r => r.json());
  hunts = r.hunts; activeHuntId = r.activeHuntId; masterCount = r.masterCount;
  $('#masterInfo').textContent = masterCount ? `${masterCount} known numbers — repeats get marked automatically` : '';
  renderActive(); renderTable(); renderAreaDropdowns(); updateBulkBar();
  if (!window._logsLoaded) {
    window._logsLoaded = true;
    (r.logs || []).forEach(l => addLog({ level: l.level, message: l.message, ts: (l.ts || '').slice(11, 16) }));
  }
}

// in-app modal: appConfirm resolves true/false, appInfo just shows a message
function showModal(message, { okText = 'OK', cancelText = 'Cancel', showCancel = true, danger = false } = {}) {
  return new Promise(resolve => {
    const ov = $('#modalOverlay'), ok = $('#modalOk'), cancel = $('#modalCancel');
    $('#modalText').textContent = message;
    ok.textContent = okText;
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    cancel.textContent = cancelText;
    cancel.classList.toggle('hidden', !showCancel);
    ov.classList.remove('hidden');
    const done = val => { ov.classList.add('hidden'); cleanup(); resolve(val); };
    const onOk = () => done(true), onCancel = () => done(false);
    const onKey = e => { if (e.key === 'Escape') done(false); };
    const onOutside = e => { if (e.target === ov) done(false); };
    function cleanup() {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      ov.removeEventListener('click', onOutside);
    }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
    ov.addEventListener('click', onOutside);
  });
}
const appConfirm = (msg, opts) => showModal(msg, { danger: true, okText: 'Yes, delete', ...opts });
const appInfo = msg => showModal(msg, { showCancel: false });

// discard = stop the run (if running) and throw away everything it collected
window.discardHunt = async id => {
  const h = hunts.find(x => x.id === id);
  const n = h ? h.fetched_count : 0;
  const running = h && ['discovering', 'fetching'].includes(h.status);
  const msg = `Discard this search?\n\n` +
    (running ? `It will be stopped, and ` : '') +
    (n > 0 ? `all its progress — ${n} places collected so far — will be deleted, along with any Excel files the app made from it.`
           : `it will be removed completely.`) +
    `\nCopies already saved in your Downloads folder are safe.`;
  if (!await appConfirm(msg, { okText: 'Yes, discard it' })) return;
  if (running) {
    await fetch(`/api/hunts/${id}/cancel`, { method: 'POST' }).catch(() => {});
    addLog({ level: 'info', message: 'Stopping the search before discarding…', ts: new Date().toLocaleTimeString() });
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const s = await fetch('/api/state').then(r => r.json()).catch(() => null);
      const cur = s && s.hunts.find(x => x.id === id);
      if (!cur || !['discovering', 'fetching'].includes(cur.status)) break;
    }
  }
  cmd(id, 'delete');
};

window.delHunt = async (id, count) => {
  const msg = count > 0
    ? `Delete this search?\n\nIts ${count} saved places will be removed, and Excel files the app made from it will be deleted too.\nCopies already saved in your Downloads folder are safe.`
    : 'Delete this search?';
  if (!await appConfirm(msg)) return;
  cmd(id, 'delete');
};

// one shared export flow: builds the file and starts the download in one click.
// Single-search downloads ignore the Area/Sub-area dropdowns (the search itself
// already says which area the user wants).
async function doExport(ids, ignoreAreaFilters = false) {
  const out = $('#exportResult'), btn = $('#btnExport');
  const area = ignoreAreaFilters ? '' : $('#fArea').value;
  const subarea = ignoreAreaFilters ? '' : $('#fSubarea').value;

  let what;
  if (ids.length === 1) {
    const h = hunts.find(x => x.id === ids[0]);
    what = h ? `${h.keyword} — ${[h.subarea, h.area, h.city].filter(Boolean).join(', ') || h.query}` : 'this search';
  } else if (ids.length) {
    what = `${ids.length} selected searches`;
  } else {
    what = 'all your searches';
    if (subarea) what += ` — ${subarea} only`;
    else if (area) what += ` — ${area} only`;
  }
  btn.disabled = true;
  out.innerHTML = `<span class="spinner"></span> Preparing your file (${esc(what)})…`;
  out.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const body = {
    huntIds: ids, // empty = everything
    format: $('#fFormat').value,
    filters: {
      area, subarea,
      minRating: parseFloat($('#fMinRating').value) || 0,
      minReviews: parseInt($('#fMinReviews').value) || 0,
      gender: $('#fGender').value,
      categoryInclude: $('#fCatInc').value,
      categoryExclude: $('#fCatExc').value,
      dateFrom: $('#fDateFrom').value,
      dateTo: $('#fDateTo').value,
      hasPhone: $('#fHasPhone').checked,
      excludeDuplicates: $('#fNoDups').checked,
    },
  };
  try {
    const r = await fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
    if (r.error) { out.textContent = r.error; return; }
    if (!r.count) { out.textContent = 'No places match these filters — try removing some filters.'; return; }
    const a = document.createElement('a');
    a.href = r.url; a.download = r.name;
    document.body.appendChild(a); a.click(); a.remove();
    out.innerHTML = `✔ Downloading <b>${esc(r.name)}</b> (${r.count} places) — check your browser's download bar. <a href="${r.url}">download again</a>`;
  } catch (e) {
    out.textContent = 'Something went wrong — please try again.';
  } finally {
    btn.disabled = false;
  }
}

window.rowExport = id => doExport([id], true);
window.quickExport = id => doExport([id], true);

const isBusy = () => hunts.some(x => ['discovering', 'fetching'].includes(x.status));

window.cmd = async (id, action, all) => {
  // only one search may talk to Google at a time — parallel runs risk a ban
  if (['resume', 'fetch'].includes(action) && isBusy()) {
    const ok = await showModal(
      'A search is already running.\n\nOnly one can run at a time, otherwise Google may block us.\nShall I add this one to the queue instead? It will start automatically when the current one finishes.',
      { okText: 'Yes, add to queue' });
    if (!ok) return;
  }
  const r = await fetch(`/api/hunts/${id}/${action}${all ? '?all=1' : ''}`, { method: 'POST' }).then(r => r.json());
  if (r.error) addLog({ level: 'error', message: r.error, ts: new Date().toLocaleTimeString() });
  refresh();
};

// ---------- events ----------
$('#huntForm').addEventListener('submit', async e => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = {
    keyword: f.get('keyword'), city: f.get('city'), area: f.get('area'), subarea: f.get('subarea'),
    maxResults: Number(f.get('maxResults')) || 0, batchSize: Number(f.get('batchSize')) || 10,
    deep: !!f.get('deep'), target: Number(f.get('target')) || 0,
  };
  const r = await fetch('/api/hunts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  if (r.error) { addLog({ level: 'error', message: r.error, ts: new Date().toLocaleTimeString() }); return; }
  refresh();
});

$('#btnSolve').addEventListener('click', () => {
  const h = hunts.find(x => x.status === 'captcha');
  if (h) cmd(h.id, 'solve');
});
$('#btnClearLog').addEventListener('click', () => { $('#logPanel').innerHTML = ''; });
$('#pickAll').addEventListener('change', e => {
  document.querySelectorAll('.huntPick').forEach(c => { c.checked = e.target.checked; });
  updateBulkBar();
});
$('#huntsTable').addEventListener('change', e => {
  if (e.target.classList.contains('huntPick')) updateBulkBar();
});

$('#btnDownloadSel').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.huntPick:checked')];
  if (!ids.length) { await appInfo('Tick at least one search first — or just press the big Download Excel button on the right to get everything.'); return; }
  $('#btnExport').click();
  $('#btnExport').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('#btnDownloadAll').addEventListener('click', () => doExport([])); // [] = every search

$('#btnResumeSel').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.huntPick:checked')].map(c => Number(c.value));
  if (!ids.length) { await appInfo('Tick at least one search first (use the top checkbox to select all).'); return; }
  const todo = hunts.filter(h => ids.includes(h.id) &&
    (h.total_found - h.fetched_count > 0 || h.status === 'ready') &&
    !['discovering', 'fetching'].includes(h.status));
  if (!todo.length) { await appInfo('The selected searches are already complete — nothing left to collect.'); return; }
  addLog({ level: 'info', message: `Continuing ${todo.length} search${todo.length > 1 ? 'es' : ''} one by one…`, ts: new Date().toLocaleTimeString() });
  for (const h of todo) {
    const r = await fetch(`/api/hunts/${h.id}/resume`, { method: 'POST' }).then(r => r.json()).catch(() => ({ error: 'failed' }));
    if (r.error) { addLog({ level: 'warn', message: `Search #${h.id}: ${r.error}`, ts: new Date().toLocaleTimeString() }); continue; }
    // only one search can talk to Google at a time — wait for this one to finish
    await new Promise(res => {
      const t = setInterval(async () => {
        const s = await fetch('/api/state').then(r => r.json()).catch(() => null);
        const cur = s && s.hunts.find(x => x.id === h.id);
        if (!cur || !['discovering', 'fetching'].includes(cur.status)) { clearInterval(t); res(); }
      }, 3000);
    });
  }
  addLog({ level: 'info', message: 'All selected searches are done.', ts: new Date().toLocaleTimeString() });
  refresh();
});

$('#btnDeleteSel').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('.huntPick:checked')].map(c => Number(c.value));
  if (!ids.length) { await appInfo('Tick at least one search first (use the top checkbox to select all).'); return; }
  const places = hunts.filter(h => ids.includes(h.id)).reduce((n, h) => n + h.fetched_count, 0);
  const msg = `Delete ${ids.length} search${ids.length > 1 ? 'es' : ''}?\n\n` +
    (places > 0 ? `Their ${places} saved places will be removed, and Excel files the app made from them will be deleted too.\n` : '') +
    `Copies already saved in your Downloads folder are safe.`;
  if (!await appConfirm(msg)) return;
  const problems = [];
  for (const id of ids) {
    const r = await fetch(`/api/hunts/${id}/delete`, { method: 'POST' }).then(r => r.json()).catch(() => ({ error: 'failed' }));
    if (r.error) problems.push(`#${id}: ${r.error}`);
  }
  $('#pickAll').checked = false;
  if (problems.length) addLog({ level: 'warn', message: `Some could not be deleted — ${problems.join(' · ')}`, ts: new Date().toLocaleTimeString() });
  else addLog({ level: 'info', message: `Deleted ${ids.length} search${ids.length > 1 ? 'es' : ''}.`, ts: new Date().toLocaleTimeString() });
  refresh();
});

$('#btnExport').addEventListener('click', () => {
  const ids = [...document.querySelectorAll('.huntPick:checked')].map(c => Number(c.value));
  doExport(ids);
});

// SSE live updates
const es = new EventSource('/api/events');
es.addEventListener('log', e => addLog(JSON.parse(e.data)));
es.addEventListener('hunt', () => refresh());
es.addEventListener('place', () => refresh());
es.addEventListener('discover-progress', e => {
  const d = JSON.parse(e.data);
  const h = hunts.find(x => x.id === d.huntId);
  // never let the on-screen count go backwards mid-search
  if (h && d.count >= (h.total_found || 0)) { h.total_found = d.count; renderActive(); }
});
es.addEventListener('captcha', () => refresh());
es.addEventListener('queue', () => refresh());

refresh();
setInterval(refresh, 15000); // safety net if SSE drops
// live "running for…" clock while a search is active
setInterval(() => {
  if (hunts.some(x => ['discovering', 'fetching'].includes(x.status))) renderActive();
}, 1000);
