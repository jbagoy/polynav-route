/**
 * PolyNav phone page (plain JavaScript, no build step).
 *
 * Addresses:
 *   #/r/<destination id>?v=<data version>   a route from the kiosk (what the QR code opens)
 *   #/ (or nothing)                          search all destinations
 *
 * Every route was worked out ahead of time by scripts/build-phone-site.js and saved
 * as data/routes/<id>.json, so this page never talks to the kiosk.
 */
(function () {
  'use strict';

  const MAP_W = 2576;
  const MAP_H = 1358;
  const STEP_ZOOM_WIDTH = 320; // map pixels across in "Follow step" (about 140 m)
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LAST_ROUTE_KEY = 'polynav:lastRoute';

  const app = document.getElementById('app');
  let index = null;      // data/index.json
  let cleanup = [];      // things to undo when leaving a page

  // ---------- small helpers ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* private mode: not saved, nothing breaks */ }
    return null;
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  async function loadIndex() {
    if (!index) index = await getJSON('data/index.json');
    return index;
  }

  function parseHash() {
    const raw = location.hash.replace(/^#/, '') || '/';
    const [path, query = ''] = raw.split('?');
    const params = new URLSearchParams(query);
    const m = path.match(/^\/r\/([^/]+)$/);
    return m ? { page: 'route', id: decodeURIComponent(m[1]), version: params.get('v') } : { page: 'home' };
  }

  function leave() {
    cleanup.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
    cleanup = [];
  }

  function showStatus(title, message, action) {
    app.innerHTML = `
      <section class="status">
        ${title ? `<strong>${esc(title)}</strong>` : '<span class="spinner"></span>'}
        <p>${esc(message)}</p>
        ${action ? `<a class="btn btn-primary" style="display:inline-grid;place-items:center;text-decoration:none" href="${action.href}">${esc(action.label)}</a>` : ''}
      </section>`;
  }

  // ---------- router ----------
  async function render() {
    leave();
    const where = parseHash();
    if (where.page === 'route') return showRoute(where.id, where.version);
    return showHome();
  }

  // ---------- home: search ----------
  async function showHome() {
    showStatus('', 'Loading…');
    try {
      await loadIndex();
    } catch (e) {
      return showStatus('Can’t load PolyNav', 'Check your internet connection, then reload this page.');
    }
    const last = store(LAST_ROUTE_KEY);
    const lastDest = last && index.destinations.find((d) => d.id === last);

    app.innerHTML = `
      <section class="home">
        <h1>Find your way around PUP Sta. Mesa</h1>
        <p>Routes start at the PolyNav kiosk at ${esc(cleanName(index.kiosk.name))}. Scan the QR code on the kiosk screen, or search below.</p>
      </section>
      ${lastDest ? `<a class="last-route" href="#/r/${encodeURIComponent(lastDest.id)}">Continue: route to ${esc(lastDest.name)} ›</a>` : ''}
      <input class="search" type="search" placeholder="Search a room, office or building" aria-label="Search destinations" autocomplete="off" />
      <ul class="results"></ul>
      <p class="foot">${index.destinations.length} destinations · map data ${esc(index.version)}</p>`;

    const input = app.querySelector('.search');
    const list = app.querySelector('.results');
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { list.innerHTML = ''; return; }
      const words = q.split(/\s+/);
      // Best matches first: whole phrase in the name, then name starts with it, then all words anywhere
      const score = (d) => {
        const name = d.name.toLowerCase();
        if (name === q) return 0;
        if (name.startsWith(q)) return 1;
        if (name.includes(q)) return 2;
        if (words.every((w) => name.includes(w))) return 3;
        return 4;
      };
      const hits = index.destinations
        .filter((d) => {
          const hay = `${d.name} ${d.building || ''} ${d.floor || ''}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        .map((d) => [score(d), d])
        .sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length)
        .map(([, d]) => d)
        .slice(0, 30);
      list.innerHTML = hits.length
        ? hits.map((d) => `<li><a href="#/r/${encodeURIComponent(d.id)}"><strong>${esc(d.name)}</strong><span>${esc([d.floor, d.building].filter(Boolean).join(' · '))}</span></a></li>`).join('')
        : '<li class="foot">No matches. Try a room number or building name.</li>';
    };
    input.addEventListener('input', draw);
  }

  function cleanName(name) {
    return String(name || '').replace(/^MAIN\s*-?\s*/i, '').trim() || 'Main entrance';
  }

  // ---------- route page ----------
  async function showRoute(id, version) {
    showStatus('', 'Loading your route…');
    let route;
    try {
      [, route] = await Promise.all([loadIndex(), getJSON(`data/routes/${encodeURIComponent(id)}.json`)]);
    } catch (e) {
      if (e.status === 404) {
        return showStatus('Route not found', 'This destination isn’t on the PolyNav phone site. Search for it instead, or scan the QR code at the kiosk again.', { href: '#/', label: 'Search destinations' });
      }
      return showStatus('Can’t load your route', 'Check your internet connection, then try again. Once a route has opened, it keeps working without signal.', { href: location.hash, label: 'Try again' });
    }
    store(LAST_ROUTE_KEY, id);

    const steps = route.steps;
    const dest = route.destination;
    const place = [dest.floor, dest.building].filter(Boolean).join(' · ');
    const outdated = version && version !== index.version;
    const chips = [`${route.walkMinutes} min walk`, `${route.distanceMeters} m`];
    if (route.floorChanges) chips.push(`${route.floorChanges} ${route.floorChanges === 1 ? 'floor' : 'floors'} by stairs`);

    app.innerHTML = `
      <section class="dest">
        <p class="eyebrow">Route to</p>
        <h1>${esc(dest.name)}</h1>
        ${place ? `<p class="place">${esc(place)}</p>` : ''}
        <div class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
      </section>
      ${outdated ? '<p class="notice">The kiosk’s map was updated after this page was published, so a few steps may differ from the kiosk screen.</p>' : ''}
      <section class="map" aria-label="Route map"></section>
      <section class="step">
        <div class="step-head">
          <span class="step-count"></span>
          <span class="step-floor"></span>
        </div>
        <strong class="step-title"></strong>
        <p class="step-desc"></p>
        <div class="step-buttons">
          <button type="button" class="btn btn-secondary" data-act="prev">‹ Previous</button>
          <button type="button" class="btn btn-primary" data-act="next">Next ›</button>
        </div>
      </section>
      <section class="directions">
        <h2>All directions</h2>
        <ol>${route.directions.map((d, i) => `<li data-node="${esc(d.nodeId)}" data-i="${i}">${esc(d.text)}</li>`).join('')}</ol>
      </section>
      <p class="foot">Route from the PolyNav kiosk at ${esc(cleanName(index.kiosk.name))}. This page is saved on your phone and keeps working without signal.<br><a href="#/">Search another destination</a></p>`;

    const map = createRouteMap(app.querySelector('.map'), steps, dest.name);
    cleanup.push(() => map.destroy());

    let current = 0;
    const stepEl = app.querySelector('.step');
    const prevBtn = stepEl.querySelector('[data-act="prev"]');
    const nextBtn = stepEl.querySelector('[data-act="next"]');
    const items = Array.from(app.querySelectorAll('.directions li'));

    function show(i) {
      current = Math.max(0, Math.min(steps.length - 1, i));
      const s = steps[current];
      stepEl.querySelector('.step-count').textContent = `Step ${current + 1} of ${steps.length}`;
      stepEl.querySelector('.step-floor').textContent = s.building ? `${s.floorLabel} · ${s.building}` : (s.floorLabel || '');
      stepEl.querySelector('.step-title').textContent = s.title;
      stepEl.querySelector('.step-desc').textContent = s.description;
      prevBtn.disabled = current === 0;
      nextBtn.disabled = current === steps.length - 1;
      // Highlight the direction line that covers this step
      let active = -1;
      items.forEach((li, k) => {
        const at = steps.findIndex((st) => String(st.nodeId) === li.dataset.node);
        if (at !== -1 && at <= current) active = k;
      });
      items.forEach((li, k) => li.classList.toggle('active', k === active));
      map.setStep(current);
      keepScreenOn();
    }

    prevBtn.addEventListener('click', () => show(current - 1));
    nextBtn.addEventListener('click', () => show(current + 1));
    items.forEach((li) => li.addEventListener('click', () => {
      const at = steps.findIndex((st) => String(st.nodeId) === li.dataset.node);
      if (at !== -1) {
        show(at);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }));
    show(0);
  }

  // ---------- keep the screen on while walking (needs HTTPS, which GitHub Pages has) ----------
  let wakeLock = null;
  async function keepScreenOn() {
    try {
      if ('wakeLock' in navigator && !wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && parseHash().page === 'route') keepScreenOn();
  });

  // ---------- the map (same drawing as the kiosk's RouteMap.vue) ----------
  function createRouteMap(container, steps, destinationName) {
    const pts = steps.filter((s) => s.x != null && s.y != null).map((s) => ({ x: Number(s.x), y: Number(s.y) }));
    if (!pts.length) {
      container.innerHTML = '<div class="status" style="min-height:100%"><p>No map position for this route.</p></div>';
      return { setStep() {}, destroy() {} };
    }

    const el = (name, attrs = {}, parent) => {
      const node = document.createElementNS(SVG_NS, name);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
      if (parent) parent.appendChild(node);
      return node;
    };
    const toAttr = (list) => list.map((p) => `${p.x},${p.y}`).join(' ');
    const last = pts[pts.length - 1];
    const shortName = destinationName.length > 26 ? `${destinationName.slice(0, 25).trimEnd()}…` : destinationName;

    const svg = el('svg', { role: 'img', 'aria-label': `Route map to ${destinationName}`, preserveAspectRatio: 'xMidYMid meet' }, container);
    el('image', { href: 'campus-map.jpg', x: 0, y: 0, width: MAP_W, height: MAP_H }, svg);
    const casing = el('polyline', { points: toAttr(pts), class: 'route-casing draw', pathLength: 1 }, svg);
    const line = el('polyline', { points: toAttr(pts), class: 'route-line draw', pathLength: 1 }, svg);
    const done = el('polyline', { class: 'route-done' }, svg);
    const start = el('circle', { cx: pts[0].x, cy: pts[0].y, class: 'marker-start' }, svg);
    const end = el('circle', { cx: last.x, cy: last.y, class: 'marker-end' }, svg);
    const cur = el('g', { class: 'marker-current' }, svg);
    const pulse = el('circle', { class: 'pulse' }, cur);
    const dot = el('circle', { class: 'dot' }, cur);
    const labelStart = el('text', { class: 'map-label' }, svg);
    labelStart.textContent = 'Kiosk';
    const labelEnd = el('text', { class: 'map-label' }, svg);
    labelEnd.textContent = shortName;

    const badge = document.createElement('div');
    badge.className = 'floor-badge';
    container.appendChild(badge);

    const toggle = document.createElement('div');
    toggle.className = 'view-toggle';
    toggle.innerHTML = '<button type="button" data-mode="route" class="active">Full route</button><button type="button" data-mode="step">Follow step</button>';
    container.appendChild(toggle);

    let size = { w: container.clientWidth || 420, h: container.clientHeight || 300 };
    let mode = 'route';
    let step = 0;
    let view = { x: 0, y: 0, w: MAP_W, h: MAP_H };
    let frame = 0;

    function fitAspect(box) {
      const aspect = size.w / Math.max(size.h, 1);
      let { x, y, w, h } = box;
      if (w / h < aspect) { const nw = h * aspect; x -= (nw - w) / 2; w = nw; } else { const nh = w / aspect; y -= (nh - h) / 2; h = nh; }
      if (w <= MAP_W) x = Math.min(Math.max(x, 0), MAP_W - w);
      if (h <= MAP_H) y = Math.min(Math.max(y, 0), MAP_H - h);
      return { x, y, w, h };
    }

    function target() {
      if (mode === 'step') {
        const c = pts[Math.min(step, pts.length - 1)];
        return fitAspect({ x: c.x - STEP_ZOOM_WIDTH / 2, y: c.y - STEP_ZOOM_WIDTH / 2, w: STEP_ZOOM_WIDTH, h: STEP_ZOOM_WIDTH });
      }
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const span = Math.max(maxX - minX, maxY - minY, 160);
      const pad = span * 0.15 + 30;
      return fitAspect({ x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 });
    }

    function labelAt(text, p, gap, u) {
      const onRight = p.x < view.x + view.w * 0.55;
      text.setAttribute('x', onRight ? p.x + gap * u : p.x - gap * u);
      text.setAttribute('y', p.y + 4 * u);
      text.setAttribute('text-anchor', onRight ? 'start' : 'end');
      text.setAttribute('font-size', 12 * u);
      text.setAttribute('stroke-width', 4 * u);
    }

    // Keeps lines, dots and text the same size on screen at any zoom
    function paint() {
      const u = view.w / Math.max(size.w, 1);
      svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
      casing.setAttribute('stroke-width', 11 * u);
      line.setAttribute('stroke-width', 6 * u);
      done.setAttribute('stroke-width', 6 * u);
      start.setAttribute('r', 7 * u); start.setAttribute('stroke-width', 3 * u);
      end.setAttribute('r', 9 * u); end.setAttribute('stroke-width', 3 * u);
      pulse.setAttribute('r', 16 * u);
      dot.setAttribute('r', 8 * u); dot.setAttribute('stroke-width', 3 * u);
      labelAt(labelStart, pts[0], 12, u);
      labelAt(labelEnd, last, 14, u);
    }

    function animateTo(t) {
      cancelAnimationFrame(frame);
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce) { view = t; paint(); return; }
      const from = { ...view };
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min((now - t0) / 450, 1);
        const e = 1 - Math.pow(1 - k, 3);
        view = { x: from.x + (t.x - from.x) * e, y: from.y + (t.y - from.y) * e, w: from.w + (t.w - from.w) * e, h: from.h + (t.h - from.h) * e };
        paint();
        if (k < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    toggle.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b) return;
      mode = b.dataset.mode;
      toggle.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      animateTo(target());
    });

    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      if (r.width && r.height) { size = { w: r.width, h: r.height }; view = target(); paint(); }
    });
    observer.observe(container);
    view = target();
    paint();

    return {
      setStep(i) {
        step = i;
        const c = pts[Math.min(i, pts.length - 1)];
        cur.setAttribute('transform', `translate(${c.x} ${c.y})`);
        if (i > 0) done.setAttribute('points', toAttr(pts.slice(0, i + 1)));
        else done.removeAttribute('points');
        const s = steps[i];
        badge.textContent = s.building ? `${s.floorLabel} · ${s.building}` : (s.floorLabel || '');
        if (mode === 'step') animateTo(target());
      },
      destroy() { cancelAnimationFrame(frame); observer.disconnect(); },
    };
  }

  // ---------- start ----------
  window.addEventListener('hashchange', render);
  render();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline saving just won't be available */ });
  }
})();
