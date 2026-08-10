// Hunt engine: drives a persistent headless Chromium over Google Maps.
// One hunt runs at a time (deliberate — keeps traffic human-like).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const store = require('./db');
const cfg = require('./config');

const PROFILE_DIR = path.join(__dirname, 'data', 'chrome-profile');
const UA = cfg.USER_AGENT;

// pacing: human-ish jitter between places, cool-down between batches (.env)
const PLACE_DELAY_MS = [cfg.PLACE_DELAY_MIN_MS, cfg.PLACE_DELAY_MAX_MS];
const BATCH_COOLDOWN_MS = [cfg.REST_MIN_MS, cfg.REST_MAX_MS];
const CAPTCHA_AUTO_RETRY_MS = cfg.CAPTCHA_RETRY_MINUTES * 60 * 1000;

const rand = ([a, b]) => a + Math.floor(Math.random() * (b - a));
const sleep = ms => new Promise(r => setTimeout(r, ms));

class HuntEngine {
  constructor() {
    this.ctx = null;          // persistent browser context (headless)
    this.solverCtx = null;    // visible window during captcha solving
    this.activeHuntId = null;
    this.stopRequested = false;   // cancel
    this.pauseRequested = false;  // pause
    this.captchaUrl = null;
    this.emit = () => {};     // set by server: (event, data) => void
    this._retryTimer = null;
    this.queue = [];          // hunt ids waiting their turn
    this._draining = false;
  }

  log(huntId, level, message) {
    store.addLog(huntId, level, message);
    this.emit('log', { huntId, level, message, ts: new Date().toLocaleTimeString() });
  }
  pushHunt(huntId) { this.emit('hunt', store.getHunt(huntId)); }

  get busy() { return this.activeHuntId !== null; }

  async openBrowser() {
    if (this.ctx) return this.ctx;
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    this.ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: cfg.HEADLESS,
      viewport: { width: 1400, height: 900 },
      locale: 'en-US',
      userAgent: UA,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    // the data pane never needs pictures: dropping images/tiles/fonts makes
    // every page load several times lighter and faster
    await this.ctx.route('**/*', route => {
      const t = route.request().resourceType();
      if (t === 'image' || t === 'media' || t === 'font') return route.abort();
      return route.continue();
    });
    return this.ctx;
  }
  async closeBrowser() {
    if (this.ctx) { try { await this.ctx.close(); } catch {} this.ctx = null; }
  }

  isBlockedPage(url, bodyText) {
    return url.includes('/sorry/') ||
      /unusual traffic from your computer network/i.test(bodyText || '');
  }

  // ---- queue: searches run one at a time, extra ones wait their turn ----
  enqueue(huntId) {
    if (!this.queue.includes(huntId)) this.queue.push(huntId);
    const h = store.getHunt(huntId);
    if (h && this.activeHuntId !== huntId) {
      store.setHuntStatus(huntId, 'queued');
      if (this.busy) this.log(huntId, 'info', `Added to the queue — it will start when the current search finishes (${this.queue.length} waiting).`);
      this.pushHunt(huntId);
    }
    this.drain();
  }
  async drain() {
    if (this._draining) return;
    this._draining = true;
    try {
      while (this.queue.length && !this.busy) {
        const id = this.queue.shift();
        const h = store.getHunt(id);
        if (!h || h.status === 'cancelled') continue; // deleted or stopped while waiting
        this.emit('queue', { length: this.queue.length });
        // an unfinished "find places" stage is redone from the start; already
        // known places are recognised instantly, so nothing is re-collected
        if (!h.discovery_done) await this.run(id);
        else await this.fetchDetails(id);
      }
    } finally {
      this._draining = false;
      this.emit('queue', { length: this.queue.length });
    }
  }
  dequeue(huntId) {
    this.queue = this.queue.filter(id => id !== huntId);
  }

  // full run: discover, then roll straight into fetching — no extra click
  async run(huntId) {
    await this.discover(huntId);
    const h = store.getHunt(huntId);
    if (h && h.status === 'ready' && store.pendingPlaces(huntId, 1).length) {
      this.log(huntId, 'info', `Google found ${h.total_found} places — fetching details automatically…`);
      await this.fetchDetails(huntId);
    }
  }

