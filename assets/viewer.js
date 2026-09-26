// Shared viewer runtime. One instance per diagram panel.
// root must contain: [data-role=canvas] (with the svg), [data-role=details],
// [data-role=stats], and toolbar buttons/inputs with data-role attributes.
(function (global) {
  'use strict';

  function h(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function cssEscape(s) {
    s = String(s);
    if (global.CSS && typeof global.CSS.escape === 'function') return global.CSS.escape(s);
    return s.replace(/[^\w.-]/g, function (c) { return '\\' + c.charCodeAt(0).toString(16) + ' '; });
  }
  // Only http(s) URLs and scheme-less relative paths may become href values.
  function safeHref(v) { v = String(v == null ? '' : v); return /^(https?:)?\/\//i.test(v) || !/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : null; }
  var coarse = global.matchMedia && global.matchMedia('(pointer:coarse)').matches;

  // ---------- linked mode: fill slots from window.VIBEX_DATA before anything reads the page ----------
  (function hydrate(data) {
    if (!data || !data.slots) return;
    // Built, not literal: this file gets inlined, and a literal marker would look like an unfilled slot.
    var OPEN = '<!-- ' + 'VIBEX:';
    var SLOT = new RegExp(OPEN + '([A-Z_]+) -->', 'g');
    var decoder = document.createElement('textarea');
    function decode(v) { decoder.innerHTML = v; return decoder.value; }
    function fill(text, raw) {
      return text.replace(SLOT, function (m, name) {
        var v = data.slots[name];
        return v === undefined ? m : raw ? v : decode(v);
      });
    }
    var comments = [];
    var texts = [];
    var attrs = [];
    var walker = document.createTreeWalker(document.documentElement, 129 /* SHOW_ELEMENT | SHOW_COMMENT */);
    for (var node = walker.currentNode; node; node = walker.nextNode()) {
      if (node.nodeType === 8) {
        var m = /^ VIBEX:([A-Z_]+) $/.exec(node.data);
        if (m && data.slots[m[1]] !== undefined) comments.push([node, data.slots[m[1]]]);
        continue;
      }
      if ((node.tagName === 'TITLE' || node.tagName === 'SCRIPT') && node.textContent.indexOf(OPEN) !== -1) texts.push(node);
      for (var i = 0; i < node.attributes.length; i++) {
        if (node.attributes[i].value.indexOf(OPEN) !== -1) attrs.push([node, node.attributes[i].name]);
      }
    }
    comments.forEach(function (c) {
      var t = document.createElement('template');
      t.innerHTML = c[1];
      c[0].parentNode.replaceChild(t.content, c[0]);
    });
    // JSON payloads must not be entity-decoded.
    texts.forEach(function (el) { el.textContent = fill(el.textContent, el.tagName === 'SCRIPT'); });
    attrs.forEach(function (a) { a[0].setAttribute(a[1], fill(a[0].getAttribute(a[1]), false)); });
  })(global.VIBEX_DATA);

  // ---------- theme (global, shared by every panel) ----------
  var html = document.documentElement;
  function systemTheme() { return global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  function initialTheme() {
    var stored = null;
    try { stored = localStorage.getItem('vibex-theme'); } catch (e) {}
    if (stored === 'light' || stored === 'dark') return stored;
    var pref = html.getAttribute('data-theme-pref');
    return pref === 'light' || pref === 'dark' ? pref : systemTheme();
  }
  function setTheme(t) {
    html.setAttribute('data-theme', t);
    Array.prototype.forEach.call(document.querySelectorAll('svg.vibex'), function (svg) { svg.setAttribute('data-theme', t); });
    try { localStorage.setItem('vibex-theme', t); } catch (e) {}
  }
  function toggleTheme() { setTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
  setTheme(initialTheme());

  var SINGULAR = { entities: 'entity', elements: 'element', endpoints: 'endpoint', types: 'type', groups: 'group', boundaries: 'boundary', states: 'state', relationships: 'relationship', transitions: 'transition' };
  var COLLECTIONS = ['entities', 'elements', 'endpoints', 'types', 'groups', 'boundaries', 'states'];
  var SKIP = { id: 1, row: 1, col: 1, name: 1, label: 1, description: 1, summary: 1, sources: 1, columns: 1, fields: 1, params: 1, values: 1, contains: 1, entities: 1, tags: 1, path: 1, method: 1, synthetic: 1 };
  var PLURAL = { entities: 'entities', elements: 'elements', endpoints: 'endpoints', types: 'types', groups: 'groups', boundaries: 'boundaries', states: 'states' };
  function relsOf(spec) { return spec.relationships || spec.transitions || []; }
  function statsLine(spec) {
    var parts = [];
    ['entities', 'elements', 'endpoints', 'groups', 'types', 'boundaries', 'states'].forEach(function (c) {
      var n = (spec[c] || []).filter(function (x) { return !x.synthetic; }).length;
      if (n) parts.push(n + ' ' + (n === 1 ? SINGULAR[c] : PLURAL[c]));
    });
    var rels = relsOf(spec).length;
    var relWord = spec.diagram_type === 'lifecycle' ? 'transition' : 'relationship';
    if (rels || spec.diagram_type !== 'endpoints') parts.push(rels + ' ' + relWord + (rels === 1 ? '' : 's'));
    return parts.join(' · ');
  }

  // ---------- line routing for moved boxes (cut-down port of renderers/shared/layout.mjs) ----------
  function clampTo(v, lo, len) { return Math.max(lo + 6, Math.min(v, lo + len - 6)); }
  function route(a, b, fo, to) {
    var ac = [a.x + a.w / 2, a.y + a.h / 2], bc = [b.x + b.w / 2, b.y + b.h / 2], gap = 24, pts, mid;
    if (b.x >= a.x + a.w + gap || a.x >= b.x + b.w + gap) {
      var right = b.x >= a.x + a.w + gap;
      var ay = clampTo(ac[1] + fo[1], a.y, a.h), by = clampTo(bc[1] + to[1], b.y, b.h);
      var ax = right ? a.x + a.w : a.x, bx = right ? b.x : b.x + b.w;
      mid = (ax + bx) / 2;
      pts = [[ax, ay], [mid, ay], [mid, by], [bx, by]];
    } else if (b.y >= a.y + a.h || a.y >= b.y + b.h) {
      var down = b.y >= a.y + a.h;
      var ax2 = clampTo(ac[0] + fo[0], a.x, a.w), bx2 = clampTo(bc[0] + to[0], b.x, b.w);
      var ay2 = down ? a.y + a.h : a.y, by2 = down ? b.y : b.y + b.h;
      mid = (ay2 + by2) / 2;
      pts = [[ax2, ay2], [ax2, mid], [bx2, mid], [bx2, by2]];
    } else {
      pts = [ac, bc];
    }
    return dedupe(pts);
  }
  function dedupe(points) {
    var out = [];
    points.forEach(function (p) { var l = out[out.length - 1]; if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p); });
    var kept = [out[0]];
    for (var i = 1; i < out.length - 1; i++) {
      var a = kept[kept.length - 1], c = out[i], n = out[i + 1];
      if (!((a[0] === c[0] && c[0] === n[0]) || (a[1] === c[1] && c[1] === n[1]))) kept.push(c);
    }
    if (out.length > 1) kept.push(out[out.length - 1]);
    return kept;
  }
  function fmt(n) { return Math.round(n * 100) / 100; }
  function pathFromPoints(points, radius) {
    var segs = [];
    for (var i = 1; i < points.length; i++) {
      var s = points[i - 1], e = points[i], len = Math.hypot(e[0] - s[0], e[1] - s[1]);
      if (len > 0) segs.push({ s: s, e: e, len: len, dir: [(e[0] - s[0]) / len, (e[1] - s[1]) / len] });
    }
    if (!segs.length) return 'M ' + fmt(points[0][0]) + ' ' + fmt(points[0][1]);
    var out = ['M ' + fmt(segs[0].s[0]) + ' ' + fmt(segs[0].s[1])];
    segs.forEach(function (seg, k) {
      var r = k < segs.length - 1 ? Math.min(radius, seg.len / 2, segs[k + 1].len / 2) : 0;
      out.push('L ' + fmt(seg.e[0] - seg.dir[0] * r) + ' ' + fmt(seg.e[1] - seg.dir[1] * r));
      if (r) { var nx = segs[k + 1]; out.push('Q ' + fmt(seg.e[0]) + ' ' + fmt(seg.e[1]) + ' ' + fmt(nx.s[0] + nx.dir[0] * r) + ' ' + fmt(nx.s[1] + nx.dir[1] * r)); }
    });
    return out.join(' ');
  }
  function midpoint(points) {
    var lens = [], total = 0;
    for (var i = 1; i < points.length; i++) { var l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]); lens.push(l); total += l; }
    var t = total / 2;
    for (var j = 0; j < lens.length; j++) {
      if (t <= lens[j]) { var f = lens[j] ? t / lens[j] : 0; return [points[j][0] + (points[j + 1][0] - points[j][0]) * f, points[j][1] + (points[j + 1][1] - points[j][1]) * f]; }
      t -= lens[j];
    }
    return points[points.length - 1];
  }

  function Viewer(root, spec, options) {
    options = options || {};
    var svg = root.querySelector('svg.vibex');
    var canvas = root.querySelector('[data-role=canvas]');
    var details = root.querySelector('[data-role=details]');
    var stats = root.querySelector('[data-role=stats]');
    var search = root.querySelector('[data-role=search]');
    var self = this;

    // ---------- index ----------
    var index = {};
    // First collection wins, so a group can never shadow an entity with the same id.
    COLLECTIONS.forEach(function (c) { (spec[c] || []).forEach(function (item) { if (item && item.id != null && !index[item.id]) index[item.id] = { collection: c, item: item }; }); });
    var rels = relsOf(spec);
    var relCollection = spec.diagram_type === 'lifecycle' ? 'transitions' : 'relationships';
    var relIndex = {};
    rels.forEach(function (r, i) { relIndex[r.id || (r.from + '-' + r.to + '-' + i)] = r; });
    var defaultGroup = (spec.groups || []).filter(function (g) { return g.synthetic; })[0];
    var defaultGroupId = defaultGroup ? defaultGroup.id : 'default';
    var groupIds = {};
    (spec.groups || []).forEach(function (g) { groupIds[g.id] = 1; });
    function groupOf(ep) { return ep.group && groupIds[ep.group] ? ep.group : defaultGroupId; }
    if (stats) stats.textContent = statsLine(spec);
    var hint = canvas && canvas.querySelector('.hint');
    if (hint && coarse) hint.textContent = 'drag a box to move it · drag space to pan · pinch to zoom · tap a node';

    // ---------- pan / zoom ----------
    var vb0 = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    var vb = vb0.slice();
    function applyVB() { svg.setAttribute('viewBox', vb.join(' ')); }
    function scaleNow() { var r = svg.getBoundingClientRect(); return Math.max(vb[2] / r.width, vb[3] / r.height); }
    function clientToSvg(cx, cy) {
      var r = svg.getBoundingClientRect();
      var scale = scaleNow();
      var offX = (r.width - vb[2] / scale) / 2, offY = (r.height - vb[3] / scale) / 2;
      return { x: vb[0] + (cx - r.left - offX) * scale, y: vb[1] + (cy - r.top - offY) * scale };
    }
    function zoomAt(factor, cx, cy) {
      var p = clientToSvg(cx, cy);
      var nw = Math.min(vb0[2] * 4, Math.max(vb0[2] / 12, vb[2] * factor));
      var nh = nw * (vb[3] / vb[2]);
      vb[0] = p.x - (p.x - vb[0]) * (nw / vb[2]);
      vb[1] = p.y - (p.y - vb[1]) * (nh / vb[3]);
      vb[2] = nw; vb[3] = nh;
      applyVB();
    }
    function zoomCenter(factor) { var r = canvas.getBoundingClientRect(); zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2); }
    function fit() { vb = extent(); applyVB(); }
    // First view: when the diagram's aspect ratio is far from the canvas (a
    // 7-rank C4 drawn left-to-right, say), "fit everything" shrinks text to a
    // few px. Fit the short axis instead and let the reader pan along the long
    // one. The Fit button still shows the whole diagram.
    function initialView() {
      var r = svg.getBoundingClientRect();
      if (!r.width || !r.height) { fit(); return; }
      var fitScale = Math.max(vb0[2] / r.width, vb0[3] / r.height);
      var diagAspect = vb0[2] / vb0[3], canvasAspect = r.width / r.height;
      var mismatch = Math.max(diagAspect / canvasAspect, canvasAspect / diagAspect);
      if (fitScale <= 2.2 || mismatch < 1.5) { fit(); return; }
      var scale = Math.max(1, Math.min(fitScale, diagAspect > canvasAspect ? vb0[3] / r.height : vb0[2] / r.width));
      var w = r.width * scale, h = r.height * scale;
      vb = [diagAspect > canvasAspect ? 0 : (vb0[2] - w) / 2, diagAspect > canvasAspect ? (vb0[3] - h) / 2 : 0, w, h];
      applyVB();
      var hint = root.querySelector('.hint');
      if (hint) hint.textContent = 'Showing the ' + (diagAspect > canvasAspect ? 'left' : 'top') + ' part at readable size · drag to pan · Fit (0) shows everything';
    }
    initialView();
    canvas.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
    // ---------- moving boxes by hand (memory only; a reload restores the layout) ----------
    var moved = {}; // node id -> [dx, dy]
    var boxes = {};
    var edgeCache = {};
    var resetBtn = root.querySelector('[data-role=reset-layout]');
    function isContainer(el) { var k = el.getAttribute('data-node-kind'); return k === 'boundary' || k === 'group'; }
    function boxOf(id) {
      if (boxes[id]) return boxes[id];
      var el = nodeEl(id);
      if (!el) return null;
      var shape = el.querySelector('rect.box, rect.frame') || el;
      var b = shape.getBBox();
      return (boxes[id] = { x: b.x, y: b.y, w: b.width, h: b.height });
    }
    function inside(outer, inner) { return inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1; }
    function offsetOf(id) { return moved[id] || [0, 0]; }
    function currentBox(id) { var b = boxOf(id), o = offsetOf(id); return b && { x: b.x + o[0], y: b.y + o[1], w: b.w, h: b.h }; }
    function nodeIds() { return all('[data-node-id]').map(function (el) { return el.getAttribute('data-node-id'); }); }
    // A container carries what is inside it; an endpoint row drags its card.
    function dragSet(el) {
      var id = el.getAttribute('data-node-id');
      if (!isContainer(el) && el.getAttribute('data-node-kind') === 'endpoint') {
        var here = currentBox(id);
        var card = all('[data-node-kind=group]').filter(function (g) { return inside(currentBox(g.getAttribute('data-node-id')), here); })[0];
        if (card) { el = card; id = card.getAttribute('data-node-id'); }
      }
      if (!isContainer(el)) return [id];
      var outer = currentBox(id);
      return nodeIds().filter(function (other) { return other === id || inside(outer, currentBox(other)); });
    }
    function edgeFor(id) {
      if (edgeCache[id]) return edgeCache[id];
      var g = svg.querySelector('.edge[data-edge-id="' + cssEscape(id) + '"]');
      var line = g && (g.querySelector('path.line') || g.querySelector('path'));
      if (!line) return null;
      var d0 = line.getAttribute('d');
      var n = d0.match(/-?\d*\.?\d+(?:e-?\d+)?/gi).map(Number);
      var label = svg.querySelector('.edge-label[data-edge-id="' + cssEscape(id) + '"]');
      var lb = label && label.getBBox();
      var from = g.getAttribute('data-edge-from'), to = g.getAttribute('data-edge-to');
      var a = boxOf(from), b = boxOf(to);
      // Keep each end's attachment point so ERD lines stay on their column.
      var start = [n[0], n[1]], end = [n[n.length - 2], n[n.length - 1]];
      return (edgeCache[id] = {
        g: g, label: label, from: from, to: to, d0: d0,
        fromOff: a ? [start[0] - (a.x + a.w / 2), start[1] - (a.y + a.h / 2)] : [0, 0],
        toOff: b ? [end[0] - (b.x + b.w / 2), end[1] - (b.y + b.h / 2)] : [0, 0],
        labelCenter: lb ? [lb.x + lb.width / 2, lb.y + lb.height / 2] : null,
      });
    }
    function translate(el, o) { if (o[0] || o[1]) el.setAttribute('transform', 'translate(' + o[0] + ' ' + o[1] + ')'); else el.removeAttribute('transform'); }
    function setD(e, d) { Array.prototype.forEach.call(e.g.querySelectorAll('path'), function (p) { p.setAttribute('d', d); }); }
    function redrawEdge(id) {
      var e = edgeFor(id);
      if (!e) return;
      var fo = offsetOf(e.from), to = offsetOf(e.to);
      // Both ends moved together: slide the line as drawn.
      if (fo[0] === to[0] && fo[1] === to[1]) {
        setD(e, e.d0); translate(e.g, fo); if (e.label) translate(e.label, fo);
        return;
      }
      var a = currentBox(e.from), b = currentBox(e.to);
      if (!a || !b) return;
      var pts = route(a, b, e.fromOff, e.toOff);
      e.g.removeAttribute('transform');
      setD(e, pathFromPoints(pts, 8));
      if (e.label && e.labelCenter) {
        var m = midpoint(pts);
        translate(e.label, [m[0] - e.labelCenter[0], m[1] - e.labelCenter[1]]);
      }
    }
    function anyMoved() { for (var k in moved) if (moved[k][0] || moved[k][1]) return true; return false; }
    function applyMoves(ids) {
      ids.forEach(function (id) { var el = nodeEl(id); if (el) translate(el, offsetOf(id)); });
      var touched = {};
      ids.forEach(function (id) { touched[id] = 1; });
      all('.edge[data-edge-id]').forEach(function (g) {
        if (touched[g.getAttribute('data-edge-from')] || touched[g.getAttribute('data-edge-to')]) redrawEdge(g.getAttribute('data-edge-id'));
      });
      if (resetBtn) resetBtn.hidden = !anyMoved();
    }
    function resetLayout() {
      var ids = Object.keys(moved);
      moved = {};
      applyMoves(ids);
      fit();
    }
    function extent() {
      if (!anyMoved()) return vb0.slice();
      var b = svg.getBBox(), pad = 24;
      var x0 = Math.min(vb0[0], b.x - pad), y0 = Math.min(vb0[1], b.y - pad);
      var x1 = Math.max(vb0[0] + vb0[2], b.x + b.width + pad), y1 = Math.max(vb0[1] + vb0[3], b.y + b.height + pad);
      return [x0, y0, x1 - x0, y1 - y0];
    }
    if (resetBtn) resetBtn.addEventListener('click', resetLayout);

    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, vb: vb.slice(), moved: false, target: e.target };
      var node = e.target.closest && e.target.closest('[data-node-id]');
      if (node && svg.contains(node)) {
        drag.ids = dragSet(node);
        drag.from = drag.ids.map(offsetOf);
      }
      canvas.setPointerCapture(e.pointerId);
    });
    var frame = 0;
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var scale = scaleNow();
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
      if (!drag.moved) return;
      var dx = (e.clientX - drag.x) * scale, dy = (e.clientY - drag.y) * scale;
      if (drag.ids) {
        canvas.classList.add('moving');
        drag.ids.forEach(function (id, i) { moved[id] = [drag.from[i][0] + dx, drag.from[i][1] + dy]; });
        var ids = drag.ids;
        if (!frame) frame = requestAnimationFrame(function () { frame = 0; applyMoves(ids); });
        return;
      }
      vb[0] = drag.vb[0] - dx; vb[1] = drag.vb[1] - dy; applyVB();
    });
    canvas.addEventListener('pointerup', function (e) {
      var wasDrag = drag && drag.moved;
      var target = drag ? drag.target : e.target;
      if (drag && drag.ids && wasDrag) { if (frame) { cancelAnimationFrame(frame); frame = 0; } applyMoves(drag.ids); }
      canvas.classList.remove('moving');
      drag = null;
      if (wasDrag) return;
      var node = target.closest('[data-node-id]');
      var edge = target.closest('[data-edge-id]');
      if (edge) selectEdge(edge.getAttribute('data-edge-id'));
      else if (node) selectNode(node.getAttribute('data-node-id'));
      else clearSelection();
    });
    canvas.addEventListener('pointercancel', function () { drag = null; });

    function bind(role, fn) { var el = root.querySelector('[data-role=' + role + ']'); if (el) el.addEventListener('click', fn); }
    bind('zoom-in', function () { zoomCenter(1 / 1.25); });
    bind('zoom-out', function () { zoomCenter(1.25); });
    bind('zoom-fit', fit);
    bind('theme', toggleTheme);
    bind('export-svg', function () { download(new Blob([serialize()], { type: 'image/svg+xml' }), safeName() + '.svg'); });
    bind('export-png', exportPng);

    // ---------- selection ----------
    function all(sel) { return Array.prototype.slice.call(svg.querySelectorAll(sel)); }
    function nodeEl(id) { return svg.querySelector('[data-node-id="' + cssEscape(id) + '"]'); }
    function clearClasses() {
      all('.selected,.related,.match').forEach(function (el) { el.classList.remove('selected', 'related', 'match'); if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', 'false'); });
      svg.classList.remove('has-focus');
    }
    function clearSelection() { clearClasses(); details.innerHTML = '<p class="empty">Click a node or relationship.</p>'; }
    function selectNode(id) {
      var el = nodeEl(id);
      if (!el) { if (options.onMissingNode) options.onMissingNode(id); return false; }
      clearClasses();
      svg.classList.add('has-focus');
      el.classList.add('selected');
      if (el.getAttribute('role') === 'button') el.setAttribute('aria-pressed', 'true');
      all('[data-edge-id]').forEach(function (edge) {
        var f = edge.getAttribute('data-edge-from'), t = edge.getAttribute('data-edge-to');
        if (f === id || t === id) {
          edge.classList.add('related');
          var other = nodeEl(f === id ? t : f);
          if (other) other.classList.add('related');
        }
      });
      var entry = index[id];
      if (entry && entry.collection === 'groups') {
        (spec.endpoints || []).forEach(function (ep) { if (groupOf(ep) === id) { var n = nodeEl(ep.id); if (n) n.classList.add('related'); } });
        (entry.item.entities || []).forEach(function (m) { var n = nodeEl(m); if (n) n.classList.add('related'); });
      }
      if (entry && entry.collection === 'boundaries') (entry.item.contains || []).forEach(function (m) { var n = nodeEl(m); if (n) n.classList.add('related'); });
      if (el.classList.contains('ep-row')) {
        var g = el.previousElementSibling;
        while (g && !g.classList.contains('ep-card')) g = g.previousElementSibling;
        if (g) g.classList.add('related');
      }
      renderDetails(entry, id);
      if (options.onSelect) options.onSelect(id);
      return true;
    }
    function selectEdge(id) {
      var edge = svg.querySelector('[data-edge-id="' + cssEscape(id) + '"]');
      if (!edge) return;
      clearClasses();
      svg.classList.add('has-focus');
      all('[data-edge-id="' + cssEscape(id) + '"]').forEach(function (el) { el.classList.add('selected'); if (el.getAttribute('role') === 'button') el.setAttribute('aria-pressed', 'true'); });
      var f = edge.getAttribute('data-edge-from'), t = edge.getAttribute('data-edge-to');
      [f, t].forEach(function (n) { var el = nodeEl(n); if (el) el.classList.add('related'); });
      renderDetails({ collection: relCollection, item: relIndex[id] || { from: f, to: t, label: edge.getAttribute('data-edge-label') || '' } }, id);
    }

    // ---------- details ----------
    function sourceLink(s) {
      var repo = spec.meta.repository;
      var text = s.path + (s.line ? ':' + s.line + (s.end_line ? '-' + s.end_line : '') : '') + (s.label ? '  (' + s.label + ')' : '');
      if (!repo || !/^https?:\/\//i.test(String(repo.url || ''))) return '<code>' + h(text) + '</code>';
      var segs = String(s.path).split('/').map(encodeURIComponent).join('/');
      var href = String(repo.url).replace(/\/+$/, '') + '/blob/' + encodeURIComponent(repo.revision || 'HEAD') + '/' + segs + (s.line ? '#L' + s.line + (s.end_line ? '-L' + s.end_line : '') : '');
      return '<a href="' + h(href) + '" target="_blank" rel="noopener noreferrer">' + h(text) + '</a>';
    }
    // Noticing something wrong while looking at a node is the moment worth
    // catching. The link carries which spec and which node, so whoever picks
    // the issue up does not have to reconstruct where the reader was standing.
    function intakeLink(item, id, collection) {
      var repo = spec.meta && spec.meta.repository;
      var url = repo && String(repo.url || '');
      if (!url || !/^https?:\/\/(www\.)?(github|gitlab)\.com\//i.test(url)) return '';
      var gitlab = /gitlab\.com/i.test(url);
      var clean = url.replace(/\/+$/, '').replace(/\.git$/, '');
      var specId = (spec.meta && spec.meta.id) || spec.diagram_type;
      var label = item.label || item.name || item.path || id;

      var body = 'What is missing or wrong:\n\n\n\n---\n\n'
        + 'Context, filled in automatically. Leave it in — it is how this gets picked up.\n\n'
        + '```vibex\nintent: spec-gap\nspec: ' + specId + '#' + id + '\nkind: ' + (collection || '') + '\nlabel: ' + label
        + (repo.revision ? '\ncommit: ' + repo.revision : '') + '\n```';
      var title = label + ' — something is missing or wrong';

      var href = gitlab
        ? clean + '/-/issues/new?issue%5Btitle%5D=' + encodeURIComponent(title) + '&issue%5Bdescription%5D=' + encodeURIComponent(body)
        : clean + '/issues/new?title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body) + '&labels=spec,intake';

      return '<a class="flag" href="' + h(href) + '" target="_blank" rel="noopener noreferrer"'
        + ' title="Something missing or wrong here? File it, with the context already filled in.">'
        + '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + '<path d="M5 21V5.5a1 1 0 0 1 .6-.9C7 4 9 4 12 5.2s5 1.2 6.4.6a1 1 0 0 1 1.6.9v7.7a1 1 0 0 1-.6.9c-1.4.6-3.4.6-6.4-.6s-5-1.2-6.4-.6"/>'
        + '</svg><span>Report something about this</span></a>';
    }

    function table(rows, keys) {
      if (!rows || !rows.length) return '';
      // Only show columns some row actually fills; the panel is narrow.
      var cols = keys.filter(function (k) {
        return rows.some(function (r) { return r[k] !== undefined && r[k] !== null && r[k] !== '' && r[k] !== false; });
      });
      if (!cols.length) cols = keys.slice(0, 1);
      var out = '<div class="tw"><table><thead><tr>' + cols.map(function (k) { return '<th>' + h(k) + '</th>'; }).join('') + '</tr></thead><tbody>';
      rows.forEach(function (r) {
        out += '<tr>' + cols.map(function (k) { var v = r[k]; if (v === true) v = '✓'; if (v === false || v == null) v = ''; return '<td>' + h(v) + '</td>'; }).join('') + '</tr>';
      });
      return out + '</tbody></table></div>';
    }

    function chip(id, label, linkable) {
      var known = linkable && (index[id] || (options.resolveExternal && options.resolveExternal(id)));
      return known
        ? '<button type="button" class="chip link" data-goto="' + h(id) + '">' + h(label || id) + '</button>'
        : '<span class="chip">' + h(label || id) + '</span>';
    }
    function chips(list, linkable) {
      if (!list || !list.length) return '';
      return '<div class="chips">' + list.map(function (v) { var id = typeof v === 'string' ? v : v.id; return chip(id, id, linkable); }).join('') + '</div>';
    }
    function findTypeId(name) {
      if (!name) return null;
      var base = String(name).replace(/[\[\]!]/g, '');
      var hit = (spec.types || []).find(function (t) { return t.id === base || t.name === base; });
      return hit ? hit.id : null;
    }
    function renderDetails(entry, id) {
      if (!entry) { details.innerHTML = '<p class="empty">No data for ' + h(id) + '</p>'; return; }
      var item = entry.item, c = entry.collection;
      var title = item.name || item.label || (item.method ? item.method + ' ' + item.path : id);
      if (c === 'relationships' || c === 'transitions') title = (item.label || item.event || '') + ' ' + item.from + ' → ' + item.to;
      var kind = (SINGULAR[c] || c) + (item.kind ? ' · ' + item.kind : '') + (item.method && c === 'endpoints' ? ' · ' + item.method : '');
      var out = '<p class="d-title">' + h(title) + '</p><p class="d-kind">' + h(kind) + '</p>';
      if (item.description || item.summary) out += '<p class="d-desc">' + h(item.summary || '') + (item.summary && item.description ? '<br>' : '') + h(item.description || '') + '</p>';
      var dl = '';
      Object.keys(item).forEach(function (k) {
        if (SKIP[k]) return;
        var v = item[k];
        if (v == null || typeof v === 'object') { if (Array.isArray(v) && v.every(function (x) { return typeof x !== 'object'; })) v = v.join(', '); else return; }
        if (k === 'link') {
          var target = options.resolveLink && options.resolveLink(v);
          var href = safeHref(v);
          dl += '<dt>link</dt><dd>' + (target ? '<button type="button" class="chip link" data-goto-diagram="' + h(target) + '">' + h(v) + ' ↗</button>' : href ? '<a href="' + h(href) + '" rel="noopener noreferrer">' + h(v) + ' ↗</a>' : '<code>' + h(v) + '</code>') + '</dd>';
          return;
        }
        if ((k === 'request' || k === 'response') && findTypeId(v)) { dl += '<dt>' + h(k) + '</dt><dd>' + chip(findTypeId(v), v, true) + '</dd>'; return; }
        dl += '<dt>' + h(k) + '</dt><dd>' + h(v === true ? 'yes' : v === false ? 'no' : v) + '</dd>';
      });
      if (dl) out += '<dl>' + dl + '</dl>';
      var before = out.length;
      if (item.columns) out += '<h4>Columns</h4>' + table(item.columns, ['name', 'type', 'pk', 'fk', 'nullable', 'unique', 'default']);
      if (item.fields) out += '<h4>Fields</h4>' + table(item.fields, ['name', 'type', 'required']);
      if (item.params) out += '<h4>Params</h4>' + table(item.params, ['name', 'in', 'type', 'required']);
      if (item.values) out += '<h4>Values</h4>' + chips(item.values);
      if (item.entities) out += '<h4>Entities</h4>' + chips(item.entities, true);
      if (item.contains) out += '<h4>Contains</h4>' + chips(item.contains, true);
      if (item.tags) out += '<h4>Tags</h4>' + chips(item.tags);
      if (c === 'entities' || c === 'elements' || c === 'states') {
        var touching = rels.filter(function (r) { return r.from === id || r.to === id; });
        if (touching.length) {
          out += '<h4>Relationships</h4><div class="tw"><table><tbody>' + touching.map(function (r) {
            var other = r.from === id ? r.to : r.from;
            var lbl = r.label || r.event || (r.from_column ? r.from_column + ' → ' + (r.to_column || '') : '') || r.technology || '';
            return '<tr><td>' + (r.from === id ? '→' : '←') + ' ' + chip(other, other, true) + '</td><td>' + h(lbl) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        }
      }
      if (c === 'groups') {
        var eps = (spec.endpoints || []).filter(function (e) { return groupOf(e) === id; });
        if (eps.length) out += '<h4>Endpoints</h4><div class="chips">' + eps.map(function (e) { return chip(e.id, e.method + ' ' + e.path, true); }).join('') + '</div>';
      }
      if (options.crossLinks) {
        var extra = options.crossLinks(id, c);
        if (extra && extra.length) {
          out += '<h4>Elsewhere</h4><div class="chips">' + extra.map(function (x) {
            return '<button type="button" class="chip link" data-goto-diagram="' + h(x.diagram) + '" data-goto-node="' + h(x.nodeId) + '">' + h(x.label) + '</button>';
          }).join('') + '</div>';
        }
      }
      if (item.sources && item.sources.length) out += '<h4>Source</h4><div class="d-desc">' + item.sources.map(sourceLink).join('<br>') + '</div>';
      if (out.length === before && !dl && !item.description && !item.summary) out += '<p class="empty">No further details in the spec.</p>';
      out += intakeLink(item, id, entry.collection);
      details.innerHTML = out;
    }
    details.addEventListener('click', function (e) {
      var d = e.target.closest('[data-goto-diagram]');
      if (d && options.gotoDiagram) { options.gotoDiagram(d.getAttribute('data-goto-diagram'), d.getAttribute('data-goto-node')); return; }
      var t = e.target.closest('[data-goto]');
      if (t) selectNode(t.getAttribute('data-goto'));
    });

    // ---------- search ----------
    function haystack(id) {
      var entry = index[id]; if (!entry) return id;
      var item = entry.item;
      var parts = [id, item.name, item.label, item.path, item.summary, item.description, item.technology, item.method, item.event, item.guard, item.actor, item.kind];
      (item.columns || []).forEach(function (c) { parts.push(c.name, c.type); });
      (item.fields || []).forEach(function (f) { parts.push(f.name, f.type); });
      (item.tags || []).forEach(function (t) { parts.push(t); });
      return parts.filter(Boolean).join(' ').toLowerCase();
    }
    var searchable = Object.keys(index).map(function (id) { return { id: id, text: haystack(id) }; });
    function runSearch() {
      var q = search.value.trim().toLowerCase();
      clearClasses();
      if (!q) return;
      var count = 0;
      searchable.forEach(function (s) {
        if (s.text.indexOf(q) === -1) return;
        var el = nodeEl(s.id);
        if (el) { el.classList.add('match', 'related'); count += 1; }
      });
      if (count) svg.classList.add('has-focus');
      details.innerHTML = '<p class="empty">' + (count ? count + ' match' + (count === 1 ? '' : 'es') + '. Press Enter to open the first.' : 'No matches for \u201c' + h(search.value.trim()) + '\u201d.') + '</p>';
    }
    if (search) {
      search.addEventListener('input', runSearch);
      search.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { var m = svg.querySelector('.match'); if (m) selectNode(m.getAttribute('data-node-id')); }
        if (e.key === 'Escape') { search.value = ''; clearSelection(); search.blur(); }
      });
    }
    document.addEventListener('keydown', function (e) {
      if (root.offsetParent === null && root !== document.body) return; // hidden panel
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '/') { e.preventDefault(); if (search) search.focus(); }
      else if (e.key === 'Escape') clearSelection();
      else if (e.key === '+' || e.key === '=') zoomCenter(1 / 1.25);
      else if (e.key === '-') zoomCenter(1.25);
      else if (e.key === '0') fit();
      else if (e.key === 't') toggleTheme();
      else if (e.key === 'r' && anyMoved()) resetLayout();
      else if (e.key === 'Enter' && document.activeElement && svg.contains(document.activeElement)) {
        var a = document.activeElement;
        if (a.hasAttribute('data-edge-id')) selectEdge(a.getAttribute('data-edge-id'));
        else if (a.hasAttribute('data-node-id')) selectNode(a.getAttribute('data-node-id'));
      }
    });

    // ---------- export ----------
    function safeName() { return (spec.meta.title || 'diagram').replace(/[^\w\-]+/g, '-').toLowerCase(); }
    function serialize() {
      var clone = svg.cloneNode(true);
      var ext = extent();
      clone.setAttribute('viewBox', ext.join(' '));
      clone.setAttribute('width', ext[2]); clone.setAttribute('height', ext[3]);
      clone.classList.remove('has-focus');
      clone.removeAttribute('style');
      clone.setAttribute('role', 'img');
      Array.prototype.forEach.call(clone.querySelectorAll('[tabindex]'), function (el) { el.removeAttribute('tabindex'); });
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    }
    function download(blob, name) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    function exportPng() {
      var ext = extent();
      var scale = Math.min(3, 6000 / Math.max(ext[2], ext[3]));
      var img = new Image();
      var url = URL.createObjectURL(new Blob([serialize()], { type: 'image/svg+xml;charset=utf-8' }));
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = Math.round(ext[2] * scale); c.height = Math.round(ext[3] * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { download(b, safeName() + '.png'); }, 'image/png');
      };
      img.onerror = function () { URL.revokeObjectURL(url); alert('PNG export failed in this browser. Use SVG.'); };
      img.src = url;
    }

    this.selectNode = selectNode;
    this.clear = clearSelection;
    this.fit = fit;
    this.resetLayout = resetLayout;
    this.has = function (id) { return Boolean(index[id]); };
    this.spec = spec;
  }

  // ---------- collapsible chrome (global, every panel) ----------
  // The canvas is what the reader came for, so the panels around it can get out
  // of the way. Collapsing is not hiding: the aside keeps its section headings
  // legible down the edge, and clicking one reopens the panel at that section.
  // State is remembered per panel, so a reader who wants the canvas wide keeps it.
  var CHEVRON = '<svg class="i" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.2 3.4 10.8 8l-4.6 4.6"/></svg>';
  var asides = [];
  var noteBars = [];

  // localStorage is a convenience here, never a requirement: a browser that
  // refuses it still opens on a sane default.
  function remember(key, collapsed) { try { localStorage.setItem(key, collapsed ? '1' : '0'); } catch (e) {} }
  function recall(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  function panelKey(el, prefix) {
    var panel = el.closest ? el.closest('.panel') : null;
    return 'vibex-' + prefix + ':' + ((panel && panel.getAttribute('data-panel')) || 'single');
  }

  function collapsibleAside(body) {
    var aside = body.querySelector('aside');
    if (!aside || aside.getAttribute('data-collapsible')) return;
    aside.setAttribute('data-collapsible', '1');
    var key = panelKey(body, 'aside');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'p-toggle';
    btn.innerHTML = CHEVRON + '<span class="lbl"></span>';
    aside.insertBefore(btn, aside.firstChild);

    function apply(collapsed, persist) {
      body.classList.toggle('aside-min', collapsed);
      var label = collapsed ? 'Show panel' : 'Hide panel';
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      btn.setAttribute('aria-label', label);
      btn.title = label + '  ]';
      btn.querySelector('.lbl').textContent = label;
      if (persist) remember(key, collapsed);
    }
    function toggle() { apply(!body.classList.contains('aside-min'), true); }

    btn.addEventListener('click', toggle);

    // While collapsed, a section heading is the way back into that section.
    Array.prototype.forEach.call(aside.children, function (sec) {
      if (sec.tagName !== 'SECTION') return;
      sec.addEventListener('click', function () {
        if (!body.classList.contains('aside-min')) return;
        apply(false, true);
        if (sec.scrollIntoView) sec.scrollIntoView({ block: 'nearest' });
      });
    });

    apply(recall(key) === '1', false);
    asides.push({ el: body, toggle: toggle });
  }

  function collapsibleNotes(shell) {
    var cards = shell.querySelector('.cards');
    if (!cards || !cards.children.length || cards.getAttribute('data-collapsible')) return;
    cards.setAttribute('data-collapsible', '1');
    var key = panelKey(cards, 'notes');
    var n = cards.children.length;

    var bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'cards-bar';
    bar.innerHTML = '<span>Notes</span><span class="n">' + n + '</span>' + CHEVRON;
    cards.parentNode.insertBefore(bar, cards);

    function apply(open, persist) {
      cards.hidden = !open;
      bar.setAttribute('aria-expanded', open ? 'true' : 'false');
      bar.title = (open ? 'Hide' : 'Show') + ' notes  \\';
      if (persist) remember(key, !open);
    }
    function toggle() { apply(cards.hidden, true); }

    bar.addEventListener('click', toggle);
    apply(recall(key) !== '1', false);
    noteBars.push({ el: bar, toggle: toggle });
  }

  // Act on the panel the reader is actually looking at. A dashboard keeps every
  // other panel in the DOM but not on screen, and offsetParent is what tells
  // them apart without asking the dashboard about itself.
  function onScreen(list) {
    for (var i = 0; i < list.length; i++) if (list[i].el.offsetParent !== null) return list[i];
    return null;
  }

  function initChrome() {
    Array.prototype.forEach.call(document.querySelectorAll('.viewer-body,.docs-body'), collapsibleAside);
    Array.prototype.forEach.call(document.querySelectorAll('.viewer,.docs-shell'), collapsibleNotes);
  }

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var hit = e.key === ']' ? onScreen(asides) : e.key === '\\' ? onScreen(noteBars) : null;
    if (hit) { e.preventDefault(); hit.toggle(); }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initChrome);
  else initChrome();

  global.VibexViewer = Viewer;
  global.VibexTheme = { set: setTheme, toggle: toggleTheme };
})(window);
