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
    return m ? { page: 'route', id: decodeURIComponent(m[1]), version: params.get('v'), alt: params.get('alt') === '1' } : { page: 'home' };
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
    if (where.page === 'route') return showRoute(where.id, where.version, where.alt);
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
  async function showRoute(id, version, wantAlt) {
    showStatus('', 'Loading your route…');
    let route;
    try {
      let saved;
      [, saved] = await Promise.all([loadIndex(), getJSON(`data/routes/${encodeURIComponent(id)}.json`)]);
      // The recommended route, or its alternate (a second, different way there) when asked for
      route = wantAlt && saved.alternate ? { ...saved.alternate, alternate: saved.alternate } : saved;
      route.isAlt = Boolean(wantAlt && saved.alternate);
      route.altInfo = saved.alternate || null;
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
    const hasPhotos = steps.some((st) => st.photo);
    const chips = [`${route.walkMinutes} min walk`, `${route.distanceMeters} m`];
    if (route.floorChanges) chips.push(`${route.floorChanges} ${route.floorChanges === 1 ? 'floor' : 'floors'} by stairs`);
    const base = `#/r/${encodeURIComponent(id)}${version ? `?v=${encodeURIComponent(version)}` : '?'}`;
    const altSwitch = route.altInfo
      ? (route.isAlt
        ? `<a class="alt-switch" href="${base}">‹ Back to recommended route</a>`
        : `<a class="alt-switch" href="${base}&alt=1">Path blocked? Show alternate route (+${route.altInfo.extraMeters} m)</a>`)
      : '';

    app.innerHTML = `
      <section class="dest">
        <p class="eyebrow">Route to</p>
        <h1>${esc(dest.name)}</h1>
        ${place ? `<p class="place">${esc(place)}</p>` : ''}
        <div class="chips">${route.isAlt ? '<span class="alt-chip">Alternate route</span>' : ''}${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>
        ${altSwitch}
      </section>
      ${outdated ? '<p class="notice">The kiosk’s map was updated after this page was published, so a few steps may differ from the kiosk screen.</p>' : ''}
      <section class="map" aria-label="Route map"></section>
      <section class="step">
        <div class="step-head">
          <span class="step-count"></span>
          <span class="step-floor"></span>
        </div>
        ${hasPhotos ? `
        <div class="pano-wrap">
          <div class="pano"></div>
          <button type="button" class="pano-toggle" aria-expanded="true">Hide 360° view</button>
        </div>` : ''}
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

    // 360° photo of the current step (open by default, can be hidden to save data)
    let pano = null;
    let panoOpen = store('polynav:pano') !== 'off';
    const panoWrap = stepEl.querySelector('.pano-wrap');
    if (panoWrap) {
      const toggleBtn = panoWrap.querySelector('.pano-toggle');
      const panoEl = panoWrap.querySelector('.pano');
      const applyPano = () => {
        panoEl.hidden = !panoOpen;
        toggleBtn.textContent = panoOpen ? 'Hide 360° view' : 'Show 360° view of this spot';
        toggleBtn.setAttribute('aria-expanded', String(panoOpen));
        if (panoOpen && !pano) pano = createPanorama(panoEl);
        if (pano && panoOpen) pano.show(steps[current].photo, steps[current].nodeName);
      };
      toggleBtn.addEventListener('click', () => {
        panoOpen = !panoOpen;
        store('polynav:pano', panoOpen ? 'on' : 'off');
        applyPano();
      });
      cleanup.push(() => pano && pano.destroy());
      panoWrap.applyPano = applyPano;
    }
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
      if (panoWrap) {
        panoWrap.applyPano();
        // Start downloading the next photo so "Next" feels instant
        const nextPhoto = panoOpen && steps[current + 1] && steps[current + 1].photo;
        if (nextPhoto) { const img = new Image(); img.src = nextPhoto; }
      }
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

  // ---------- 360° viewer (plain WebGL, no library) ----------
  // Shows one equirectangular photo (2:1). Drag to look around, pinch or scroll to zoom.
  function createPanorama(container) {
    container.innerHTML = `
      <canvas class="pano-canvas"></canvas>
      <div class="pano-badge"></div>
      <div class="pano-msg" hidden></div>
      <div class="pano-hint">Drag to look around</div>`;
    const canvas = container.querySelector('canvas');
    const badge = container.querySelector('.pano-badge');
    const msg = container.querySelector('.pano-msg');
    const hint = container.querySelector('.pano-hint');

    const gl = canvas.getContext('webgl', { antialias: false }) || canvas.getContext('experimental-webgl');
    const say = (text) => { msg.hidden = !text; msg.innerHTML = text || ''; canvas.style.visibility = text ? 'hidden' : 'visible'; };
    if (!gl) {
      say('<strong>360° view isn’t supported on this phone</strong><span>Follow the map and directions.</span>');
      return { show(url, label) { badge.textContent = `360° · ${label || ''}`; }, destroy() {} };
    }

    const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
    const fs = `precision highp float;
      uniform sampler2D tex; uniform vec2 res; uniform float yaw; uniform float pitch; uniform float fov;
      const float PI = 3.14159265;
      void main() {
        vec2 q = (gl_FragCoord.xy / res) * 2.0 - 1.0;
        q.x *= res.x / res.y;
        vec3 d = normalize(vec3(q.x, q.y, 1.0 / tan(fov * 0.5)));
        float cp = cos(pitch), sp = sin(pitch);
        d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
        float cy = cos(yaw), sy = sin(yaw);
        d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
        float lon = atan(d.x, d.z);
        float lat = asin(clamp(d.y, -1.0, 1.0));
        gl_FragColor = texture2D(tex, vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI));
      }`;
    const shader = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = (n) => gl.getUniformLocation(prog, n);
    const uRes = U('res'), uYaw = U('yaw'), uPitch = U('pitch'), uFov = U('fov');
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Photos are not power-of-two sized, so: no mipmaps, clamp at the edges
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const DEG = Math.PI / 180;
    let yaw = 0, pitch = 0, fov = 85 * DEG;
    let hasImage = false;
    let raf = 0;
    let token = 0;
    let lastTouch = Date.now();

    function draw() {
      raf = 0;
      if (!hasImage) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uYaw, yaw);
      gl.uniform1f(uPitch, pitch);
      gl.uniform1f(uFov, fov);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

    // Slow turn when nobody has touched it for 8 seconds
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const spin = setInterval(() => {
      if (!reduceMotion && hasImage && Date.now() - lastTouch > 8000 && !document.hidden) { yaw += 0.004; redraw(); }
    }, 33);

    // Drag (one finger / mouse) and pinch (two fingers)
    const pointers = new Map();
    let pinchStart = 0, fovStart = fov;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastTouch = Date.now();
      hint.hidden = true;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        fovStart = fov;
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastTouch = Date.now();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart) fov = Math.min(100 * DEG, Math.max(30 * DEG, fovStart * pinchStart / dist));
      } else {
        const k = fov / Math.max(canvas.clientHeight, 1);
        yaw -= (e.clientX - prev.x) * k;
        pitch = Math.max(-85 * DEG, Math.min(85 * DEG, pitch + (e.clientY - prev.y) * k));
      }
      redraw();
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = 0; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      fov = Math.min(100 * DEG, Math.max(30 * DEG, fov * (e.deltaY > 0 ? 1.1 : 0.9)));
      lastTouch = Date.now();
      redraw();
    }, { passive: false });
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);

    return {
      show(url, label) {
        badge.textContent = `360° · ${label || ''}`;
        const my = ++token;
        if (!url) { hasImage = false; say('<strong>No 360° photo for this step</strong><span>Follow the map and directions.</span>'); return; }
        say(hasImage ? '' : '<span class="spinner"></span><span>Loading 360° view…</span>');
        if (hasImage) canvas.style.visibility = 'visible';
        const img = new Image();
        img.onload = () => {
          if (my !== token) return;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
          hasImage = true;
          yaw = 0; pitch = 0; fov = 85 * DEG;
          say('');
          redraw();
        };
        img.onerror = () => {
          if (my !== token) return;
          hasImage = false;
          say('<strong>Couldn’t load the 360° photo</strong><span>Check your signal. The map and directions still work.</span>');
        };
        img.src = url;
      },
      destroy() { clearInterval(spin); ro.disconnect(); cancelAnimationFrame(raf); token++; },
    };
  }

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