  // -------- phase 1: discover --------
  async discover(huntId) {
    const hunt = store.getHunt(huntId);
    this.activeHuntId = huntId;
    this.stopRequested = false;
    this.pauseRequested = false;
    store.setHuntStatus(huntId, 'discovering');
    this.pushHunt(huntId);
    try {
      // every place seen on screen is saved as it appears (see scrapeFeed), so
      // a shutdown at any moment loses nothing
      let lastLoggedTotal = store.countPlaces(huntId);
      const saveBatch = listings => {
        let n = 0;
        for (const l of listings) if (store.addDiscoveredPlace(huntId, l.name, l.url, l.category)) n++;
        const total = store.countPlaces(huntId);
        store.setHuntTotals(huntId, { totalFound: total });
        this.emit('discover-progress', { huntId, count: total }); // authoritative, only grows
        if (total >= lastLoggedTotal + 15) { lastLoggedTotal = total; this.log(huntId, 'info', `…${total} places found so far`); }
        return n;
      };

      const ctx = await this.openBrowser();
      const page = await ctx.newPage();

      // a hunt shut down mid-deep-search skips the base search (its places are
      // already saved) and continues from the exact pass it stopped at
      const resuming = hunt.deep && (hunt.deep_pass | 0) > 0;
      if (resuming) {
        this.log(huntId, 'info', `Continuing the deep search from where it stopped — ${store.countPlaces(huntId)} places already found.`);
      } else {
        this.log(huntId, 'info', `Starting hunt: "${hunt.query}" — opening browser…`);
        const url = 'https://www.google.com/maps/search/' + encodeURIComponent(hunt.query) + '?hl=en';
        this.log(huntId, 'info', 'Opening Google Maps search…');
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        this.log(huntId, 'info', 'Page loaded — waiting for the results list…');
        // consent button rarely appears; click it if it does but never wait for it
        page.locator('button[aria-label*="Accept"], form[action*="consent"] button').first()
          .click({ timeout: 4000 }).catch(() => {});

        const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 4000)).catch(() => '');
        if (this.isBlockedPage(page.url(), bodyText)) {
          await page.close();
          return this.enterCaptchaState(huntId, url);
        }

        // query may resolve straight to a single place page
        if (page.url().includes('/maps/place/')) {
          const name = await page.locator('h1').first().textContent({ timeout: 15000 }).catch(() => hunt.query);
          store.addDiscoveredPlace(huntId, (name || '').trim(), page.url());
          store.setHuntTotals(huntId, { totalFound: 1 });
          store.setHuntStatus(huntId, 'ready');
          this.log(huntId, 'info', 'Google returned a single place for this query.');
          await page.close();
          this.activeHuntId = null;
          this.pushHunt(huntId);
          return;
        }

        this.log(huntId, 'info', 'Results list found — scrolling to load every place…');
        await this.scrapeFeed(page, huntId, saveBatch);
      }

