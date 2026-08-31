/* trumap — swap labels on an OpenStreetMap-based vector map.
 *
 * Labels are drawn client side from vector tiles, so every symbol layer's
 * text-field can be rewritten at runtime: look up the feature's real name in a
 * replacement table and draw the substitute instead, falling back to the
 * style's original expression when there is no match.
 */
(function () {
  'use strict';

  var STYLES = [
    { id: 'liberty',  name: 'Liberty',  url: 'https://tiles.openfreemap.org/styles/liberty' },
    { id: 'bright',   name: 'Bright',   url: 'https://tiles.openfreemap.org/styles/bright' },
    { id: 'positron', name: 'Positron', url: 'https://tiles.openfreemap.org/styles/positron' },
    { id: 'colorful', name: 'Colorful', url: 'https://tiles.versatiles.org/assets/styles/colorful/style.json' }
  ];

  // OpenMapTiles name fields, checked in order.
  var NAME_FIELDS = ['name', 'name:latin', 'name_en', 'name:en', 'name_int', 'name:nonlatin', 'ref'];

  var STORAGE_KEY = 'trumap.state.v1';
  var DEFAULT_VIEW = { lng: -73.9857, lat: 40.7484, zoom: 11 };

  var $ = function (sel) { return document.querySelector(sel); };

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64decode(str) {
    var bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }

  // ---------------------------------------------------------------- state

  var state = {
    rules: [],            // [{ f: 'New York', t: 'Big Apple', on: true }]
    style: 'liberty',
    hidden: false,
    view: null
  };

  function normalizeRules(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r) continue;
      var from = String(r.f != null ? r.f : r.from || '').trim();
      if (!from) continue;
      out.push({ f: from, t: String(r.t != null ? r.t : r.to || ''), on: r.on !== false });
    }
    return out;
  }

  function loadStored() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!data) return;
      state.rules = normalizeRules(data.rules);
      if (data.style) state.style = data.style;
    } catch (e) { /* storage unavailable */ }
  }

  function saveStored() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rules: state.rules, style: state.style }));
    } catch (e) { /* storage unavailable */ }
  }

  // ---------------------------------------------------------------- link state

  function readHash() {
    var hash = location.hash.replace(/^#/, '');
    if (!hash) return;
    var p = new URLSearchParams(hash);

    if (p.has('r')) {
      try {
        var rules = normalizeRules(JSON.parse(b64decode(p.get('r'))));
        if (rules.length) state.rules = rules;
      } catch (e) { /* malformed link, keep stored rules */ }
    }
    if (p.has('s')) {
      for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === p.get('s')) state.style = p.get('s');
    }
    if (p.has('m')) {
      var m = p.get('m').split(',').map(Number);
      if (m.length === 3 && m.every(isFinite)) state.view = { lat: m[0], lng: m[1], zoom: m[2] };
    }
    if (p.has('k')) state.hidden = p.get('k') === '1';
  }

  function buildHash(opts) {
    var p = new URLSearchParams();
    if (map) {
      var c = map.getCenter();
      p.set('m', c.lat.toFixed(5) + ',' + c.lng.toFixed(5) + ',' + map.getZoom().toFixed(2));
    }
    p.set('s', state.style);
    if (state.rules.length) p.set('r', b64encode(JSON.stringify(state.rules)));
    if ((opts && opts.forceHidden) || state.hidden) p.set('k', '1');
    return '#' + p.toString();
  }

  function syncHash() {
    try { history.replaceState(null, '', buildHash()); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- label engine

  var map;
  var originalTextFields = {};
  var originalsCaptured = false;

  function captureOriginals() {
    originalTextFields = {};
    var layers = map.getStyle().layers || [];
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      if (layer.type !== 'symbol') continue;
      var tf = layer.layout && layer.layout['text-field'];
      if (tf === undefined || tf === null) continue;
      originalTextFields[layer.id] = tf;
    }
    originalsCaptured = true;
  }

  function buildLookupTable() {
    var table = {};
    for (var i = 0; i < state.rules.length; i++) {
      var r = state.rules[i];
      if (!r.on) continue;
      var key = r.f.trim().toLowerCase();
      if (key) table[key] = r.t;
    }
    return table;
  }

  function buildTextField(original, table) {
    var literal = ['literal', table];
    var expr = ['case'];
    for (var i = 0; i < NAME_FIELDS.length; i++) {
      var key = ['downcase', ['to-string', ['coalesce', ['get', NAME_FIELDS[i]], '']]];
      expr.push(['has', key, literal], ['get', key, literal]);
    }
    expr.push(original);
    return expr;
  }

  function applyRules() {
    if (!map || !originalsCaptured) return;
    var table = buildLookupTable();
    var empty = !Object.keys(table).length;

    for (var id in originalTextFields) {
      if (!Object.prototype.hasOwnProperty.call(originalTextFields, id)) continue;
      if (!map.getLayer(id)) continue;
      var original = originalTextFields[id];
      try {
        map.setLayoutProperty(id, 'text-field', empty ? original : buildTextField(original, table));
      } catch (e) { /* skip layers the style guards differently */ }
    }
  }

  // ---------------------------------------------------------------- map

  function currentStyleUrl() {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === state.style) return STYLES[i].url;
    return STYLES[0].url;
  }

  function initMap() {
    var view = state.view || DEFAULT_VIEW;

    map = new maplibregl.Map({
      container: 'map',
      style: currentStyleUrl(),
      center: [view.lng, view.lat],
      zoom: view.zoom,
      attributionControl: { compact: true }
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true
    }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');

    map.on('style.load', function () {
      captureOriginals();
      applyRules();
    });
    map.on('moveend', function () {
      syncHash();
      refreshVisibleNames();
    });
    map.on('idle', refreshVisibleNames);
    map.on('click', onMapClick);
  }

  function switchStyle(id) {
    state.style = id;
    originalsCaptured = false;
    saveStored();
    map.setStyle(currentStyleUrl());
    syncHash();
  }

  // ---------------------------------------------------------------- picking labels

  var picking = false;

  function setPicking(on) {
    picking = on;
    document.body.classList.toggle('picking', on);
    $('#btn-pick').classList.toggle('active', on);
    $('#btn-pick').setAttribute('aria-pressed', String(on));
  }

  function featureName(props) {
    for (var i = 0; i < NAME_FIELDS.length; i++) {
      var v = props[NAME_FIELDS[i]];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
  }

  function onMapClick(e) {
    if (!picking) return;
    var r = 12;
    var feats = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]]) || [];
    for (var i = 0; i < feats.length; i++) {
      if (feats[i].layer.type !== 'symbol') continue;
      var name = featureName(feats[i].properties || {});
      if (!name) continue;
      $('#rule-from').value = name;
      $('#rule-to').focus();
      setPicking(false);
      toast('Picked: ' + name);
      return;
    }
    toast('No label there — try clicking closer to the text.');
  }

  // Offer the labels currently on screen as autocomplete, so spelling matches.
  var namesTimer;
  function refreshVisibleNames() {
    clearTimeout(namesTimer);
    namesTimer = setTimeout(function () {
      if (!map || !map.isStyleLoaded()) return;
      var feats;
      try { feats = map.queryRenderedFeatures(); } catch (e) { return; }
      var seen = Object.create(null), names = [];
      for (var i = 0; i < feats.length && names.length < 400; i++) {
        if (feats[i].layer.type !== 'symbol') continue;
        var name = featureName(feats[i].properties || {});
        if (!name || seen[name]) continue;
        seen[name] = true;
        names.push(name);
      }
      names.sort(function (a, b) { return a.localeCompare(b); });
      var frag = document.createDocumentFragment();
      for (var j = 0; j < names.length; j++) {
        var opt = document.createElement('option');
        opt.value = names[j];
        frag.appendChild(opt);
      }
      var dl = $('#visible-names');
      dl.textContent = '';
      dl.appendChild(frag);
    }, 400);
  }

  // ---------------------------------------------------------------- rules

  function renderRules() {
    var ul = $('#rules');
    ul.textContent = '';

    state.rules.forEach(function (rule, index) {
      var li = document.createElement('li');
      if (!rule.on) li.className = 'off';

      var texts = document.createElement('div');
      texts.className = 'texts';
      var from = document.createElement('span');
      from.className = 'from';
      from.textContent = rule.f;
      var to = document.createElement('span');
      to.className = 'to';
      to.textContent = rule.t || '(blank)';
      texts.appendChild(from);
      texts.appendChild(to);
      li.appendChild(texts);

      li.appendChild(iconButton(rule.on ? '👁' : '🚫', rule.on ? 'Disable' : 'Enable', '', function () {
        rule.on = !rule.on;
        commit();
      }));
      li.appendChild(iconButton('✎', 'Edit', '', function () {
        $('#rule-from').value = rule.f;
        $('#rule-to').value = rule.t;
        state.rules.splice(index, 1);
        commit();
        $('#rule-to').focus();
      }));
      li.appendChild(iconButton('✕', 'Delete', 'del', function () {
        state.rules.splice(index, 1);
        commit();
      }));

      ul.appendChild(li);
    });

    $('#empty').hidden = state.rules.length > 0;
    $('#bulk').value = state.rules.map(function (r) { return r.f + ' = ' + r.t; }).join('\n');
  }

  function iconButton(label, title, extra, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon' + (extra ? ' ' + extra : '');
    b.title = title;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function commit() {
    renderRules();
    saveStored();
    syncHash();
    applyRules();
  }

  function addRule(from, to) {
    from = String(from || '').trim();
    if (!from) return false;
    to = String(to || '');
    var key = from.toLowerCase();
    for (var i = 0; i < state.rules.length; i++) {
      if (state.rules[i].f.trim().toLowerCase() === key) {
        state.rules[i].t = to;
        state.rules[i].on = true;
        commit();
        return true;
      }
    }
    state.rules.push({ f: from, t: to, on: true });
    commit();
    return true;
  }

  // ---------------------------------------------------------------- search

  function displayNameFor(name) {
    var key = String(name || '').trim().toLowerCase();
    for (var i = 0; i < state.rules.length; i++) {
      if (state.rules[i].on && state.rules[i].f.trim().toLowerCase() === key) return state.rules[i].t;
    }
    return name;
  }

  // Searching for a replacement name looks up the real place behind it.
  function resolveQuery(q) {
    var key = String(q || '').trim().toLowerCase();
    for (var i = 0; i < state.rules.length; i++) {
      if (state.rules[i].on && String(state.rules[i].t).trim().toLowerCase() === key) return state.rules[i].f;
    }
    return q;
  }

  function searchMessage(text) {
    var ul = $('#search-results');
    ul.textContent = '';
    ul.hidden = false;
    var li = document.createElement('li');
    li.className = 'info';
    li.textContent = text;
    ul.appendChild(li);
  }

  function showResults(items) {
    if (!items.length) return searchMessage('No results.');
    var ul = $('#search-results');
    ul.textContent = '';
    ul.hidden = false;

    items.forEach(function (item) {
      var li = document.createElement('li');
      var main = document.createElement('strong');
      main.textContent = item.title;
      var sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = item.subtitle;
      li.appendChild(main);
      li.appendChild(sub);
      li.addEventListener('click', function () {
        ul.hidden = true;
        if (item.bbox) map.fitBounds(item.bbox, { padding: 60, maxZoom: 16, duration: 900 });
        else map.flyTo({ center: [item.lng, item.lat], zoom: Math.max(map.getZoom(), 13), duration: 900 });
      });
      ul.appendChild(li);
    });
  }

  function doSearch(query) {
    query = String(query || '').trim();
    if (!query) return;
    searchMessage('Searching…');

    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q='
      + encodeURIComponent(resolveQuery(query));

    fetch(url, { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        showResults((data || []).map(function (hit) {
          var parts = String(hit.display_name || '').split(',').map(function (s) { return s.trim(); });
          var head = hit.name || parts.shift() || '';
          var bbox = null;
          if (Array.isArray(hit.boundingbox) && hit.boundingbox.length === 4) {
            var b = hit.boundingbox.map(Number);
            bbox = [[b[2], b[0]], [b[3], b[1]]];
          }
          return {
            title: displayNameFor(head),
            subtitle: parts.map(displayNameFor).join(', '),
            lat: Number(hit.lat),
            lng: Number(hit.lon),
            bbox: bbox
          };
        }));
      })
      .catch(function () { searchMessage('Search is unavailable right now.'); });
  }

  // ---------------------------------------------------------------- hidden mode

  function setHidden(on) {
    state.hidden = on;
    document.body.classList.toggle('hidden-ui', on);
    if (on) {
      $('#panel').hidden = true;
      setPicking(false);
      $('#search-results').hidden = true;
    }
    syncHash();
  }

  function openEditor() {
    setHidden(false);
    $('#panel').hidden = false;
    $('#rule-from').focus();
  }

  function setupHotspot() {
    var clicks = 0, timer;
    $('#hotspot').addEventListener('click', function () {
      clicks++;
      clearTimeout(timer);
      timer = setTimeout(function () { clicks = 0; }, 900);
      if (clicks >= 3) {
        clicks = 0;
        openEditor();
      }
    });
  }

  // ---------------------------------------------------------------- wiring

  function setupUI() {
    var sel = $('#style-select');
    STYLES.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    sel.value = state.style;
    sel.addEventListener('change', function () { switchStyle(sel.value); });

    $('#rule-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!addRule($('#rule-from').value, $('#rule-to').value)) return;
      $('#rule-from').value = '';
      $('#rule-to').value = '';
      $('#rule-from').focus();
    });

    $('#btn-pick').addEventListener('click', function () {
      setPicking(!picking);
      if (picking) toast('Click a label on the map to replace it.');
    });

    $('#open-editor').addEventListener('click', function () {
      var panel = $('#panel');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $('#rule-from').focus();
    });

    $('#btn-hide').addEventListener('click', function () {
      setHidden(true);
      toast('Hidden. Press Ctrl+Shift+E or triple-click the top-left corner to come back.');
    });

    $('#btn-share').addEventListener('click', function () {
      var url = location.origin + location.pathname + location.search + buildHash({ forceHidden: true });
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () { toast('Link copied — it opens with the editor hidden.'); },
          function () { prompt('Copy this link:', url); }
        );
      } else {
        prompt('Copy this link:', url);
      }
    });

    $('#btn-demo').addEventListener('click', function () {
      [['New York', 'Big Apple'],
       ['Brooklyn', 'Best Borough'],
       ['Hudson River', 'The Big Wet']].forEach(function (p) { addRule(p[0], p[1]); });
      toast('Example replacements added.');
    });

    $('#btn-bulk-apply').addEventListener('click', function () {
      var next = [];
      $('#bulk').value.split('\n').forEach(function (line) {
        var m = line.trim().match(/^(.*?)\s*(?:=>|=|->|→)\s*(.*)$/);
        if (m && m[1].trim()) next.push({ f: m[1].trim(), t: m[2], on: true });
      });
      state.rules = next;
      commit();
      toast(next.length + ' replacement(s) active.');
    });

    $('#btn-clear').addEventListener('click', function () {
      if (!state.rules.length) return;
      if (!confirm('Delete every replacement?')) return;
      state.rules = [];
      commit();
    });

    $('#search-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      doSearch($('#search-input').value);
    });

    document.addEventListener('click', function (ev) {
      if (!$('#searchbox').contains(ev.target)) $('#search-results').hidden = true;
    });

    document.addEventListener('keydown', function (ev) {
      var key = (ev.key || '').toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && key === 'e') {
        ev.preventDefault();
        if (state.hidden || $('#panel').hidden) openEditor();
        else setHidden(true);
        return;
      }
      if (key === 'escape') {
        if (picking) return setPicking(false);
        if (!$('#search-results').hidden) { $('#search-results').hidden = true; return; }
        if (!$('#panel').hidden) setHidden(true);
      }
    });

    setupHotspot();
  }

  loadStored();
  readHash();
  setupUI();
  renderRules();
  initMap();

  document.body.classList.toggle('hidden-ui', state.hidden);
  $('#panel').hidden = state.hidden;
  syncHash();
})();
