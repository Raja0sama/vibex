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
    if (hint && coarse) hint.textContent = 'drag to pan · pinch to zoom · tap a node';

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
    function fit() { vb = vb0.slice(); applyVB(); }
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
    var drag = null;
    canvas.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, vb: vb.slice(), moved: false, target: e.target };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var scale = scaleNow();
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
      vb[0] = drag.vb[0] - (e.clientX - drag.x) * scale; vb[1] = drag.vb[1] - (e.clientY - drag.y) * scale; applyVB();
    });
    canvas.addEventListener('pointerup', function (e) {
      var wasDrag = drag && drag.moved;
      var target = drag ? drag.target : e.target;
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
      clone.setAttribute('viewBox', vb0.join(' '));
      clone.setAttribute('width', vb0[2]); clone.setAttribute('height', vb0[3]);
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
      var scale = Math.min(3, 6000 / Math.max(vb0[2], vb0[3]));
      var img = new Image();
      var url = URL.createObjectURL(new Blob([serialize()], { type: 'image/svg+xml;charset=utf-8' }));
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = Math.round(vb0[2] * scale); c.height = Math.round(vb0[3] * scale);
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
    this.has = function (id) { return Boolean(index[id]); };
    this.spec = spec;
  }

  global.VibexViewer = Viewer;
  global.VibexTheme = { set: setTheme, toggle: toggleTheme };
})(window);