      if (hunt.deep && !this.stopRequested && !this.pauseRequested) {
        // map centre: reuse the saved one on resume, otherwise work it out once
        let lat = parseFloat(hunt.deep_lat), lng = parseFloat(hunt.deep_lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          const m = page.url().match(/@(-?\d+\.\d+),(-?\d+\.\d+),/);
          if (m) { lat = +m[1]; lng = +m[2]; }
          else {
            const first = store.pendingPlaces(huntId, 1)[0];
            const c = first && first.maps_url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
            if (c) { lat = +c[1]; lng = +c[2]; }
          }
          if (Number.isFinite(lat) && Number.isFinite(lng)) store.setDeepProgress(huntId, { lat, lng });
        }
        const variants = this.buildVariantPasses(hunt);
        if (!Number.isFinite(lat)) this.log(huntId, 'warn', 'Could not work out the map position — only different wordings will be tried.');

        // no fixed number of passes: rings of map tiles spiral outwards for as
        // long as they keep producing new places, and stop only after
        // DEEP_STOP_AFTER_EMPTY searches in a row find nothing new
        const target = hunt.target | 0;
        let dry = hunt.deep_dry | 0;
        for (let i = hunt.deep_pass | 0; !this.stopRequested && !this.pauseRequested; i++) {
          const pass = this.deepPassAt(variants, hunt, lat, lng, i);
          if (!pass) break; // no map position → nothing beyond the wording variants
          const have = store.countPlaces(huntId);
          if (target && have >= target) {
            this.log(huntId, 'info', `Reached your target of ${target} places — stopping the deep search here.`);
            break;
          }
          this.log(huntId, 'info', `Looking deeper (search ${i + 1}) — ${have} found so far…`);
          let fresh = 0;
          try {
            await page.goto(pass.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            const probe = await page.evaluate(() => document.body.innerText.slice(0, 4000)).catch(() => '');
            if (this.isBlockedPage(page.url(), probe)) {
              // progress is saved first, so the hunt continues from this very
              // pass once the captcha is cleared
              store.setDeepProgress(huntId, { pass: i, dry });
              await page.close().catch(() => {});
              return this.enterCaptchaState(huntId, pass.url);
            }
            // scrapeFeed waits for the list; a pass without one (e.g. a redirect
            // straight to a single place) simply times out and is skipped
            fresh = await this.scrapeFeed(page, huntId, saveBatch, 15000);
          } catch {
            this.log(huntId, 'warn', `That search showed no list — skipped.`);
          }
          if (fresh > 0) { dry = 0; this.log(huntId, 'info', `+${fresh} new place${fresh > 1 ? 's' : ''} (${store.countPlaces(huntId)} total)`); }
          else dry++;
          store.setDeepProgress(huntId, { pass: i + 1, dry }); // survives a shutdown
          if (dry >= cfg.DEEP_STOP_AFTER_EMPTY) {
            this.log(huntId, 'info', `Nothing new in the last ${dry} searches — that is everything Google will show for this area.`);
            break;
          }
          await sleep(rand([800, 1500]));
        }
      }
      await page.close();

      const total = store.countPlaces(huntId);
      store.setHuntTotals(huntId, { totalFound: total });
      if (this.stopRequested) {
        store.setHuntStatus(huntId, 'cancelled');
        this.log(huntId, 'warn', `Search stopped — the ${total} places found are kept safe. Resume continues from this exact point.`);
      } else if (this.pauseRequested) {
        store.setHuntStatus(huntId, 'paused');
        this.log(huntId, 'info', `Search paused — the ${total} places found are kept safe. Resume continues from this exact point.`);
      } else {
        store.setDiscoveryDone(huntId, true);
        store.setHuntStatus(huntId, 'ready');
        const tgt = hunt.target | 0;
        this.log(huntId, 'info', `Search finished: ${total} different places found for this area.` +
          (tgt && total < tgt ? ` (You expected ${tgt} — Google does not list more than this for the words used. Try a smaller sub-area, e.g. block by block.)` : ''));
      }
    } catch (e) {
      store.setHuntStatus(huntId, 'error', e.message.split('\n')[0]);
      this.log(huntId, 'error', `Discovery failed: ${e.message.split('\n')[0]} — everything found so far is saved.`);
    } finally {
      if (store.getHunt(huntId)?.status !== 'captcha') this.activeHuntId = null;
      this.pushHunt(huntId);
    }
  }

  // Wording variants for a deep hunt — the cheapest-and-richest extra searches,
  // tried before the map tiles.
  buildVariantPasses(hunt) {
    const passes = [];
    const q = s => `https://www.google.com/maps/search/${encodeURIComponent(s)}?hl=en`;

    if (/hostel/i.test(hunt.keyword) && !/boys|girls/i.test(hunt.query)) {
      for (const v of ['boys', 'girls', 'student', 'working women'])
        passes.push({ url: q(`${v} ${hunt.query}`), label: `${v} variant` });
    }
    const locality = [hunt.subarea, hunt.area, hunt.city].filter(Boolean).join(' ');
    if (locality) {
      for (const v of ['near', 'in front of', 'best'])
        passes.push({ url: q(`${v} ${hunt.keyword} ${locality}`), label: `${v} wording` });
    }
    return passes;
  }

  // The i-th deep pass: wording variants first, then rings of map tiles
  // spiralling outwards without end (the dry-run counter is what stops them).
  // Deterministic in i, so a resumed hunt replays the exact same sequence.
  deepPassAt(variants, hunt, lat, lng, i) {
    if (i < variants.length) return variants[i];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // keyword-only queries follow the map position (a named-area query ignores
    // the viewport), so each shifted tile surfaces a different set of places
    const dirs = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
    const k = i - variants.length;
    const ring = Math.floor(k / dirs.length) + 1;
    const [dy, dx] = dirs[k % dirs.length];
    const d = cfg.DEEP_TILE_OFFSET * ring;
    const la = (lat + dy * d).toFixed(5), ln = (lng + dx * d).toFixed(5);
    return {
      url: `https://www.google.com/maps/search/${encodeURIComponent(hunt.keyword)}/@${la},${ln},${cfg.DEEP_TILE_ZOOM}z?hl=en`,
      label: `ring ${ring}`,
    };
  }

  // scrolls one results feed to its true end, handing every ~10 freshly loaded
  // cards to saveBatch as they appear — so a shutdown mid-scroll keeps
  // everything already seen. Returns how many places in this feed were new.
  async scrapeFeed(page, huntId, saveBatch, waitMs = 30000) {
    const extract = () => page.locator('a.hfpxzc').evaluateAll(links =>
      links.map(a => {
        // category from the result card: either "Category · address" or, for
        // lodging cards, a standalone line right after the rating line
        let category = '';
        const card = a.closest('div.Nv2PK') || a.parentElement;
        if (card) {
          const lines = card.innerText.split('\n').map(t => t.trim()).filter(Boolean);
          for (let j = 0; j < lines.length; j++) {
            const dot = lines[j].match(/^([A-Za-z][A-Za-z /&'’-]{2,28})\s*·/);
            if (dot && !/^(open|close)/i.test(dot[1])) { category = dot[1].trim(); break; }
            if (/^\d\.\d(\(|$)/.test(lines[j])) {
              const nxt = lines[j + 1] || '';
              if (/^[A-Za-z][A-Za-z /&'’-]{2,35}$/.test(nxt) && !/^(PKR|Rs|Open|Closed|Sponsored|Free|By )/i.test(nxt)) category = nxt;
              break;
            }
          }
        }
        return { name: a.getAttribute('aria-label') || '', url: a.href, category };
      }));

    await page.waitForSelector('div[role="feed"]', { timeout: waitMs });
    let added = 0, savedUpTo = 0;
    let prev = -1, lastGrowth = Date.now();
    for (let i = 0; i < 400; i++) {
      if (this.stopRequested || this.pauseRequested) break;
      const count = await page.locator('a.hfpxzc').count();
      if (count !== prev) { prev = count; lastGrowth = Date.now(); }
      if (count >= savedUpTo + 10) { added += saveBatch(await extract()); savedUpTo = count; }
      const end = await page.locator('div[role="feed"]').evaluate(el => /reached the end of the list/i.test(el.innerText)).catch(() => false);
      if (end) break;
      // Google sometimes takes a while to fetch the next page — judge by time
      // without growth, not by scroll attempts
      if (Date.now() - lastGrowth > cfg.FEED_STALL_TIMEOUT_MS) { this.log(huntId, 'warn', 'List stopped growing — taking what Google gave.'); break; }
      await page.locator('div[role="feed"]').evaluate(el => { el.scrollTop = el.scrollHeight; }).catch(() => {});
      await sleep(rand([cfg.SCROLL_STEP_MIN_MS, cfg.SCROLL_STEP_MAX_MS]));
    }
    added += saveBatch(await extract().catch(() => []));
    return added;
  }

  // -------- phase 2: fetch details --------
  async fetchDetails(huntId) {
    const hunt = store.getHunt(huntId);
    this.activeHuntId = huntId;
    this.stopRequested = false;
    this.pauseRequested = false;
    store.setHuntStatus(huntId, 'fetching');
    this.pushHunt(huntId);

    // fast-skip: places already collected by an earlier search are copied
    // instantly from the database instead of visiting Google again
    const copied = this.fastCopyKnown(huntId);
    if (copied) {
      store.setHuntTotals(huntId, { fetchedCount: store.fetchedCount(huntId) });
      this.log(huntId, 'info', `${copied} places were already saved from earlier searches — copied instantly, no waiting.`);
      this.pushHunt(huntId);
    }
    if (!store.pendingPlaces(huntId, 1).length) {
      store.setHuntStatus(huntId, 'done');
      this.log(huntId, 'info', `This area is already fully saved — ${store.fetchedCount(huntId)} places ready. Click "Download Excel" to get the file.`);
      this.activeHuntId = null;
      this.pushHunt(huntId);
      return;
    }

    const batchSize = hunt.batch_size > 0 ? hunt.batch_size : 10;
    // max_results limits THIS run (fast-copied places don't count against it);
    // a resume fetches the next chunk, so no place is ever unreachable
    const limit = hunt.max_results > 0 ? store.fetchedCount(huntId) + hunt.max_results : 0;

    try {
      const ctx = await this.openBrowser();
      const page = await ctx.newPage();
      let inBatch = 0;

      while (true) {
        if (this.stopRequested) { store.setHuntStatus(huntId, 'cancelled'); this.log(huntId, 'warn', 'Stopped — everything collected so far is saved.'); break; }
        if (this.pauseRequested) { store.setHuntStatus(huntId, 'paused'); this.log(huntId, 'info', 'Paused — resume anytime, nothing is lost.'); break; }

        const already = store.fetchedCount(huntId);
        if (limit && already >= limit) {
          store.setHuntStatus(huntId, 'done');
          this.log(huntId, 'warn', `Stopped because this search is set to "collect only ${hunt.max_results} at a time". ${already} saved, ${store.getHunt(huntId).total_found - already} still to go — press "Get all the rest" to finish them in one go.`);
          break;
        }
        const [next] = store.pendingPlaces(huntId, 1);
        if (!next) {
          store.setHuntStatus(huntId, 'done');
          this.log(huntId, 'info', `Hunt complete: ${already} places fetched & saved to the database — nothing lost. Tick the hunt below and press Export.`);
          break;
        }

        try {
          await page.goto(next.maps_url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          const bodyProbe = await page.evaluate(() => document.body.innerText.slice(0, 4000)).catch(() => '');
          if (this.isBlockedPage(page.url(), bodyProbe)) {
            await page.close().catch(() => {});
            return this.enterCaptchaState(huntId, next.maps_url);
          }
          await page.waitForSelector('h1', { timeout: 20000 });
          const d = await page.evaluate(() => {
            const $ = s => document.querySelector(s);
            const phoneBtn = $('button[data-item-id^="phone:tel:"]');
            const ratingBox = $('div.F7nice');
            let rating = null, reviews = null;
            if (ratingBox) {
              const t = ratingBox.textContent || '';
              const rm = t.match(/([0-9.]+)/); if (rm) rating = parseFloat(rm[1]);
              const vm = t.match(/\(([\d,]+)\)/); if (vm) reviews = parseInt(vm[1].replace(/,/g, ''), 10);
            }
            // email: only what the listing itself exposes (no site crawling)
            let email = '';
            const em = (document.body.innerText || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (em && !/google|gstatic|example/i.test(em[0])) email = em[0];
            return {
              name: ($('h1')?.textContent || '').trim(),
              phone: phoneBtn ? phoneBtn.getAttribute('data-item-id').replace('phone:tel:', '') : '',
              email,
              address: $('button[data-item-id="address"]')?.getAttribute('aria-label')?.replace(/^Address:\s*/, '') || '',
              website: $('a[data-item-id="authority"]')?.href || '',
              category: $('button.DkEaL')?.textContent?.trim() || $('button[jsaction*="category"]')?.textContent?.trim() || '',
              plusCode: $('button[data-item-id="oloc"]')?.getAttribute('aria-label')?.replace(/^Plus code:\s*/, '') || '',
              rating, reviews,
            };
          });
          const m = next.maps_url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
          d.lat = m ? m[1] : ''; d.lng = m ? m[2] : '';
          if (!d.category) d.category = next.category || ''; // card-derived fallback

          // loose dedupe: flag, never drop
          const dup = this.dupCheck(next.id, d, huntId);
          d.dupFlag = dup.flag; d.dupReason = dup.reason;

          store.savePlaceDetail(next.id, d);   // live save — survives crash/cancel
          const nFetched = store.fetchedCount(huntId);
          store.setHuntTotals(huntId, { fetchedCount: nFetched });
          this.emit('place', { huntId, place: { ...d, id: next.id }, fetched: nFetched, total: store.getHunt(huntId).total_found });
          this.log(huntId, 'info', `✓ ${d.name} ${d.phone ? '| ' + d.phone : '| no phone'}${dup.flag ? ' [possible duplicate]' : ''}`);
        } catch (e) {
          store.setPlaceError(next.id, e.message.split('\n')[0]);
          this.log(huntId, 'error', `✗ ${next.name || next.maps_url}: ${e.message.split('\n')[0]}`);
        }

        inBatch++;
        if (inBatch >= batchSize) {
          inBatch = 0;
          const cool = rand(BATCH_COOLDOWN_MS);
          this.log(huntId, 'info', `${batchSize} places done — taking a short ${Math.round(cool / 1000)}s rest so Google stays happy…`);
          this.emit('cooldown', { huntId, seconds: Math.round(cool / 1000) });
          await this.interruptibleSleep(cool);
        } else {
          await this.interruptibleSleep(rand(PLACE_DELAY_MS));
        }
      }
      await page.close().catch(() => {});
    } catch (e) {
      store.setHuntStatus(huntId, 'error', e.message.split('\n')[0]);
      this.log(huntId, 'error', `Fetch crashed: ${e.message.split('\n')[0]} — everything fetched so far is saved.`);
    } finally {
      if (store.getHunt(huntId).status !== 'captcha') this.activeHuntId = null;
      this.pushHunt(huntId);
    }
  }

  async interruptibleSleep(ms) {
    const step = 500;
    for (let t = 0; t < ms; t += step) {
      if (this.stopRequested || this.pauseRequested) return;
      await sleep(Math.min(step, ms - t));
    }
  }

  fastCopyKnown(huntId) {
    let copied = 0;
    for (const pl of store.pendingPlaces(huntId, 0)) {
      const key = (pl.maps_url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i) || [])[1];
      if (!key) continue;
      const prev = store.findFetchedByKey(key, huntId);
      if (!prev) continue;
      const src = [prev.src_subarea, prev.src_area, prev.src_city].filter(Boolean).join(', ');
      store.savePlaceDetail(pl.id, {
        name: prev.name, phone: prev.phone, email: prev.email, address: prev.address,
        website: prev.website, rating: prev.rating, reviews: prev.reviews,
        category: prev.category, plusCode: prev.plus_code, lat: prev.lat, lng: prev.lng,
        dupFlag: 1, dupReason: `already saved as "${prev.name}"${src ? ` in the ${src} search` : ''}`,
      });
      copied++;
    }
    return copied;
  }

  dupCheck(placeId, d, huntId) {
    const norm = (d.phone || '').replace(/\D/g, '').slice(-10);
    if (norm.length === 10) {
      if (this.masterPhones && this.masterPhones.has(norm)) {
        return { flag: 1, reason: `number ${d.phone} is already in the master contact list` };
      }
      const owner = store.findPhoneOwner(norm, placeId);
      if (owner) return { flag: 1, reason: `same phone as "${owner.name}"${owner.subarea || owner.area ? ` (${owner.subarea || owner.area})` : ''}` };
    }
    const nn = (d.name || '').toLowerCase().replace(/[\s\-]/g, '');
    if (nn) {
      const sim = store.findSimilarName(nn, huntId, placeId);
      if (sim) return { flag: 1, reason: `same name as "${sim.name}" in this search` };
    }
    return { flag: 0, reason: '' };
  }

  setMasterPhones(set) { this.masterPhones = set; }

  // -------- captcha handling --------
  async enterCaptchaState(huntId, url) {
    this.captchaUrl = url;
    store.setHuntStatus(huntId, 'captcha');
    this.pushHunt(huntId);
    this.log(huntId, 'error', `Google showed a verification (captcha). Click "Fix now" on this page — or wait, I will retry automatically in ${cfg.CAPTCHA_RETRY_MINUTES} minutes.`);
    this.emit('captcha', { huntId });
    await this.closeBrowser();
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this.autoRetry(huntId), CAPTCHA_AUTO_RETRY_MS);
  }

  async autoRetry(huntId) {
    const hunt = store.getHunt(huntId);
    if (!hunt || hunt.status !== 'captcha') return;
    this.log(huntId, 'info', 'Auto-retrying after cool-down…');
    await this.resumeAfterCaptcha(huntId);
  }

  // opens a VISIBLE window on the captcha for a human to click through
  async openSolverWindow(huntId) {
    // a second click must not open a second window — two browsers on the same
    // profile fight over its lock and crash (the flag also covers the moment
    // before the window handle exists)
    if (this.solverCtx || this._solverOpening) return;
    this._solverOpening = true;
    try {
      clearTimeout(this._retryTimer);
      await this.closeBrowser();
      this.solverCtx = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: false,
        viewport: { width: 1100, height: 800 },
        locale: 'en-US',
        userAgent: UA,
        args: ['--disable-blink-features=AutomationControlled'],
      });
      const page = await this.solverCtx.newPage();
      await page.goto(this.captchaUrl || 'https://www.google.com/maps?hl=en', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      this.log(huntId, 'info', 'Solver window opened — complete the verification there, the hunt resumes by itself.');
      // poll until the block is gone, then auto-close and resume
      for (let i = 0; i < 150; i++) {
        await sleep(2000);
        let cleared = false;
        try {
          const u = page.url();
          const body = await page.evaluate(() => document.body.innerText.slice(0, 4000));
          cleared = !this.isBlockedPage(u, body);
        } catch { break; } // window closed by user — treat as attempt done
        if (cleared) break;
      }
    } finally {
      try { if (this.solverCtx) await this.solverCtx.close(); } catch {}
      this.solverCtx = null;
      this._solverOpening = false;
    }
    await this.resumeAfterCaptcha(huntId);
  }

  async resumeAfterCaptcha(huntId) {
    const hunt = store.getHunt(huntId);
    if (!hunt || hunt.status !== 'captcha') return;
    this.activeHuntId = null;
    this.log(huntId, 'info', 'Resuming hunt from where it stopped…');
    if (!hunt.discovery_done) return this.run(huntId);
    return this.fetchDetails(huntId);
  }

  // -------- controls --------
  // the flags are only noticed at the next safe checkpoint (between places /
  // scroll steps), so flip the status to a transient "stopping…"/"pausing…"
  // right away — the user sees the click landed the same instant
  cancel() {
    const id = this.activeHuntId;
    const h = id && store.getHunt(id);
    if (h && ['discovering', 'fetching'].includes(h.status)) {
      store.setHuntStatus(id, 'stopping');
      this.log(id, 'warn', 'Stopping — letting the current step finish safely, a few seconds…');
      this.pushHunt(id);
    }
    this.stopRequested = true;
  }
  pause() {
    const id = this.activeHuntId;
    const h = id && store.getHunt(id);
    if (h && ['discovering', 'fetching'].includes(h.status)) {
      store.setHuntStatus(id, 'pausing');
      this.log(id, 'info', 'Pausing — letting the current step finish safely, a few seconds…');
      this.pushHunt(id);
    }
    this.pauseRequested = true;
  }

  // called when the black window is closed: stop the loops, free the browser,
  // and leave the running hunt as "paused" so Resume continues from that point.
  // Windows only grants a few seconds after the X is clicked, so no waiting.
  async shutdown() {
    const runningId = this.activeHuntId;
    this.stopRequested = true;
    this.pauseRequested = true;
    clearTimeout(this._retryTimer);
    if (this.solverCtx) { try { await this.solverCtx.close(); } catch {} this.solverCtx = null; }
    await this.closeBrowser();
    // closing the browser makes the hunt loops throw; whatever status they
    // wrote in the race, "paused" is the truth the next start should see
    const ids = new Set([runningId, ...this.queue].filter(Boolean));
    for (const id of ids) {
      const h = store.getHunt(id);
      if (h && !['done', 'ready'].includes(h.status)) store.setHuntStatus(id, 'paused');
    }
  }
}

module.exports = new HuntEngine();
